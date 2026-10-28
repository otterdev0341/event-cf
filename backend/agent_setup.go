package main

// Port of server/agent-setup.mjs: attaches the result, transcript or general-events tool to an agent.

import (
	"context"
	"regexp"
	"strings"
)

const (
	resultStart = "[VOICE_CONFIRM_RESULT_SETUP_V1]"
	resultEnd   = "[/VOICE_CONFIRM_RESULT_SETUP_V1]"
)

var (
	setupFields   = []string{"request_id", "agent_id", "call_result", "needs_agent", "evidence"}
	setupOutcomes = []string{"CONFIRMED", "DECLINED", "CALLBACK_REQUESTED", "REQUEST_AGENT", "WRONG_PERSON", "UNDETERMINED"}
	revisionRe    = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

func configOf(agent any) obj {
	out := obj{}
	for _, k := range []string{"bot_name", "agent_data", "voice_data", "transfer", "webhook", "agent_id"} {
		if has(agent, k) {
			out[k] = get(agent, k)
		}
	}
	return out
}

// setupRevision hashes the editable agent config; jsStringify sorts object keys like the Node sorted().
func setupRevision(agent any) string { return sha256Hex(jsStringify(configOf(agent))) }

func compatibleTool(tool any, agentID any, endpoint, accountID string) bool {
	types := get(tool, "parameters", "properties")
	description, _ := get(tool, "description").(string)
	restriction := get(types, "agent_id", "enum")
	for _, k := range setupFields {
		if !truthy(get(types, k)) {
			return false
		}
	}
	for _, k := range setupOutcomes {
		if !includesString(get(types, "call_result", "enum"), k) {
			return false
		}
	}
	return (accountID == "" || strings.Contains(description, "Voice Confirm account:"+accountID+" v2")) &&
		get(tool, "status") == "active" && get(tool, "tool_type") == "http" && get(tool, "execution", "method") == "POST" &&
		get(tool, "execution", "endpoint") == endpoint && bearerToolAuth(tool) &&
		bodyParams(tool, setupFields, func(string) bool { return true }) &&
		get(types, "request_id", "type") == "string" && get(types, "agent_id", "type") == "string" &&
		(restriction == nil || arrayLen(restriction) == 1 && jsSame(restriction.([]any)[0], agentID)) &&
		get(types, "call_result", "type") == "string" && get(types, "needs_agent", "type") == "boolean" && get(types, "evidence", "type") == "string"
}

func connectedTool(agent, tools any, endpoint, accountID string) obj {
	prompt := orEmpty(currentPrompt(agent))
	agentID := get(agent, "agent_id")
	return findTool(tools, func(tool any) bool {
		return compatibleTool(tool, agentID, endpoint, accountID) && boundTool(agent, tool) &&
			strings.Contains(prompt, "{{vc_call_reference}}") && strings.Contains(prompt, jsString(get(tool, "name"))) && strings.Contains(prompt, jsString(agentID))
	})
}

func withPrompt(agent any, name string) (string, error) {
	previous, ok := currentPrompt(agent).(string)
	if !ok || jsTrim(previous) == "" || !truthy(get(agent, "bot_name")) {
		return "", fail(409, "Agent ต้องมีบทสนทนาก่อนเชื่อมระบบรับผล")
	}
	if _, err := replaceBlock(previous, resultStart, resultEnd, "", "ส่วนส่งผลใน Prompt ไม่สมบูรณ์ กรุณาตรวจใน Voice Bot ก่อน"); err != nil {
		return "", err
	}
	if unreadableWebhook(agent) {
		return "", fail(409, "Agent นี้มีคีย์ Webhook ที่บริการไม่เปิดให้อ่าน กรุณาตั้ง Tool ผ่าน Voice Bot เพื่อรักษาคีย์เดิม")
	}
	block := resultStart + "\n" +
		"ระบบส่งรหัสอ้างอิงสายนี้ให้เป็น {{vc_call_reference}} ห้ามอ่านรหัสนี้ให้ผู้รับฟัง ห้ามสร้างหรือเปลี่ยนรหัส และห้ามใช้รหัสผู้สมัครหรือเบอร์โทรแทน\n" +
		"เมื่อได้ข้อสรุปจากคำพูดจริงของผู้รับแล้ว ก่อนจบการสนทนาและก่อนเรียก end_call ให้เรียก " + name + " โดยส่ง JSON 5 ฟิลด์:\n" +
		"request_id: ใช้ vc_call_reference ของสายนี้ตรงตัว\n" +
		"agent_id: " + jsString(get(agent, "agent_id")) + "\n" +
		"call_result: CONFIRMED (ตกลง), DECLINED (ปฏิเสธ), CALLBACK_REQUESTED (ขอให้โทรกลับ), REQUEST_AGENT (ขอเจ้าหน้าที่), WRONG_PERSON (ผิดคน), UNDETERMINED (ยังสรุปไม่ได้) ห้ามเดาผลจากการโทรติด และห้ามใช้ NO_ANSWER ขณะกำลังสนทนา\n" +
		"needs_agent: JSON boolean true เมื่อต้องการเจ้าหน้าที่, false เมื่อทราบชัดว่าไม่ต้องการ, null เมื่อยังไม่ทราบ ห้ามใช้ข้อความ \"true\", \"false\" หรือ \"null\"\n" +
		"evidence: คำพูดจริงสั้น ๆ ที่รองรับผล หรือเหตุผลที่ยังสรุปไม่ได้ ห้ามแต่งคำตอบ\n" +
		"ส่งผลสุดท้ายหนึ่งครั้ง ถือว่าสำเร็จเมื่อได้รับ received: true หาก HTTP 400 ให้แก้เฉพาะฟิลด์ที่ API ระบุโดยใช้ข้อมูลจริง หาก timeout, HTTP 503 หรือ 409 Concurrent update/Call not yet persisted ให้ลอง payload เดิมอีกไม่เกิน 2 ครั้ง\n" +
		"หากรหัสยังเป็น placeholder หรือไม่ใช่ UUID ห้ามเรียก Tool และห้ามอ้างว่าบันทึกสำเร็จ การบันทึกคำขอเจ้าหน้าที่ไม่ใช่การโอนสายหรือการแจ้งเจ้าหน้าที่อัตโนมัติ\n" +
		"คำสั่งนี้กำหนดวิธีส่งผลแทนตัวอย่างบันทึก Backend ใน Prompt เดิม\n" +
		resultEnd
	prompt, _ := replaceBlock(previous, resultStart, resultEnd, block, "")
	if jsLen(prompt) > 60000 {
		return "", fail(409, "Prompt ยาวเกินไปสำหรับการเชื่อมอัตโนมัติ")
	}
	return prompt, nil
}

func toolPayload(id, secret, endpoint, accountID string) obj {
	name, description := "vc_result_"+id[4:], ""
	if accountID != "" {
		name, description = "vc_result_v2_"+id[4:], "Voice Confirm account:"+accountID+" v2. "
	}
	return obj{"name": name, "description": description + "Save the final recipient response for Voice Confirm before ending the call. Use the provided vc_call_reference; never invent results.",
		"tool_type": "http", "status": "active", "parameters": obj{"type": "object", "properties": obj{
			"request_id":  obj{"type": "string", "description": "Exact system-provided vc_call_reference UUID; never invent"},
			"agent_id":    obj{"type": "string", "enum": []any{id}},
			"call_result": obj{"type": "string", "enum": toAny(setupOutcomes)},
			"needs_agent": obj{"type": "boolean", "nullable": true, "description": "JSON true, false or null, never quoted strings"},
			"evidence":    obj{"type": "string", "minLength": 1, "maxLength": 2000, "description": "Actual recipient words supporting the final response"},
		}, "required": toAny(setupFields)},
		"execution": toolExecution(endpoint, secret, bodyParamMap(setupFields...))}
}

// setupKind bundles the functions that differ between the result, transcript and general tools.
type setupKind struct {
	connected  func(agent, tools any) obj
	compatible func(tool any) bool
	extend     func(agent any, name string) (string, error)
	makeTool   func() (obj, error)
}

// handleAgentSetup reports (GET) or connects (POST) one agent. cfg carries the per-account secret.
// The caller has already required a live connection, so the legacy admin path is gone.
func (v *voiceRequest) handleAgentSetup(id string, body any, cfg Config, transcript, general bool) error {
	accountID := strOr(v.conn["account_id"])
	ownerID := strOr(v.user["id"])
	canManage := jsSame(v.conn["owner_id"], v.user["id"]) && truthy(v.user["email_confirmed_at"])
	var rec reception
	endpoint := receiverURL(cfg)
	if general {
		endpoint = generalEndpoint(cfg)
	}
	kind := setupKind{
		connected:  func(agent, tools any) obj { return connectedTool(agent, tools, endpoint, accountID) },
		compatible: func(tool any) bool { return compatibleTool(tool, id, endpoint, accountID) },
		extend:     withPrompt,
		makeTool:   func() (obj, error) { return toolPayload(id, cfg.CallbackSecret, endpoint, accountID), nil },
	}
	if transcript {
		kind = setupKind{
			connected:  func(agent, tools any) obj { return connectedTranscriptTool(agent, tools, endpoint, accountID) },
			compatible: func(tool any) bool { return compatibleTranscriptTool(tool, id, endpoint, accountID) },
			extend:     withTranscriptPrompt,
			makeTool:   func() (obj, error) { return transcriptToolPayload(id, cfg.CallbackSecret, endpoint, accountID), nil },
		}
	}
	if general {
		kind = setupKind{
			connected:  func(agent, tools any) obj { return connectedGeneralTool(agent, tools, endpoint, accountID, ownerID) },
			compatible: func(tool any) bool { return compatibleGeneralTool(tool, id, endpoint, accountID, ownerID) },
			extend:     func(agent any, name string) (string, error) { return withGeneralPrompt(agent, name, rec) },
			makeTool:   func() (obj, error) { return generalToolPayload(id, cfg.CallbackSecret, endpoint, accountID, ownerID) },
		}
		account, err := v.get("/me")
		if err != nil {
			return err
		}
		if !jsSame(get(account, "_id"), accountID) {
			return fail(403, "บัญชี Voice Bot ไม่ตรงกับบัญชีที่เชื่อม")
		}
	}
	b, _ := body.(obj)
	isPost := v.method == "POST"
	if isPost && !canManage {
		return fail(403, "เฉพาะผู้ดูแลที่กำหนดไว้เท่านั้นที่เชื่อม Agent ได้")
	}
	allowed := []string{"confirm", "expected_revision"}
	if general {
		allowed = append(allowed, "reception")
	}
	expected, _ := get(b, "expected_revision").(string)
	if isPost && (b == nil || !onlyKeys(b, allowed...) || b["confirm"] != true || !revisionRe.MatchString(expected)) {
		return fail(400, "กรุณาตรวจ Agent และยืนยันการเชื่อมต่อ")
	}
	hasReception := general && isPost && has(b, "reception")
	if hasReception {
		var err error
		if rec, err = validateGeneralReception(b["reception"]); err != nil {
			return err
		}
	}
	agents, err := v.get("/agents")
	if err != nil {
		return err
	}
	if list, ok := agents.([]any); !ok || !hasAgent(list, id) {
		return fail(403, "ไม่มีสิทธิ์เชื่อม Agent นี้")
	}
	configured := v.app.callbackConfigured() && endpoint != ""
	agent, err := v.get("/agents/" + id)
	if err != nil {
		return err
	}
	if get(agent, "agent_id") != id {
		return fail(502, "Agent ที่บริการส่งกลับไม่ตรงกับคำขอ")
	}
	if general && !hasReception {
		rec = generalReceptionProfile(agent)
	}
	tools, err := v.get("/platform-config/tools")
	if err != nil {
		return err
	}
	if _, ok := tools.([]any); !ok {
		return fail(502, "อ่านรายการ Tool ไม่สำเร็จ")
	}
	status := func(value, list any) obj {
		out := obj{"agent_id": id, "revision": setupRevision(value), "can_manage": canManage, "configured": configured,
			"connected": endpoint != "" && kind.connected(value, list) != nil}
		if has(value, "bot_name") {
			out["agent_name"] = get(value, "bot_name")
		}
		if general {
			out["reception"] = generalReceptionProfile(value).obj()
		}
		return out
	}
	if !isPost {
		return v.send(200, status(agent, tools))
	}
	if !configured {
		return fail(503, "ผู้ดูแลยังตั้งค่า URL หรือระบบรับผลไม่ครบ")
	}
	if setupRevision(agent) != expected {
		return fail(409, "Agent ถูกแก้ไขแล้ว กรุณาตรวจสถานะใหม่ก่อนเชื่อม")
	}
	if connected := kind.connected(agent, tools); connected != nil {
		done := !general
		if general {
			prompt, err := kind.extend(agent, jsString(connected["name"]))
			if err != nil {
				return err
			}
			done = currentPrompt(agent) == prompt && (!truthy(b["reception"]) || get(agent, "agent_data", "greeting_text") == generalGreeting(rec))
		}
		if done {
			out := status(agent, tools)
			out["already_connected"] = true
			return v.send(200, out)
		}
	}
	// Abort before creating a tool if the prompt cannot safely be extended.
	prefix := "vc_result_"
	if general {
		prefix = "vc_events_v1_"
	}
	if _, err := kind.extend(agent, prefix+id[4:]); err != nil {
		return err
	}
	service := v.app.serviceDB(v.ctx)
	operation := randomUUID()
	lockArgs := obj{"p_agent_id": id, "p_lock_id": operation}
	if accountID != "" {
		lockArgs["p_account_id"] = accountID
	}
	locked, err := service.RPC("acquire_voice_agent_setup", lockArgs)
	if err != nil {
		return fail(503, "ยังไม่ได้ติดตั้งระบบเก็บการตั้งค่า Agent หรือฐานข้อมูลไม่พร้อม")
	}
	if locked != true {
		return fail(409, "มีผู้ดูแลกำลังเชื่อม Agent นี้ กรุณารอสักครู่แล้วตรวจสถานะใหม่")
	}
	// Cleanup must finish even if the browser disconnects.
	cleanup := v.app.serviceDB(context.WithoutCancel(v.ctx))
	release := func() {
		cleanup.Delete("voice_agent_setup_locks", "", eq("agent_id", id), eq("account_id", accountLabel(accountID)), eq("lock_id", operation))
	}
	audited := false
	var tool obj
	response, err := func() (obj, error) {
		agent, err := v.get("/agents/" + id)
		if err != nil {
			return nil, err
		}
		if setupRevision(agent) != expected {
			return nil, fail(409, "Agent ถูกแก้ไขแล้ว กรุณาตรวจสถานะใหม่")
		}
		audit := obj{"id": operation, "actor_id": ownerID, "agent_id": id, "before_config": configOf(agent), "status": "started"}
		if accountID != "" {
			audit["account_id"] = accountID
		}
		if _, err := service.Insert("voice_agent_setup_audits", audit, ""); err != nil {
			return nil, fail(503, "เก็บการตั้งค่าก่อนแก้ไม่สำเร็จ กรุณาลองใหม่")
		}
		audited = true
		if tools, err = v.get("/platform-config/tools"); err != nil {
			return nil, err
		}
		desired, err := kind.makeTool()
		if err != nil {
			return nil, err
		}
		list, _ := tools.([]any)
		var named []any
		for _, t := range list {
			if get(t, "name") == desired["name"] {
				named = append(named, t)
			}
		}
		if len(named) > 1 || len(named) == 1 && !kind.compatible(named[0]) {
			return nil, fail(409, "ชื่อ Tool สำหรับ Agent นี้มีการตั้งค่าอื่นอยู่ กรุณาตรวจใน Voice Bot")
		}
		if len(named) == 1 {
			tool = objOr(named[0])
		} else {
			tool = findTool(tools, kind.compatible)
		}
		if tool == nil {
			// No blind retry on an uncertain creation; the next request rechecks the stored tools.
			if _, err := v.upstream("/platform-config/tools", desired, "POST"); err != nil {
				return nil, err
			}
			if tools, err = v.get("/platform-config/tools"); err != nil {
				return nil, err
			}
			list, _ := tools.([]any)
			var created []any
			for _, t := range list {
				if get(t, "name") == desired["name"] && kind.compatible(t) {
					created = append(created, t)
				}
			}
			if len(created) != 1 {
				return nil, fail(502, "ยังยืนยัน Tool ที่สร้างไม่ได้ กรุณาตรวจสถานะใหม่ก่อนลองอีกครั้ง")
			}
			tool = objOr(created[0])
		}
		latest, err := v.get("/agents/" + id)
		if err != nil {
			return nil, err
		}
		if setupRevision(latest) != expected {
			return nil, fail(409, "Agent ถูกแก้ไขระหว่างเชื่อม Tool กรุณาตรวจสถานะใหม่")
		}
		payload := configOf(latest)
		data := objOr(get(latest, "agent_data"))
		promptKey := "system_instruction"
		if !has(get(latest, "agent_data"), "system_instruction") {
			promptKey = "system_prompt"
		}
		if data[promptKey], err = kind.extend(latest, jsString(tool["name"])); err != nil {
			return nil, err
		}
		if general && truthy(b["reception"]) {
			data["greeting_text"] = generalGreeting(rec)
		}
		bindings := []any{}
		existing, _ := get(latest, "agent_data", "tools").([]any)
		for _, t := range existing {
			if !jsSame(get(t, "tool_id"), tool["tool_id"]) {
				bindings = append(bindings, t)
			}
		}
		data["tools"] = append(bindings, obj{"tools_name": tool["name"], "tool_id": tool["tool_id"]})
		payload["agent_data"] = data
		if _, err := v.upstream("/agent/create_update_agent", payload, "PUT"); err != nil {
			return nil, err
		}
		verified, err := v.get("/agents/" + id)
		if err != nil {
			return nil, err
		}
		if setupRevision(verified) != setupRevision(payload) || kind.connected(verified, tools) == nil {
			return nil, fail(502, "บริการยังไม่ยืนยันการเชื่อม Agent กรุณาตรวจสถานะใหม่")
		}
		_, auditErr := service.Update("voice_agent_setup_audits", obj{"status": "connected", "tool_id": tool["tool_id"], "completed_at": nowISO()}, "", eq("id", operation))
		out := status(verified, tools)
		if auditErr != nil {
			out["warning"] = "เชื่อมสำเร็จ แต่บันทึกประวัติการแก้ไขไม่ครบ"
		}
		return out, nil
	}()
	if err != nil {
		if audited {
			cleanup.Update("voice_agent_setup_audits", obj{"status": "failed", "tool_id": orNull(get(tool, "tool_id")), "completed_at": nowISO()}, "", eq("id", operation))
		}
		release()
		return err
	}
	// Release the lock before answering, so an immediate status check does not see it held.
	release()
	return v.send(200, response)
}
