package main

// Port of server/connection.mjs. The crypto output must stay byte-compatible
// with the Node version: stored tokens and Voicebot tool secrets depend on it.

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"log"
	"maps"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9+/]{43}=$`)

func connectionKey(raw string) ([]byte, error) {
	if !keyPattern.MatchString(raw) {
		return nil, errors.New("connection encryption is not configured")
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != 32 {
		return nil, errors.New("invalid encryption key")
	}
	return key, nil
}

func connectionGCM(rawKey string) (cipher.AEAD, error) {
	key, err := connectionKey(rawKey)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// sealToken returns "v1.<iv>.<tag>.<ciphertext>" (standard base64), like sealToken in Node.
func sealToken(token, owner, rawKey string) (string, error) {
	gcm, err := connectionGCM(rawKey)
	if err != nil {
		return "", err
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		return "", err
	}
	out := gcm.Seal(nil, iv, []byte(token), []byte("voice-connection-v1:"+owner))
	text, tag := out[:len(out)-gcm.Overhead()], out[len(out)-gcm.Overhead():]
	enc := base64.StdEncoding.EncodeToString
	return strings.Join([]string{"v1", enc(iv), enc(tag), enc(text)}, "."), nil
}

func openToken(value, owner, rawKey string) (string, error) {
	parts := strings.Split(value, ".")
	if len(parts) != 4 || parts[0] != "v1" || parts[1] == "" || parts[2] == "" || parts[3] == "" {
		return "", errors.New("invalid encrypted connection")
	}
	gcm, err := connectionGCM(rawKey)
	if err != nil {
		return "", err
	}
	var raw [3][]byte
	for i, p := range parts[1:] {
		if raw[i], err = base64.StdEncoding.DecodeString(p); err != nil {
			return "", errors.New("invalid encrypted connection")
		}
	}
	iv, tag, text := raw[0], raw[1], raw[2]
	if len(iv) != gcm.NonceSize() || len(tag) != gcm.Overhead() {
		return "", errors.New("invalid encrypted connection")
	}
	plain, err := gcm.Open(nil, iv, append(text, tag...), []byte("voice-connection-v1:"+owner))
	if err != nil {
		return "", errors.New("invalid encrypted connection")
	}
	return string(plain), nil
}

func accountSecret(label, accountID, callbackSecret string) (string, error) {
	if accountID == "" || len(callbackSecret) < 32 {
		return "", errors.New("callback is not configured")
	}
	mac := hmac.New(sha256.New, []byte(callbackSecret))
	mac.Write([]byte(label + accountID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func accountCallbackSecret(accountID, callbackSecret string) (string, error) {
	return accountSecret("voice-account-result-v2:", accountID, callbackSecret)
}

func accountRecordingSecret(accountID, callbackSecret string) (string, error) {
	return accountSecret("voice-account-recording-v1:", accountID, callbackSecret)
}

// ---- connection storage and the /workspace/connection operation

// connectionStore returns the service-role client used for server-only tables.
// Like Node, it refuses to run without a valid encryption key.
func (a *App) connectionStore(ctx context.Context) (*db, error) {
	if _, err := connectionKey(a.cfg.EncryptionKey); err != nil {
		return nil, err
	}
	if a.cfg.ServiceRoleKey == "" {
		return nil, errors.New("connection storage is not configured")
	}
	return a.serviceDB(ctx), nil
}

// loadConnection returns the caller's stored connection with its decrypted "token", or nil.
func (a *App) loadConnection(store *db, user obj) (obj, error) {
	if a.cfg.SharedToken != "" {
		return a.sharedConnection(store.ctx, user), nil
	}
	userID := strOr(user["id"])
	row, err := store.MaybeSingle("voice_bot_connections", "*", eq("owner_id", userID))
	if err != nil {
		return nil, fail(503, "ยังอ่านการเชื่อมบัญชีไม่ได้ กรุณาติดต่อผู้ดูแล")
	}
	if row == nil {
		return nil, nil
	}
	token, err := openToken(strOr(row["token_ciphertext"]), userID, a.cfg.EncryptionKey)
	if err != nil {
		return nil, fail(503, "อ่านคีย์ที่เข้ารหัสไม่ได้ กรุณาติดต่อผู้ดูแล")
	}
	conn := maps.Clone(row)
	conn["token"] = token
	return conn, nil
}

// sharedConnection gives every signed-in user the team account in VOICE_BOT_ACCESS_TOKEN.
// Its /me identity is cached until the token expires. A failed lookup returns nil, so saved
// results stay readable and the next request retries.
func (a *App) sharedConnection(ctx context.Context, user obj) obj {
	a.sharedMu.Lock()
	defer a.sharedMu.Unlock()
	if a.sharedAccount == nil || expired(a.sharedAccount["expires_at"]) {
		account, err := a.verifyVoiceToken(ctx, a.cfg.SharedToken)
		if err != nil {
			log.Printf("shared Voice Bot token unusable: %v", err)
			return nil
		}
		a.sharedAccount = account
	}
	conn := maps.Clone(a.sharedAccount)
	conn["owner_id"], conn["token"], conn["shared"], conn["updated_at"] = user["id"], a.cfg.SharedToken, true, nil
	return conn
}

func orBlank(v any) any {
	if truthy(v) {
		return v
	}
	return ""
}

func accountOf(value obj) obj {
	var verified any
	if b, ok := value["verified"].(bool); ok {
		verified = b
	}
	return obj{"account_id": value["_id"], "username": orBlank(value["username"]), "email": orBlank(value["email"]),
		"role": orBlank(value["role"]), "verified": verified}
}

func expired(expiresAt any) bool {
	ms, ok := jsDateParse(expiresAt)
	return truthy(expiresAt) && ok && ms <= nowMS()
}

func publicConnection(value obj) obj {
	if value == nil {
		return obj{"connected": false}
	}
	return obj{"connected": true, "account_id": value["account_id"], "username": value["username"], "email": value["email"],
		"role": value["role"], "verified": value["verified"], "expires_at": value["expires_at"], "updated_at": value["updated_at"],
		"expired": expired(value["expires_at"])}
}

var jwtShape = regexp.MustCompile(`^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)

