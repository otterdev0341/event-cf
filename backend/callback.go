package main

// Ports of server/callback.mjs and server/transcript.mjs: the provider-only result receiver.
// It never dials, never accepts an owner from the body, and never changes call status.

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"slices"
	"strings"
)

func (a *App) callbackConfigured() bool {
	return a.cfg.SupabaseURL != "" && a.cfg.ServiceRoleKey != "" && jsLen(a.cfg.CallbackSecret) >= 32
}

// sameSecret compares two secrets in constant time through their SHA-256 digests.
func sameSecret(supplied, expected string) bool {
	a, b := sha256.Sum256([]byte(supplied)), sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

var (
	accountSecretRe = regexp.MustCompile(`^[a-zA-Z0-9_-]{43}$`)
	agentIDRe       = regexp.MustCompile(`^agt_[a-zA-Z0-9_-]+$`)
	resultFields    = []string{"request_id", "agent_id", "call_result", "needs_agent", "evidence"}
)

func isNullableBool(v any, present bool) bool {
	if !present {
		return false
	}
	_, isBool := v.(bool)
	return v == nil || isBool
}

// guardedUpdate adds the optimistic-concurrency filters the Node handlers used:
// every other evidence section must still be exactly as it was read.
func guardedUpdate(filters []q, original any, skip string) []q {
	for _, section := range [][2]string{{"callback", "received_at"}, {"review", "updated_at"}, {"followup", "checked_at"}, {"transcript", "received_at"}, {"audio_link", "updated_at"}} {
		if section[0] == skip {
			continue
		}
		filters = append(filters, eqOrNull("response->"+section[0]+"->>"+section[1], get(original, section[0], section[1])))
	}
	return filters
}

func jsonTypeName(body obj, key string) string {
	v, ok := body[key]
	switch {
	case !ok:
		return "missing"
	case v == nil:
		return "null"
	}
	switch v.(type) {
	case []any:
		return "array"
	case obj:
		return "object"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64:
		return "number"
	}
	return "undefined"
}

func (a *App) handleResultCallback(w http.ResponseWriter, r *http.Request) {
	setJSONHeaders(w)
	if r.Method != "POST" {
		w.Header().Set("Allow", "POST")
		send(w, 405, obj{"error": "POST required"})
		return
	}
	if !a.callbackConfigured() {
		send(w, 503, obj{"error": "Result receiver is not configured"})
		return
	}
	authorization := r.Header.Get("Authorization")
	if len(authorization) > 4096 || !strings.HasPrefix(authorization, "Bearer ") {
		send(w, 401, obj{"error": "Invalid callback credentials"})
		return
	}
	supplied := authorization[7:]
	legacyAuth := sameSecret(supplied, a.cfg.CallbackSecret)
	if !legacyAuth && !accountSecretRe.MatchString(supplied) {
		send(w, 401, obj{"error": "Invalid callback credentials"})
		return
	}
	if !jsonContentType.MatchString(r.Header.Get("Content-Type")) {
		send(w, 415, obj{"error": "JSON required"})
		return
	}
	raw, over, err := readLimited(r, 48000)
	if err != nil || over {
		send(w, 413, obj{"error": "Payload too large"})
		return
	}
	parsed, err := decodeJSON(raw)
	if err != nil {
		status := 400
		if len(raw) > 16000 {
			status = 413
		}
		send(w, status, obj{"error": "Invalid JSON or payload too large"})
		return
	}
	body, objectBody := parsed.(obj)
	isTranscript := objectBody && has(body, "transcript")
	if !isTranscript && len(raw) > 16000 {
		send(w, 413, obj{"error": "Payload too large"})
		return
	}
	if isTranscript && !validTranscriptPayload(body) {
		send(w, 400, obj{"error": "Invalid conversation fields", "fields": []string{"request_id", "agent_id", "transcript"}})
		return
	}
	if !isTranscript {
		invalid := []string{}
		if !objectBody {
			invalid = append(invalid, "body")
		} else {
			if !onlyKeys(body, resultFields...) {
				invalid = append(invalid, "unexpected_fields")
			}
			if s, ok := body["request_id"].(string); !ok || !uuidRe.MatchString(s) {
				invalid = append(invalid, "request_id")
			}
			if s, ok := body["agent_id"].(string); !ok || !agentIDRe.MatchString(s) {
				invalid = append(invalid, "agent_id")
			}
			if !isOutcome(body["call_result"]) {
				invalid = append(invalid, "call_result")
			}
			if needs, present := body["needs_agent"]; !isNullableBool(needs, present) {
				invalid = append(invalid, "needs_agent")
			}
			if s, ok := body["evidence"].(string); !ok || jsTrim(s) == "" || jsLen(s) > 2000 {
				invalid = append(invalid, "evidence")
			}
		}
		if len(invalid) > 0 {
			// Only fixed field names and primitive types: never log secrets, IDs or conversation content.
			fieldTypes := obj{}
			for _, key := range resultFields {
				fieldTypes[key] = "missing"
				if objectBody {
					fieldTypes[key] = jsonTypeName(body, key)
				}
			}
			summary, _ := json.Marshal(obj{"fields": invalid, "fieldTypes": fieldTypes})
			log.Printf("voice_result_invalid_fields %s", summary)
			send(w, 400, obj{"error": "Invalid result fields; send a flat JSON object with typed values", "fields": invalid, "expected": obj{
				"request_id": "UUID vc_call_reference", "agent_id": "configured agt_ ID", "call_result": outcomeOrder,
				"needs_agent": "JSON true, false or null (not quoted strings)", "evidence": "nonempty string, at most 2000 characters"}})
			return
		}
	}
	store := a.serviceDB(r.Context())
	record, err := store.MaybeSingle("voice_call_requests", "id,owner_id,agent_id,call_id,metadata,response,status", eq("id", body["request_id"]))
	if err != nil {
		send(w, 503, obj{"error": "Storage unavailable; retry later"})
		return
	}
	scoped := get(record, "metadata", "callback_auth") == "account_v2"
	authorized := legacyAuth && !scoped
	if account := get(record, "metadata", "voice_account_id"); scoped && truthy(account) {
		expected, err := accountCallbackSecret(jsString(account), a.cfg.CallbackSecret)
		authorized = err == nil && sameSecret(supplied, expected)
	}
	if !authorized {
		send(w, 401, obj{"error": "Invalid callback credentials"})
		return
	}
	if record == nil || !jsSame(record["agent_id"], body["agent_id"]) || get(record, "metadata", "result_callback") != float64(1) ||
		!jsSame(get(record, "metadata", "variables", "vc_call_reference"), record["id"]) {
		send(w, 404, obj{"error": "Unknown callback reference"})
		return
	}
	if isTranscript {
		saveTranscriptCallback(w, store, record, body)
		return
	}
	// Initial call persistence owns response until call_id is saved. Retry rather than race it.
	if !truthy(record["call_id"]) {
		send(w, 409, obj{"error": "Call not yet persisted; retry later"})
		return
	}
	outcome := ordered{{"call_result", body["call_result"]}, {"needs_agent", body["needs_agent"]}, {"evidence", jsTrim(body["evidence"].(string))}, {"source", "agent_tool"}}
	fingerprint := sha256Hex(jsStringify([]any{record["id"], record["agent_id"], outcome}))
	original := record["response"]
	if previous := get(original, "callback"); truthy(previous) {
		if get(previous, "fingerprint") == fingerprint {
			send(w, 200, obj{"received": true, "duplicate": true})
		} else {
			send(w, 409, obj{"error": "A final result already exists; review corrections in Voice Confirm"})
		}
		return
	}
	outcomeObj := obj{}
	for _, p := range outcome {
		outcomeObj[p.k] = p.v
	}
	response := objOr(original)
	response["callback"] = obj{"outcome": outcomeObj, "fingerprint": fingerprint, "received_at": nowISO(), "call_id": record["call_id"]}
	filters := []q{eq("id", record["id"]), eq("owner_id", record["owner_id"]), eq("agent_id", record["agent_id"]), eq("call_id", record["call_id"]), isNull("response->callback->>received_at")}
	saved, err := store.Update("voice_call_requests", obj{"response": response}, "id", guardedUpdate(filters, original, "callback")...)
	if err != nil {
		send(w, 503, obj{"error": "Result was not saved; retry later"})
		return
	}
	if len(saved) == 0 {
		send(w, 409, obj{"error": "Concurrent update; retry the same payload"})
		return
	}
	send(w, 200, obj{"received": true})
}

// ---- transcript.mjs

const (
	transcriptStart = "[VOICE_CONFIRM_TRANSCRIPT_SETUP_V1]"
	transcriptEnd   = "[/VOICE_CONFIRM_TRANSCRIPT_SETUP_V1]"
)

var transcriptFields = []string{"request_id", "agent_id", "transcript"}

func includesString(list any, s string) bool {
	items, ok := list.([]any)
	return ok && slices.ContainsFunc(items, func(item any) bool { return item == s })
}

func arrayLen(v any) int {
	if list, ok := v.([]any); ok {
		return len(list)
	}
	return -1
}

// bearerToolAuth checks the execution auth shared by all Voice Confirm tools.
func bearerToolAuth(tool any) bool {
	auth := get(tool, "execution", "auth")
	header := get(auth, "header_name")
	return get(auth, "type") == "bearer" && get(auth, "has_api_key") == true &&
		(!truthy(header) || strings.ToLower(jsString(header)) == "authorization")
}

// bodyParams checks that every field is required and mapped to the request body under its own name.
func bodyParams(tool any, fields []string, typed func(key string) bool) bool {
	p := get(tool, "parameters")
	if get(p, "type") != "object" || arrayLen(get(p, "required")) != len(fields) {
		return false
	}
	for _, key := range fields {
		mapped := get(tool, "execution", "param_map", key)
		name := get(mapped, "key")
		if !truthy(name) {
			name = key
		}
		if !includesString(get(p, "required"), key) || !typed(key) || get(mapped, "in") != "body" || name != key {
			return false
		}
	}
	return true
}

func accountLabel(accountID string) string {
	if accountID == "" {
		return "legacy"
	}
	return accountID
}

func compatibleTranscriptTool(tool any, agentID any, endpoint, accountID string) bool {
	types := get(tool, "parameters", "properties")
	description, _ := get(tool, "description").(string)
	enum := get(types, "agent_id", "enum")
	return strings.Contains(description, "Voice Confirm transcript:"+accountLabel(accountID)+" v1") &&
		get(tool, "status") == "active" && get(tool, "tool_type") == "http" &&
		get(tool, "execution", "method") == "POST" && get(tool, "execution", "endpoint") == endpoint && bearerToolAuth(tool) &&
		bodyParams(tool, transcriptFields, func(key string) bool { return get(types, key, "type") == "string" }) &&
		arrayLen(enum) == 1 && jsSame(enum.([]any)[0], agentID) && get(types, "transcript", "maxLength") == float64(10000)
}

// boundTool reports whether the agent has this exact tool attached.
func boundTool(agent, tool any) bool {
	bindings, _ := get(agent, "agent_data", "tools").([]any)
	return slices.ContainsFunc(bindings, func(b any) bool {
		return jsSame(get(b, "tool_id"), get(tool, "tool_id")) && jsSame(get(b, "tools_name"), get(tool, "name"))
	})
}

func findTool(tools any, match func(tool any) bool) obj {
	list, _ := tools.([]any)
	for _, tool := range list {
		if match(tool) {
			m, _ := tool.(obj)
			if m == nil {
				m = obj{}
			}
			return m
		}
	}
	return nil
}

func connectedTranscriptTool(agent, tools any, endpoint, accountID string) obj {
	prompt := orEmpty(currentPrompt(agent))
	agentID := get(agent, "agent_id")
	return findTool(tools, func(tool any) bool {
		return compatibleTranscriptTool(tool, agentID, endpoint, accountID) && boundTool(agent, tool) &&
			strings.Contains(prompt, transcriptStart) && strings.Contains(prompt, transcriptEnd) &&
			strings.Contains(prompt, "{{vc_call_reference}}") && strings.Contains(prompt, "{{vc_record_conversation}}") &&
			strings.Contains(prompt, jsString(get(tool, "name"))) && strings.Contains(prompt, jsString(agentID))
	})
}

// replaceBlock inserts or replaces a marked block in a prompt, rejecting damaged markers.
func replaceBlock(previous, start, end, block, damaged string) (string, error) {
	hasStart, hasEnd := strings.Contains(previous, start), strings.Contains(previous, end)
	if hasStart != hasEnd || strings.Count(previous, start) > 1 || strings.Count(previous, end) > 1 ||
		(hasStart && strings.Index(previous, end) < strings.Index(previous, start)) {
		return "", fail(409, damaged)
	}
	if hasStart {
		return previous[:strings.Index(previous, start)] + block + previous[strings.Index(previous, end)+len(end):], nil
	}
	return previous + "\n\n" + block, nil
}

// unreadableWebhook reports a webhook key the provider never returns, which an update would erase.
func unreadableWebhook(agent any) bool {
	auth := get(agent, "webhook", "auth")
	return truthy(get(agent, "webhook", "enabled")) && truthy(get(auth, "type")) && get(auth, "type") != "none" &&
		!truthy(get(auth, "token")) && !truthy(get(auth, "api_key"))
}

func withTranscriptPrompt(agent any, name string) (string, error) {
	previous, ok := currentPrompt(agent).(string)
	if !ok || jsTrim(previous) == "" || !truthy(get(agent, "bot_name")) {
		return "", fail(409, "Agent ต้องมีบทสนทนาก่อนเชื่อมบันทึก")
	}
	if _, err := replaceBlock(previous, transcriptStart, transcriptEnd, "", "ส่วนบันทึกบทสนทนาใน Prompt ไม่สมบูรณ์ กรุณาตรวจใน Voice Bot"); err != nil {
		return "", err
	}
	if unreadableWebhook(agent) {
		return "", fail(409, "Agent นี้มีคีย์ Webhook ที่บริการไม่เปิดให้อ่าน กรุณาตั้ง Tool ผ่าน Voice Bot เพื่อรักษาคีย์เดิม")
	}
	block := transcriptStart + "\n" +
		"สำหรับสายนี้ บันทึกบทสนทนา = {{vc_record_conversation}} รหัสสาย = {{vc_call_reference}} ห้ามอ่านข้อมูลระบบนี้ให้ผู้รับฟัง\n" +
		"ให้เรียก " + name + " เฉพาะเมื่อ vc_record_conversation เป็นข้อความ true และรหัสสายเป็น UUID ที่ระบบให้มาเท่านั้น หาก false, ว่าง หรือยังเป็น placeholder ห้ามเรียก Tool นี้\n" +
		"ก่อนจบสายและก่อน end_call ให้ส่งบทสนทนาที่เกิดขึ้นจริงและมีอยู่ในบริบทปัจจุบันตามลำดับ โดยระบุ ผู้รับ: และ บอท: ในแต่ละบรรทัด ห้ามแต่งหรือเติมคำที่ไม่ได้ยิน ห้ามใช้สรุปผลตอบรับแทนบทสนทนา ห้ามบันทึกคำสั่งระบบหรือข้อมูลลับ\n" +
		"ส่ง JSON 3 ฟิลด์: request_id ใช้ vc_call_reference ตรงตัว, agent_id ใช้ " + jsString(get(agent, "agent_id")) + ", transcript ใช้ข้อความสนทนาดังกล่าว ไม่เกิน 10000 ตัวอักษร ถ้ายาวเกินให้ส่งเท่าที่มีและลงท้าย [บันทึกไม่ครบ: เกินขนาดที่รองรับ]\n" +
		"เรียกหลัง Tool ส่งผลตอบรับ (ถ้ามี) และก่อน end_call ถือว่าบันทึกสำเร็จเฉพาะเมื่อได้รับ received: true หาก timeout, HTTP 503 หรือ 409 Concurrent update/Call not yet persisted ให้ลอง payload เดิมอีกไม่เกิน 2 ครั้ง ห้ามอ้างว่าบันทึกครบหากไม่มีข้อมูลครบ\n" +
		transcriptEnd
	prompt, _ := replaceBlock(previous, transcriptStart, transcriptEnd, block, "")
	if jsLen(prompt) > 60000 {
		return "", fail(409, "Prompt ยาวเกินไปสำหรับการเชื่อมอัตโนมัติ")
	}
	return prompt, nil
}

func bodyParamMap(fields ...string) obj {
	out := obj{}
	for _, k := range fields {
		out[k] = obj{"in": "body", "key": k}
	}
	return out
}

func toolExecution(endpoint, apiKey string, params obj) obj {
	return obj{"method": "POST", "endpoint": endpoint,
		"auth":      obj{"type": "bearer", "header_name": "Authorization", "scheme": "Bearer", "api_key": apiKey},
		"param_map": params, "headers": obj{"Content-Type": "application/json"}, "timeout": 20}
}

func transcriptToolPayload(id, secret, endpoint, accountID string) obj {
	return obj{"name": "vc_transcript_v1_" + id[4:], "description": "Voice Confirm transcript:" + accountLabel(accountID) + " v1. Save actual available conversation text only when vc_record_conversation is true.",
		"tool_type": "http", "status": "active",
		"parameters": obj{"type": "object", "properties": obj{
			"request_id": obj{"type": "string", "description": "Exact vc_call_reference UUID provided for this call"},
			"agent_id":   obj{"type": "string", "enum": []any{id}},
			"transcript": obj{"type": "string", "minLength": 1, "maxLength": 10000, "description": "Actual conversation turns in order, speaker labeled. Never invent or summarize missing words."},
		}, "required": toAny(transcriptFields)},
		"execution": toolExecution(endpoint, secret, bodyParamMap(transcriptFields...))}
}

func validTranscriptPayload(body obj) bool {
	if len(body) != len(transcriptFields) || !onlyKeys(body, transcriptFields...) {
		return false
	}
	id, ok1 := body["request_id"].(string)
	agent, ok2 := body["agent_id"].(string)
	text, ok3 := body["transcript"].(string)
	return ok1 && uuidRe.MatchString(id) && ok2 && agentIDRe.MatchString(agent) && ok3 && jsTrim(text) != "" && jsLen(text) <= 10000
}

// saveTranscriptCallback runs only after authentication against the account that owns this call.
func saveTranscriptCallback(w http.ResponseWriter, store *db, record, body obj) {
	if get(record, "metadata", "record_conversation") != true || get(record, "metadata", "variables", "vc_record_conversation") != "true" {
		send(w, 403, obj{"error": "Conversation recording is disabled for this call"})
		return
	}
	if !truthy(record["call_id"]) {
		send(w, 409, obj{"error": "Call not yet persisted; retry later"})
		return
	}
	text := jsTrim(body["transcript"].(string))
	fingerprint := sha256Hex(jsStringify([]any{record["id"], record["agent_id"], text}))
	original := record["response"]
	if previous := get(original, "transcript"); truthy(previous) {
		if get(previous, "fingerprint") == fingerprint {
			send(w, 200, obj{"received": true, "duplicate": true})
		} else {
			send(w, 409, obj{"error": "A conversation record already exists"})
		}
		return
	}
	response := objOr(original)
	response["transcript"] = obj{"text": text, "fingerprint": fingerprint, "source": "agent_tool", "received_at": nowISO(), "call_id": record["call_id"]}
	filters := []q{eq("id", record["id"]), eq("owner_id", record["owner_id"]), eq("agent_id", record["agent_id"]), eq("call_id", record["call_id"]), isNull("response->transcript->>received_at")}
	saved, err := store.Update("voice_call_requests", obj{"response": response}, "id", guardedUpdate(filters, original, "transcript")...)
	if err != nil {
		send(w, 503, obj{"error": "Conversation was not saved; retry later"})
		return
	}
	if len(saved) == 0 {
		send(w, 409, obj{"error": "Concurrent update; retry the same payload"})
		return
	}
	send(w, 200, obj{"received": true})
}
