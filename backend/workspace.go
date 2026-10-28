package main

// Ports of server/results.mjs, preview.mjs, usage.mjs and inbound.mjs.

import (
	"crypto/rand"
	"fmt"
	"maps"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// jsSpaceClass is the JavaScript \s set for use inside RE2 character classes.
const jsSpaceClass = `\t\n\x0B\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}`

var failureReasonRe = regexp.MustCompile(`^[a-zA-Z0-9 _.-]{1,120}$`)

// ---- results.mjs

// handleCallResult reads (and refreshes) or manually reviews one call result.
// accountID is nil for a manual review, "" when no usable connection exists.
func (v *voiceRequest) handleCallResult(id string, body any, accountID *string) error {
	record, err := v.db.MaybeSingle("voice_call_requests", "id,owner_id,call_id,agent_id,status,response,destination,metadata,created_at", eq("id", id), eq("owner_id", v.user["id"]))
	if err != nil || record == nil {
		return fail(404, "ไม่พบคำขอโทรในบัญชีนี้")
	}
	original := record["response"]
	response := objOr(original)
	status := record["status"]
	if v.method == "POST" {
		evidence, hasEvidence := get(body, "evidence"), has(body, "evidence")
		evidenceText, isString := evidence.(string)
		if !truthy(body) || !isOutcome(get(body, "call_result")) || !isNullableBool(get(body, "needs_agent"), has(body, "needs_agent")) ||
			(hasEvidence && (!isString || jsLen(evidenceText) > 2000)) {
			return fail(400, "กรุณาเลือกผลตอบรับและความต้องการเจ้าหน้าที่ให้ถูกต้อง")
		}
		if !jsSame(get(body, "expected_review_at"), get(response, "review", "updated_at")) {
			return fail(409, "ผลถูกแก้ไขแล้ว กรุณารีเฟรชก่อนบันทึก")
		}
		reviewEvidence := any(jsTrim(evidenceText))
		if !hasEvidence {
			reviewEvidence = orBlank(get(response, "review", "evidence"))
		}
		response["review"] = obj{"call_result": get(body, "call_result"), "needs_agent": get(body, "needs_agent"), "evidence": reviewEvidence,
			"updated_at": nowISO(), "reviewed_by": v.user["id"], "source": "manual"}
	} else {
		if accountID != nil && (*accountID == "" || get(record, "metadata", "voice_account_id") != *accountID) {
			out := maps.Clone(record)
			out["warning"] = "แสดงผลที่บันทึกไว้ · ต้องเชื่อมบัญชี Voice Bot เดิมเพื่อตรวจข้อมูลใหม่"
			return v.send(200, out)
		}
		if !truthy(record["call_id"]) {
			out := maps.Clone(record)
			out["warning"] = "ยังไม่มี Call ID จึงตรวจผลจากบริการไม่ได้"
			return v.send(200, out)
		}
		account, err := v.get("/me")
		if err != nil {
			return err
		}
		call, err := v.get(tenantCallPath(jsString(get(account, "_id")), jsString(record["call_id"])))
		if err != nil {
			return err
		}
		if !jsSame(get(call, "call_id"), record["call_id"]) {
			return fail(502, "Call ID จากบริการไม่ตรงกับคำขอ")
		}
		callStatus, ok := get(call, "status").(string)
		if !ok {
			return fail(502, "บริการไม่ระบุสถานะสาย")
		}
		status = callStatus
		text := transcriptText(call)
		var log any
		logPath := ""
		logState := "pending"
		if text != "" {
			logState = "available"
		}
		agentID, callID := jsString(record["agent_id"]), jsString(record["call_id"])
		key, keyRead := "", false
		conversationKey := func() string {
			if !keyRead {
				key, keyRead = v.conversationKey(agentID, callID), true
			}
			return key
		}
		// An unanswered call has no conversation, so its log and analysis are not read.
		answered := callStatus == "completed" || truthy(get(call, "answered_at"))
		reason, _ := get(call, "reason").(string)
		if terminalCall(status) && text == "" {
			logState = "not_available"
		}
		if terminalCall(status) && text == "" && answered {
			// Log files are named by conversation UUID, not call ID; the provider's exact link names the file directly.
			var err error
			if logPath = conversationKey(); logPath == "" {
				var files any
				if files, err = v.get("/logs/list_file/?agent_id=" + escapeComponent(agentID)); err == nil {
					logPath = matchingLogPath(files, call)
				}
			}
			if err == nil {
				if logPath != "" {
					if log, err = v.get("/logs/read_log/?file_path=" + escapeComponent(logPath)); err == nil {
						text = transcriptText(log)
					}
				}
			}
			if err != nil {
				logState = "error"
			} else if text != "" {
				logState = "available"
			}
		}
		outcome := providerOutcome(call, log)
		// Preserve already retrieved evidence if the provider temporarily stops returning it.
		previous := get(response, "followup")
		if outcome["source"] == "unavailable" && terminalCall(status) && answered && !truthy(get(response, "callback")) && get(previous, "outcome", "source") != "provider" {
			if analysed := v.analysisOutcome(agentID, callID, conversationKey()); analysed != nil {
				outcome = analysed
			}
		}
		if signal := noAnswerSignal(callStatus, reason); outcome["source"] == "unavailable" && !answered && signal != "" {
			outcome = obj{"call_result": "NO_ANSWER", "needs_agent": nil, "evidence": "Voice Bot แจ้งว่าผู้รับไม่รับสาย (" + signal + ")", "source": "provider"}
		}
		chosen := any(outcome)
		if outcome["source"] == "unavailable" && get(previous, "outcome", "source") == "provider" {
			chosen = get(previous, "outcome")
		}
		endedBy, _ := get(call, "ended_by").(string)
		followup := obj{"checked_at": nowISO(), "answered_at": orNull(get(call, "answered_at")), "completed_at": orNull(get(call, "completed_at")),
			"ended_by": nil, "failure_reason": nil, "outcome": chosen, "log_state": logState}
		if _, ok := get(call, "ended_by").(string); ok {
			followup["ended_by"] = endedBy
		}
		if failureReasonRe.MatchString(reason) {
			followup["failure_reason"] = reason
		}
		followup["transcript"] = any(text)
		if text == "" {
			followup["transcript"] = orBlank(get(previous, "transcript"))
		}
		followup["log_path"] = any(logPath)
		if logPath == "" {
			followup["log_path"] = orNull(get(previous, "log_path"))
		}
		if truthy(followup["transcript"]) && text == "" {
			followup["log_state"] = "cached"
		}
		// Nothing more will arrive, so the scheduler's background refresh skips this call.
		// An answered call waits up to 30 minutes for Botnoi's post-call analysis and its conversation log,
		// which can land after the analysis result.
		ended, _ := jsDateParse(firstTruthy(get(call, "completed_at"), record["created_at"]))
		hasResult := get(chosen, "source") == "provider" || truthy(get(response, "callback"))
		hasConversation := truthy(followup["transcript"]) || truthy(get(response, "transcript"))
		if terminalCall(status) && (!answered || (hasResult && hasConversation) || nowMS()-ended > 30*60000) {
			followup["final"] = true
		}
		response["followup"] = followup
	}
	filters := guardedUpdate([]q{eq("id", id), eq("owner_id", v.user["id"]), eq("status", record["status"])}, original, "")
	saved, err := v.db.Update("voice_call_requests", obj{"status": status, "response": response}, "id", filters...)
	if err != nil || len(saved) == 0 {
		return fail(409, "บันทึกผลไม่ได้หรือมีการอัปเดตพร้อมกัน กรุณารีเฟรชอีกครั้ง")
	}
	out := maps.Clone(record)
	out["status"], out["response"] = status, response
	return v.send(200, out)
}

// noAnswerSignal returns the provider status or failure reason saying the recipient did not pick up, or "".
// Trunk and system failures such as unreachable are not the recipient's answer and stay undetermined.
func noAnswerSignal(status, reason string) string {
	reason = strings.ToLower(reason)
	switch {
	case status == "no-answer" || status == "busy":
		return status
	case status == "failed" && slices.Contains([]string{"no-answer", "busy", "rejected"}, reason):
		return reason
	}
	return ""
}

var conversationKeyRe = regexp.MustCompile(`_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_\d+\.txt$`)

// analysisOutcome reads Botnoi's post-call analysis (fields call_result, needs_agent and evidence on the agent's
// analysis config), so a result appears even when the agent skipped the result tool during the call.
// Outputs are keyed by the call ID for some calls and by the transcript's conversation UUID for others; ask for both.
func (v *voiceRequest) analysisOutcome(agentID, callID, key string) obj {
	root := "/analytics/v1/agents/" + escapeComponent(agentID)
	config, err := v.get(root + "/config")
	version, ok := get(config, "version").(float64)
	if err != nil || !ok || get(config, "enabled") != true {
		return nil
	}
	ids := []any{callID}
	if m := conversationKeyRe.FindStringSubmatch(key); m != nil {
		ids = append(ids, m[1])
	}
	result, err := v.upstream(root+"/outputs/query", obj{"config_version": version, "conversation_ids": ids}, "POST")
	if err != nil {
		return nil
	}
	return analysisResult(result)
}

// conversationKey is the transcript key Botnoi links exactly to this call and agent, or "".
func (v *voiceRequest) conversationKey(agentID, callID string) string {
	detail, err := v.get("/calls/" + escapeComponent(callID))
	if err != nil || !jsSame(get(detail, "id"), callID) {
		return ""
	}
	conversation := get(detail, "conversation")
	key, _ := get(conversation, "key").(string)
	if get(conversation, "linked_by") != "exact" || !jsSame(get(conversation, "agent_id"), agentID) {
		return ""
	}
	return key
}

// analysisResult picks the first succeeded analysis that extracted a known call_result.
func analysisResult(result any) obj {
	items, _ := get(result, "items").([]any)
	for _, item := range items {
		if get(item, "analysis_status") != "succeeded" {
			continue
		}
		fields := obj{}
		list, _ := get(item, "analysis", "field_results").([]any)
		for _, f := range list {
			if id, ok := get(f, "field_id").(string); ok && get(f, "status") == "extracted" {
				fields[id] = f
			}
		}
		callResult, _ := get(fields, "call_result", "option_id").(string)
		if !isOutcome(callResult) {
			continue
		}
		var needs any
		if b, ok := get(fields, "needs_agent", "value").(bool); ok {
			needs = b
		}
		evidence, _ := get(fields, "evidence", "value").(string)
		return obj{"call_result": callResult, "needs_agent": needs, "evidence": jsSlice(jsTrim(evidence), 2000), "source": "provider"}
	}
	return nil
}

func orNull(v any) any {
	if truthy(v) {
		return v
	}
	return nil
}

// ---- preview.mjs

var previewVariableRe = regexp.MustCompile(`\{\{[` + jsSpaceClass + `]*([a-zA-Z0-9_-]+)[` + jsSpaceClass + `]*\}\}`)
var liveModelRe = regexp.MustCompile(`(?i)live`)

func randomUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// jsNumber is Number(v) for the provider settings used in previews.
func jsNumber(v any) any {
	switch x := v.(type) {
	case float64:
		return x
	case bool:
		if x {
			return float64(1)
		}
		return float64(0)
	case nil:
		return float64(0)
	case string:
		s := jsTrim(x)
		if s == "" {
			return float64(0)
		}
		if n, err := strconv.ParseFloat(s, 64); err == nil {
			return n
		}
	}
	return nil // NaN serializes as null
}

func firstTruthy(values ...any) any {
	for _, v := range values[:len(values)-1] {
		if truthy(v) {
			return v
		}
	}
	return values[len(values)-1]
}

// handlePreview issues a token scoped to one web test session. The saved credential never leaves the server.
func (v *voiceRequest) handlePreview(id string, body any) error {
	if _, err := v.me("บัญชี Voice Bot เปลี่ยนไป กรุณาเชื่อมบัญชีใหม่"); err != nil {
		return err
	}
	if err := v.ownsAgent(id, "ไม่มีสิทธิ์ทดสอบ Agent นี้"); err != nil {
		return err
	}
	detail, err := v.get("/agents/" + id)
	if err != nil {
		return err
	}
	required := promptVariables(detail)
	values, valuesOK := get(body, "variables").(obj)
	outputList, outputsOK := get(body, "outputs").([]any)
	invalid := func() error {
		return fail(400, "กรุณาดึงตัวแปรล่าสุดและกรอกข้อมูลทดสอบให้ครบ")
	}
	if !valuesOK || !outputsOK || len(required) > 50 || len(values) > 50 || len(outputList) > 50 {
		return invalid()
	}
	for key, value := range values {
		s, ok := value.(string)
		if !slices.Contains(required, key) || slices.Contains(reservedKeys, key) || !ok || jsLen(s) > 2000 {
			return invalid()
		}
	}
	var outputs []string
	for _, key := range outputList {
		s, ok := key.(string)
		if !ok || !slices.Contains(required, s) {
			return invalid()
		}
		outputs = append(outputs, s)
	}
	variables := obj{}
	for _, key := range required {
		value, _ := values[key].(string)
		if !slices.Contains(outputs, key) && jsTrim(value) == "" {
			return invalid()
		}
		variables[key] = ""
		if !slices.Contains(outputs, key) {
			variables[key] = jsTrim(value)
		}
	}
	// A preview has its own reference and cannot overwrite a campaign call result.
	variables["vc_call_reference"] = randomUUID()
	variables["vc_record_conversation"] = "false"
	replace := func(text any) string {
		return previewVariableRe.ReplaceAllStringFunc(orEmpty(text), func(match string) string {
			key := previewVariableRe.FindStringSubmatch(match)[1]
			if value, ok := variables[key]; ok {
				return value.(string)
			}
			return match
		})
	}
	data, voice := get(detail, "agent_data"), get(detail, "voice_data")
	live := get(data, "engine_type") == "voice2voice" || get(data, "select_agent") == "gemini_live" ||
		liveModelRe.MatchString(orEmpty(firstTruthy(get(data, "model"), get(data, "gemini_live_model"), "")))
	config := obj{"source": "preview", "variables": variables, "metadata": obj{"variables": variables},
		"system_instruction": replace(get(data, "system_instruction")), "greeting_text": replace(get(data, "greeting_text"))}
	if live {
		config["engine_type"] = firstTruthy(get(data, "engine_type"), "voice2voice")
		config["gemini_model"] = firstTruthy(get(data, "model"), get(data, "gemini_live_model"), "gemini-3.1-flash-live-preview")
		config["llm_provider"] = firstTruthy(get(data, "llm_provider"), "gemini")
		config["gemini_system_instruction"] = replace(get(data, "system_instruction"))
		if name := get(data, "gemini_voice_name"); truthy(name) {
			config["gemini_voice_name"] = name
		}
		config["gemini_language_code"] = "th-TH"
	} else {
		vad := ordered{{"false_silence_sec", 0.1}, {"true_silence_sec", 0.25}, {"false_timeout_sec", float64(3)}}
		if extra, ok := get(voice, "asr_vad_rules").(obj); ok {
			for _, k := range sortedKeys(extra) {
				if i := slices.IndexFunc(vad, func(p kv) bool { return p.k == k }); i >= 0 {
					vad[i].v = extra[k]
				} else {
					vad = append(vad, kv{k, extra[k]})
				}
			}
		}
		config["interruptible"] = get(voice, "interruptible") == true
		config["asr_config"] = jsStringify(ordered{
			{"asr_provider", firstTruthy(get(voice, "asrProvider"), get(voice, "asr_provider"), "botnoi-aws-th-noise-classifier-v17c")},
			{"asr_language_code", firstTruthy(get(voice, "languageCode"), get(voice, "language_code"), "th-TH")},
			{"timeout", float64(60)}, {"asr_vad_rules", vad}})
		config["tts_config"] = jsStringify(ordered{
			{"tts_provider", firstTruthy(get(voice, "ttsProvider"), get(voice, "tts_provider"), "botnoivoice")},
			{"tts_params", ordered{
				{"speaker", jsNumber(firstTruthy(get(voice, "speakerCode"), get(voice, "speaker_code"), float64(1)))},
				{"language", firstTruthy(get(voice, "languageCode_tts"), get(voice, "language_code_tts"), "th")},
				{"speed", firstTruthy(get(voice, "speed"), float64(1))}}}})
		if provider := get(data, "llm_provider"); truthy(provider) {
			config["llm_provider"] = provider
		}
	}
	token, err := v.upstream("/call/tokens", obj{"agent_id": id, "channel": "web"}, "")
	if err != nil {
		return err
	}
	ephemeral, ok := get(token, "ephemeral_token").(string)
	if !ok || ephemeral == "" {
		return fail(502, "บริการยังไม่ส่งสิทธิ์เริ่มบทสนทนา กรุณาลองใหม่")
	}
	return v.send(200, obj{"ephemeral_token": ephemeral, "websocket_url": "wss://voicebot-ws-stg.botnoigroup.com/v1/call", "input_variables": config, "streaming_text": live})
}

// ---- usage.mjs

var failedStatuses = []string{"failed", "busy", "no-answer", "cancelled", "canceled", "unreachable", "rejected"}

type usageCounts struct {
	Date            string  `json:"date,omitempty"`
	CallCount       int     `json:"call_count"`
	Completed       int     `json:"completed"`
	Failed          int     `json:"failed"`
	Other           int     `json:"other"`
	DurationSeconds float64 `json:"duration_seconds"`
	DurationCount   int     `json:"duration_count"`
}

func (c *usageCounts) add(call any) {
	c.CallCount++
	status := get(call, "status")
	switch {
	case status == "completed":
		c.Completed++
	case slices.Contains(failedStatuses, strOr(status)):
		c.Failed++
	default:
		c.Other++
	}
	if d, ok := get(call, "duration_seconds").(float64); ok && d >= 0 {
		c.DurationSeconds += d
		c.DurationCount++
	}
}

// handleUsage aggregates actual telephone calls, never the separate preview-session dashboard.
// usageAgentAllowed reports whether a call's Agent is in the allowed list; an empty list allows every call.
func usageAgentAllowed(call any, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	id, ok := get(call, "agent", "id").(string)
	return ok && slices.Contains(allowed, id)
}

func (v *voiceRequest) handleUsage(query queryList) error {
	start, _ := query.lookup("start_at")
	end, _ := query.lookup("end_at")
	source, _ := query.lookup("source")
	if source == "" {
		source = "all"
	}
	s, okS := jsDateParse(start)
	e, okE := jsDateParse(end)
	if !okS || !okE || s >= e || e-s > 32*86400000 || !slices.Contains([]string{"all", "outbound", "inbound"}, source) {
		return fail(400, "ช่วงเวลาหรือประเภทสายไม่ถูกต้อง")
	}
	if _, err := v.me("บัญชี Voice Bot ไม่ตรงกับบัญชีที่เชื่อม"); err != nil {
		return err
	}
	params := queryList{{"limit", "100"}, {"from", start}, {"to", end}}
	if source != "all" {
		params.set("direction", source)
	}
	// The Voice Bot account is shared; with VOICE_ALLOWED_AGENT_IDS set, count only this app's Agents.
	allowed := splitList(v.app.cfg.AllowedAgentIDs)
	calls := map[string]any{}
	var order []string
	cursors := map[string]bool{}
	for page := 0; ; page++ {
		if page >= 50 {
			return fail(502, "ประวัติมีจำนวนมากเกินกว่าจะโหลดครบ กรุณาเลือกช่วง 7 วัน")
		}
		result, err := v.get("/calls?" + params.encode())
		if err != nil {
			return err
		}
		items, ok := get(result, "items").([]any)
		if !ok {
			return fail(502, "Voice Bot ส่งประวัติสายรูปแบบไม่ถูกต้อง")
		}
		for _, call := range items {
			id, isString := get(call, "id").(string)
			started, okT := jsDateParse(get(call, "started_at"))
			if !isString || !okT {
				return fail(502, "ประวัติสายจาก Voice Bot ขาดรหัสสายหรือเวลาโทร")
			}
			if started >= s && started <= e && (source == "all" || get(call, "direction") == source) && usageAgentAllowed(call, allowed) {
				if _, seen := calls[id]; !seen {
					order = append(order, id)
				}
				calls[id] = call
			}
		}
		next := get(result, "next_cursor")
		if !truthy(next) {
			break
		}
		cursor, ok := next.(string)
		if !ok || cursors[cursor] {
			return fail(502, "Voice Bot ส่งหน้าประวัติซ้ำ จึงยังสรุปยอดทั้งหมดไม่ได้")
		}
		cursors[cursor] = true
		params.set("cursor", cursor)
	}
	summary := usageCounts{}
	buckets := map[string]*usageCounts{}
	for _, id := range order {
		call := calls[id]
		started, _ := jsDateParse(get(call, "started_at"))
		date := time.UnixMilli(started).In(bangkok).Format("2006-01-02")
		if buckets[date] == nil {
			buckets[date] = &usageCounts{Date: date}
		}
		summary.add(call)
		buckets[date].add(call)
	}
	series := make([]*usageCounts, 0, len(buckets))
	for _, b := range buckets {
		series = append(series, b)
	}
	sort.Slice(series, func(i, j int) bool { return series[i].Date < series[j].Date })
	return v.send(200, obj{"window": obj{"start_at": start, "end_at": end, "timezone": "Asia/Bangkok"}, "source": source,
		"checked_at": nowISO(), "summary": summary, "series": series})
}

// ---- inbound.mjs

var didRe = regexp.MustCompile(`^\+?[0-9]{3,20}$`)

func textOrNull(v any) any {
	if s, ok := v.(string); ok {
		return s
	}
	return nil
}

func didRevision(account, did string, agent any) string {
	return sha256Hex(jsStringify([]any{account, did, agent}))
}

// inboundSnapshot returns only the fields the inbound workspace needs, never trunk credentials.
func inboundSnapshot(raw any, accountID string) (obj, []obj, error) {
	tenantSection, trunkSection := get(raw, "sections", "tenant"), get(raw, "sections", "trunk_status")
	if !truthy(get(tenantSection, "ok")) || !truthy(get(tenantSection, "data")) {
		return obj{"configured": false, "numbers": []any{}, "readiness": nil, "paused": false, "trunk_state": nil,
			"notice": "ยังอ่านการตั้งค่าโทรศัพท์ไม่ได้ เปิด Voice Bot เพื่อตรวจว่าบัญชีนี้มีระบบโทรศัพท์และเบอร์รับสายแล้ว"}, nil, nil
	}
	tenant := get(tenantSection, "data")
	if tid := get(tenant, "tenant_id"); truthy(tid) && tid != accountID {
		return nil, nil, fail(502, "ข้อมูลระบบโทรศัพท์ไม่ตรงกับบัญชีที่เชื่อม")
	}
	dids, ok := get(tenant, "dids").([]any)
	for _, did := range dids {
		if s, isString := did.(string); !isString || !didRe.MatchString(s) {
			ok = false
		}
	}
	if !ok {
		return nil, nil, fail(502, "รูปแบบรายการเบอร์จาก Voice Bot ยังไม่รองรับ กรุณาจัดการเบอร์ใน Voice Bot")
	}
	bindings := get(tenant, "did_agents")
	if _, isObj := bindings.(obj); bindings != nil && !isObj {
		return nil, nil, fail(502, "รูปแบบการผูกเบอร์จาก Voice Bot ไม่ถูกต้อง")
	}
	var trunk any
	if truthy(get(trunkSection, "ok")) {
		trunk = get(trunkSection, "data")
	}
	numbers := []obj{}
	seen := map[string]bool{}
	for _, d := range dids {
		did := d.(string)
		if seen[did] {
			continue
		}
		seen[did] = true
		binding := get(bindings, did)
		if _, isString := binding.(string); binding != nil && !isString {
			return nil, nil, fail(502, "รูปแบบ Agent ประจำเบอร์ยังไม่รองรับ")
		}
		agentID := orNull(binding)
		numbers = append(numbers, obj{"did": did, "agent_id": agentID, "revision": didRevision(accountID, did, agentID)})
	}
	var readiness any
	if ready, ok := get(tenant, "readiness", "inbound", "ready").(bool); ok {
		readiness = ready
	}
	var notice any
	if trunk == nil {
		notice = "ยังอ่านสถานะระบบโทรศัพท์ไม่ได้ กรุณาตรวจใน Voice Bot"
	}
	return obj{"configured": true, "numbers": numbers, "readiness": readiness, "paused": truthy(get(trunk, "disabled_at")),
		"trunk_state": textOrNull(get(trunk, "registration", "state")), "notice": notice}, numbers, nil
}

func (v *voiceRequest) handleInbound(action string, body any) error {
	account, err := v.get("/me")
	if err != nil {
		return err
	}
	accountID, ok := get(account, "_id").(string)
	if !ok || !jsSame(accountID, v.conn["account_id"]) || !safeID.MatchString(accountID) {
		return fail(403, "บัญชี Voice Bot ไม่ตรงกับบัญชีที่เชื่อม")
	}
	canManage := jsSame(v.conn["owner_id"], v.user["id"]) && truthy(v.user["email_confirmed_at"])
	root := "/v1/provisioning/tenants/" + accountID
	if action == "history" {
		// One bounded page; show that this is recent history, not an account-wide total.
		result, err := v.get("/calls?direction=inbound&limit=50")
		if err != nil {
			return err
		}
		items, ok := get(result, "items").([]any)
		if !ok {
			return fail(502, "รูปแบบประวัติสายเข้าจาก Voice Bot ไม่ถูกต้อง")
		}
		rows := map[string]obj{}
		var order []string
		for _, call := range items {
			if get(call, "direction") != "inbound" {
				continue
			}
			id, ok := get(call, "id").(string)
			if !ok {
				return fail(502, "ประวัติสายเข้าขาดรหัสสาย")
			}
			var duration any
			if d, ok := get(call, "duration_seconds").(float64); ok && d >= 0 {
				duration = d
			}
			if _, seen := rows[id]; !seen {
				order = append(order, id)
			}
			rows[id] = obj{"id": id, "started_at": textOrNull(get(call, "started_at")), "status": textOrNull(get(call, "status")),
				"number": textOrNull(get(call, "number")), "phone_number": textOrNull(get(call, "phone_number")),
				"agent_id": textOrNull(get(call, "agent", "id")), "agent_name": textOrNull(get(call, "agent", "name")), "duration_seconds": duration}
		}
		list := make([]obj, len(order))
		for i, id := range order {
			list[i] = rows[id]
		}
		sort.SliceStable(list, func(i, j int) bool { return strOr(list[i]["started_at"]) > strOr(list[j]["started_at"]) })
		return v.send(200, obj{"account_id": accountID, "items": list, "has_more": truthy(get(result, "next_cursor")), "checked_at": nowISO()})
	}
	read := func() (obj, []obj, error) {
		raw, err := v.get(root + "/overview?include=tenant,trunk_status")
		if err != nil {
			return nil, nil, err
		}
		return inboundSnapshot(raw, accountID)
	}
	state, numbers, err := read()
	if err != nil {
		return err
	}
	withMeta := func(s obj) error {
		out := maps.Clone(s)
		out["account_id"], out["can_manage"], out["checked_at"] = accountID, canManage, nowISO()
		return v.send(200, out)
	}
	if v.method == "GET" {
		return withMeta(state)
	}
	if !canManage {
		return fail(403, "เฉพาะเจ้าของบัญชีที่เชื่อมเท่านั้นที่เปลี่ยน Agent รับสายได้")
	}
	b, ok := body.(obj)
	if !ok || !onlyKeys(b, "did", "agent_id", "revision", "confirmed", "account_id") {
		return fail(400, "ข้อมูลการผูกเบอร์ไม่ถูกต้อง")
	}
	if b["confirmed"] != true || b["account_id"] != accountID {
		return fail(409, "กรุณาตรวจและยืนยันบัญชี เบอร์ และ Agent อีกครั้ง")
	}
	did, okDID := b["did"].(string)
	agentID, okAgent := b["agent_id"].(string)
	if !okDID || !didRe.MatchString(did) || !okAgent || !agentIDRe.MatchString(agentID) {
		return fail(400, "กรุณาเลือกเบอร์และ Agent ที่ถูกต้อง")
	}
	i := slices.IndexFunc(numbers, func(n obj) bool { return n["did"] == did })
	if i < 0 {
		return fail(403, "ไม่พบเบอร์นี้ในบัญชีที่เชื่อม")
	}
	number := numbers[i]
	if !jsSame(number["revision"], b["revision"]) {
		return fail(409, "การผูกเบอร์เปลี่ยนไปแล้ว กรุณารีเฟรชแล้วตรวจอีกครั้ง")
	}
	if err := v.ownsAgent(agentID, "Agent นี้ไม่อยู่ในบัญชีที่เชื่อม"); err != nil {
		return err
	}
	if number["agent_id"] != agentID {
		if _, err := v.upstream(root+"/dids/"+escapeComponent(did), obj{"agent_id": agentID}, "PUT"); err != nil {
			return fail(502, "ยังยืนยันการบันทึกไม่ได้ กรุณารีเฟรชตรวจ Agent ประจำเบอร์ก่อนบันทึกซ้ำ")
		}
	}
	latest, latestNumbers, err := read()
	if err != nil {
		return fail(502, "ส่งการผูกเบอร์แล้ว แต่ยังอ่านกลับไม่ได้ กรุณารีเฟรชก่อนบันทึกซ้ำ")
	}
	if j := slices.IndexFunc(latestNumbers, func(n obj) bool { return n["did"] == did }); j < 0 || latestNumbers[j]["agent_id"] != agentID {
		return fail(409, "Voice Bot ยังไม่ยืนยัน Agent ที่เลือก กรุณารีเฟรชก่อนบันทึกซ้ำ")
	}
	return withMeta(latest)
}