// tokenExpiry returns the JWT expiry as ISO time, "" when it has none.
func tokenExpiry(token any) (string, error) {
	s, ok := token.(string)
	if !ok || len(s) > 12000 || !jwtShape.MatchString(s) {
		return "", errors.New("invalid JWT")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(strings.Split(s, ".")[1], "="))
	if err != nil {
		return "", errors.New("invalid JWT")
	}
	payload, err := decodeJSON(raw)
	if err != nil || payload == nil {
		return "", errors.New("invalid JWT")
	}
	if !has(payload, "exp") {
		return "", nil
	}
	exp, ok := get(payload, "exp").(float64)
	if !ok || exp <= 0 || exp*1000 > 8.64e15 {
		return "", errors.New("invalid expiry")
	}
	return jsISO(int64(exp * 1000)), nil
}

func (a *App) voiceBotBase() (*url.URL, error) {
	raw := a.cfg.VoiceBotBaseURL
	if raw == "" {
		raw = "https://api-voicebot-stg.botnoigroup.com"
	}
	base, err := url.Parse(raw)
	if err != nil || base.Scheme != "https" || base.User != nil {
		return nil, fail(503, "การตั้งค่าบริการไม่ถูกต้อง")
	}
	return base, nil
}

// verifyVoiceToken checks a Voice Bot session JWT against /me and returns the account it belongs to.
func (a *App) verifyVoiceToken(ctx context.Context, token any) (obj, error) {
	expiresAt, err := tokenExpiry(token)
	if err != nil {
		return nil, fail(400, "กรุณาใส่ Session JWT ของ Voice Bot ให้ครบ")
	}
	if expiresAt != "" && expired(expiresAt) {
		return nil, fail(400, "Session JWT หมดอายุแล้ว กรุณาคัดลอกตัวใหม่จาก Voice Bot")
	}
	base, err := a.voiceBotBase()
	if err != nil {
		return nil, err
	}
	res, err := a.request(ctx, 15*time.Second, "GET", base.ResolveReference(&url.URL{Path: "/me"}).String(), token.(string), nil)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return nil, fail(400, "Voice Bot ไม่รับ Session JWT นี้ กรุณาเข้าสู่ระบบ Voice Bot แล้วคัดลอกใหม่")
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, fail(503, "Voice Bot ยังตรวจบัญชีไม่ได้ กรุณาลองใหม่")
	}
	value, err := readJSON(res)
	if err != nil {
		return nil, err
	}
	id, ok := get(value, "_id").(string)
	if !ok || !providerID.MatchString(id) {
		return nil, fail(502, "บริการไม่ส่งรหัสบัญชีที่ใช้งานได้")
	}
	account := accountOf(value.(obj))
	account["expires_at"] = nil
	if expiresAt != "" {
		account["expires_at"] = expiresAt
	}
	return account, nil
}

