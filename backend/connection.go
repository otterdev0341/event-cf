package main

// Port of the crypto in server/connection.mjs. Output must stay byte-compatible
// with the Node version: stored tokens and Voicebot tool secrets depend on it.

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
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