var providerID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

// jsSame is === for JSON primitives (objects never compare equal).
func jsSame(a, b any) bool {
	switch a.(type) {
	case nil, string, bool, float64:
		return a == b
	}
	return false
}

func onlyKeys(body obj, allowed ...string) bool {
	for k := range body {
		if !slices.Contains(allowed, k) {
			return false
		}
	}
	return true
}

func (a *App) handleConnection(v *voiceRequest, body any) error {
	if v.method == "GET" {
		public := publicConnection(v.conn)
		if a.cfg.SharedToken != "" {
			public["shared"] = true
		}
		return v.send(200, public)
	}
	if a.cfg.SharedToken != "" {
		return fail(403, "ระบบใช้บัญชี Voice Bot ของทีม เปลี่ยนได้ที่ VOICE_BOT_ACCESS_TOKEN บนเซิร์ฟเวอร์เท่านั้น")
	}
	b, ok := body.(obj)
	if !ok {
		return fail(400, "รูปแบบคำขอไม่ถูกต้อง")
	}
	action, _ := b["action"].(string)
	allowed := map[string][]string{
		"verify":     {"action", "token"},
		"connect":    {"action", "token", "confirm", "expected_account_id", "expected_updated_at"},
		"disconnect": {"action", "confirm", "expected_updated_at"},
	}[action]
	if allowed == nil {
		return fail(400, "การเชื่อมบัญชีไม่ถูกต้อง")
	}
	if !onlyKeys(b, allowed...) {
		return fail(400, "ข้อมูลการเชื่อมบัญชีไม่ถูกต้อง")
	}
	if action != "verify" && (b["confirm"] != true || !jsSame(b["expected_updated_at"], get(v.conn, "updated_at"))) {
		return fail(409, "การเชื่อมบัญชีเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่และยืนยันอีกครั้ง")
	}
	owner := strOr(v.user["id"])
	if action == "disconnect" {
		if v.conn != nil {
			deleted, err := v.store.Delete("voice_bot_connections", "owner_id", eq("owner_id", owner), eq("updated_at", v.conn["updated_at"]))
			if err != nil || len(deleted) == 0 {
				return fail(409, "ยังยกเลิกการเชื่อมไม่ได้ กรุณาโหลดหน้าใหม่")
			}
		}
		return v.send(200, obj{"connected": false})
	}
	account, err := a.verifyVoiceToken(v.ctx, b["token"])
	if err != nil {
		return err
	}
	if action == "verify" {
		return v.send(200, obj{"account": account})
	}
	if !jsSame(b["expected_account_id"], account["account_id"]) {
		return fail(409, "บัญชีจาก Token ไม่ตรงกับที่ตรวจไว้ กรุณาตรวจใหม่ก่อนบันทึก")
	}
	sealed, err := sealToken(b["token"].(string), owner, a.cfg.EncryptionKey)
	if err != nil {
		return err
	}
	values := maps.Clone(account)
	values["owner_id"] = owner
	values["token_ciphertext"] = sealed
	values["updated_at"] = nowISO()
	var saved []obj
	if v.conn != nil {
		saved, err = v.store.Update("voice_bot_connections", values, "owner_id", eq("owner_id", owner), eq("updated_at", v.conn["updated_at"]))
	} else {
		saved, err = v.store.Insert("voice_bot_connections", values, "owner_id")
	}
	if err != nil || len(saved) == 0 {
		return fail(409, "บันทึกการเชื่อมไม่ได้หรือมีการเปลี่ยนพร้อมกัน กรุณาโหลดหน้าใหม่")
	}
	return v.send(200, publicConnection(values))
}
