package main

// Port of scripts/test-agent-setup.mjs. The Node legacy admin path (no connection) is unreachable
// from /api/voice and was dropped, so every case here runs with a linked connection.

import (
	"os"
	"strings"
	"testing"
)

func check(t *testing.T, cond bool, format string, args ...any) {
	t.Helper()
	if !cond {
		t.Fatalf(format, args...)
	}
}

type setupFixture struct {
	*fixture
	agent   obj
	tools   []any
	options map[string]bool
	app     *App
	user    obj
}

const setupAgentID = "agt_fixture"

var setupUser = obj{"id": "11111111-1111-4111-8111-111111111111", "email": "admin@example.invalid", "email_confirmed_at": "confirmed"}

var setupEnv = map[string]string{"SUPABASE_URL": "https://setup-db.invalid", "SUPABASE_SERVICE_ROLE_KEY": "service-fixture",
	"VOICE_RESULT_CALLBACK_SECRET": "callback-fixture-secret-longer-than-32", "VOICE_RESULT_CALLBACK_URL": "https://receiver.invalid/api/voice-result"}

func newSetupFixture(t *testing.T) *setupFixture {
	s := &setupFixture{fixture: &fixture{t: t}, tools: []any{}, options: map[string]bool{}, user: setupUser}
	s.agent = obj{"agent_id": setupAgentID, "bot_name": "Fixture", "agent_data": obj{"system_instruction": "Original {{guest_name}}", "greeting_text": "Hello",
		"tools": []any{obj{"tool_id": "original_tool", "tools_name": "original_tool"}}, "model": "original_model"},
		"voice_data": obj{"voice": "original"}, "transfer": obj{"number": "original"}, "webhook": obj{"enabled": false}}
	s.fixture.serve = s.serve
	s.app = newApp(s.fixture, setupEnv)
	return s
}

func (s *setupFixture) serve(c call) reply {
	if c.Host == "setup-db.invalid" {
		check(s.t, c.Header.Get("apikey") == "service-fixture", "database call without service key")
		switch {
		case strings.HasSuffix(c.Path, "/rpc/acquire_voice_agent_setup"):
			if s.options["noMigration"] {
				return status(500, obj{"message": "fixture"})
			}
			return ok(!s.options["lockBusy"])
		case strings.HasSuffix(c.Path, "/voice_agent_setup_audits"):
			if s.options["auditFail"] && c.Method == "POST" {
				return status(500, obj{"message": "fixture"})
			}
			return status(204, nil)
		case strings.HasSuffix(c.Path, "/voice_agent_setup_locks"):
			return status(204, nil)
		}
	}
	if c.Host == "voice.invalid" {
		switch {
		case c.Path == "/me":
			return ok(obj{"_id": "account_fixture"})
		case c.Path == "/agents":
			return ok([]any{obj{"agent_id": setupAgentID, "name": "Fixture"}})
		case c.Path == "/agents/"+setupAgentID:
			if s.options["changeAfterCreate"] && len(s.tools) > 0 {
				s.agent["agent_data"].(obj)["system_instruction"] = "Concurrent edit"
			}
			return ok(clone(s.agent))
		case c.Path == "/platform-config/tools" && c.Method == "GET":
			return ok(clone(s.tools))
		case c.Path == "/platform-config/tools" && c.Method == "POST":
			if s.options["createTimeout"] {
				return networkFailure
			}
			saved := clone(c.Body).(obj)
			saved["tool_id"] = "tool_fixture"
			if len(s.tools) > 0 {
				saved["tool_id"] = "tool_fixture_" + jsString(float64(len(s.tools)))
			}
			saved["execution"].(obj)["auth"] = obj{"type": "bearer", "has_api_key": true}
			s.tools = append(s.tools, saved)
			return ok(saved)
		case c.Path == "/agent/create_update_agent" && c.Method == "PUT":
			if s.options["updateFail"] {
				return networkFailure
			}
			s.agent = clone(c.Body).(obj)
			return ok(obj{"success": true})
		}
	}
	s.t.Fatalf("unexpected call %s %s%s", c.Method, c.Host, c.Path)
	return reply{}
}

type setupCall struct {
	method              string
	body                obj
	user, conn          obj
	env                 map[string]string
	transcript, general bool
}

func (s *setupFixture) invoke(c setupCall) response {
	if c.method == "" {
		c.method = "POST"
	}
	body := obj{"confirm": true, "expected_revision": setupRevision(s.agent)}
	for k, v := range c.body {
		body[k] = v
	}
	user := c.user
	if user == nil {
		user = s.user
	}
	conn := c.conn
	if conn == nil {
		conn = obj{"owner_id": user["id"], "account_id": "account_fixture"}
	}
	a := s.app
	if c.env != nil {
		a = newApp(s.fixture, merge(setupEnv, c.env))
	}
	var payload any = body
	if c.method == "GET" {
		payload = nil
	}
	return direct(s.fixture, a, c.method, user, conn, func(v *voiceRequest) error {
		return v.handleAgentSetup(setupAgentID, payload, a.cfg, c.transcript, c.general)
	})
}

func (s *setupFixture) writes() int {
	return s.count(func(c call) bool { return c.Host == "voice.invalid" && c.Method != "GET" })
}

func (s *setupFixture) db(suffix, method string) *call {
	return s.find(func(c call) bool {
		return c.Host == "setup-db.invalid" && strings.HasSuffix(c.Path, suffix) && c.Method == method
	})
}

func (s *setupFixture) logIndex(entry string) int {
	for i, e := range s.log {
		if e == entry {
			return i
		}
	}
	return -1
}

func TestAgentSetup(t *testing.T) {
	run := func(name string, fn func(t *testing.T, s *setupFixture)) {
		t.Run(name, func(t *testing.T) { fn(t, newSetupFixture(t)) })
	}
	run("Members may read status but never configure another owner's account", func(t *testing.T, s *setupFixture) {
		other := obj{"owner_id": "other_owner", "account_id": "account_fixture"}
		r := s.invoke(setupCall{method: "GET", conn: other})
		check(t, r.status == 200 && r.data["can_manage"] == false && r.data["connected"] == false, "GET = %d %v", r.status, r.data)
		check(t, s.db("", "POST") == nil, "GET touched the database")
		s.reset()
		check(t, s.invoke(setupCall{conn: other}).status == 403, "POST allowed")
		check(t, len(s.calls) == 0, "calls made before refusal")
	})
	run("Unconfirmed email cannot configure", func(t *testing.T, s *setupFixture) {
		user := obj{"id": setupUser["id"], "email": "admin@example.invalid", "email_confirmed_at": nil}
		check(t, s.invoke(setupCall{user: user}).status == 403, "unconfirmed user allowed")
	})
	run("Confirmation and revision are required; arbitrary endpoint and secrets rejected", func(t *testing.T, s *setupFixture) {
		for _, body := range []obj{{"confirm": false}, {"expected_revision": ""}, {"endpoint": "https://evil.invalid"}, {"api_key": "forged"}} {
			check(t, s.invoke(setupCall{body: body}).status == 400, "body %v accepted", body)
			check(t, s.writes() == 0, "writes after %v", body)
		}
	})
	run("Configuration fails closed before mutations", func(t *testing.T, s *setupFixture) {
		for _, env := range []map[string]string{{"VOICE_RESULT_CALLBACK_SECRET": ""}, {"VOICE_RESULT_CALLBACK_URL": "http://receiver.invalid/api/voice-result"},
			{"VOICE_RESULT_CALLBACK_URL": "https://receiver.invalid/api/voice-result?secret=bad"}, {"SUPABASE_SERVICE_ROLE_KEY": ""}} {
			check(t, s.invoke(setupCall{env: env}).status == 503, "env %v not refused", env)
			check(t, s.writes() == 0, "writes with env %v", env)
		}
	})
	run("Stale preview cannot modify shared agents", func(t *testing.T, s *setupFixture) {
		check(t, s.invoke(setupCall{body: obj{"expected_revision": strings.Repeat("0", 64)}}).status == 409, "stale revision accepted")
		check(t, s.writes() == 0, "writes")
	})
	run("Missing database migration and busy lock prevent any external mutation", func(t *testing.T, s *setupFixture) {
		s.options["noMigration"] = true
		check(t, s.invoke(setupCall{}).status == 503, "missing migration not 503")
		s.options["noMigration"], s.options["lockBusy"] = false, true
		check(t, s.invoke(setupCall{}).status == 409, "busy lock not 409")
		check(t, s.writes() == 0, "writes")
	})
	run("Backup failure stops tool creation and releases lock", func(t *testing.T, s *setupFixture) {
		s.options["auditFail"] = true
		check(t, s.invoke(setupCall{}).status == 503, "audit failure not 503")
		check(t, s.writes() == 0, "writes")
		check(t, s.db("voice_agent_setup_locks", "DELETE") != nil, "lock not released")
	})
	run("Connect creates typed body parameters and preserves prior Agent configuration", func(t *testing.T, s *setupFixture) {
		original := clone(s.agent).(obj)
		r := s.invoke(setupCall{})
		check(t, r.status == 200 && r.data["connected"] == true, "connect = %d %v", r.status, r.data)
		prompt := strOr(get(s.agent, "agent_data", "system_instruction"))
		check(t, strings.HasPrefix(prompt, strOr(get(original, "agent_data", "system_instruction"))) && strings.Contains(prompt, "{{vc_call_reference}}"), "prompt %q", prompt)
		for _, k := range []string{"voice_data", "transfer", "webhook"} {
			check(t, canon(s.agent[k]) == canon(original[k]), "%s changed", k)
		}
		check(t, get(s.agent, "agent_data", "model") == "original_model", "model changed")
		check(t, canon(get(s.agent, "agent_data", "tools").([]any)[0]) == canon(get(original, "agent_data", "tools").([]any)[0]), "existing tool binding changed")
		tool := s.tools[0]
		check(t, get(tool, "parameters", "properties", "needs_agent", "type") == "boolean", "needs_agent type")
		check(t, canon(get(tool, "parameters", "properties", "agent_id", "enum")) == `["agt_fixture"]`, "agent_id enum")
		for _, k := range get(tool, "parameters", "required").([]any) {
			check(t, get(tool, "execution", "param_map", k.(string), "in") == "body", "param %v not in body", k)
		}
		backup := s.db("voice_agent_setup_audits", "POST")
		check(t, backup != nil && canon(get(backup.Body, "before_config")) == canon(original), "backup missing or wrong")
		check(t, s.logIndex("POST setup-db.invalid/rest/v1/voice_agent_setup_audits") < s.logIndex("POST voice.invalid/platform-config/tools"), "backup after tool creation")
		check(t, !strings.Contains(string(r.raw), setupEnv["VOICE_RESULT_CALLBACK_SECRET"]) && !strings.Contains(string(r.raw), "Original"), "response leaks secret or prompt")
	})
	run("Repeated connect is idempotent and does not create tools or append instructions twice", func(t *testing.T, s *setupFixture) {
		s.invoke(setupCall{})
		previous := canon(s.agent)
		s.reset()
		r := s.invoke(setupCall{})
		check(t, r.status == 200 && r.data["already_connected"] == true, "second connect = %d %v", r.status, r.data)
		check(t, s.writes() == 0 && canon(s.agent) == previous, "second connect changed the agent")
	})
	run("Existing compatible Tool is reused when restoring an unbound Agent", func(t *testing.T, s *setupFixture) {
		s.invoke(setupCall{})
		s.agent["agent_data"].(obj)["system_instruction"] = "Original"
		s.agent["agent_data"].(obj)["tools"] = []any{}
		s.reset()
		check(t, s.invoke(setupCall{}).status == 200, "restore failed")
		check(t, s.count(func(c call) bool { return c.Path == "/platform-config/tools" && c.Method == "POST" }) == 0 && len(s.tools) == 1, "tool recreated")
	})
	run("Conflicting Tool name is rejected without overwriting external tools", func(t *testing.T, s *setupFixture) {
		s.tools = []any{obj{"name": "vc_result_v2_fixture", "tool_id": "unrelated", "execution": obj{"endpoint": "https://unrelated.invalid"}}}
		check(t, s.invoke(setupCall{}).status == 409, "conflict not 409")
		check(t, s.writes() == 0, "writes")
	})
	run("Concurrent edit after creating Tool prevents Agent overwrite", func(t *testing.T, s *setupFixture) {
		s.options["changeAfterCreate"] = true
		check(t, s.invoke(setupCall{}).status == 409, "concurrent edit not 409")
		check(t, s.count(func(c call) bool { return c.Path == "/agent/create_update_agent" }) == 0, "agent overwritten")
		check(t, get(s.agent, "agent_data", "system_instruction") == "Concurrent edit", "edit lost")
	})
	run("Failed agent update is recoverable using stored Tool and backup", func(t *testing.T, s *setupFixture) {
		s.options["updateFail"] = true
		check(t, s.invoke(setupCall{}).status == 502, "update failure not 502")
		check(t, len(s.tools) == 1, "tool not stored")
		check(t, s.find(func(c call) bool {
			return strings.HasSuffix(c.Path, "voice_agent_setup_audits") && get(c.Body, "status") == "failed"
		}) != nil, "audit not marked failed")
		s.options["updateFail"] = false
		check(t, s.invoke(setupCall{}).status == 200 && len(s.tools) == 1, "retry failed or duplicated tool")
	})
	run("Tool creation timeout is never blindly retried and lock is released", func(t *testing.T, s *setupFixture) {
		s.options["createTimeout"] = true
		check(t, s.invoke(setupCall{}).status == 502, "timeout not 502")
		check(t, s.count(func(c call) bool { return c.Path == "/platform-config/tools" && c.Method == "POST" }) == 1, "creation retried")
		check(t, s.db("voice_agent_setup_locks", "DELETE") != nil, "lock not released")
	})
	run("Malformed managed block fails before any external mutation", func(t *testing.T, s *setupFixture) {
		s.agent["agent_data"].(obj)["system_instruction"] = "Original {{guest_name}}[VOICE_CONFIRM_RESULT_SETUP_V1]"
		check(t, s.invoke(setupCall{}).status == 409 && s.writes() == 0, "malformed block accepted")
	})
	run("Write-only webhook credentials are never silently cleared", func(t *testing.T, s *setupFixture) {
		s.agent["webhook"] = obj{"enabled": true, "auth": obj{"type": "bearer", "has_api_key": true}}
		check(t, s.invoke(setupCall{}).status == 409 && s.writes() == 0, "write-only webhook overwritten")
	})
	run("Response starts only after the setup lock is released", func(t *testing.T, s *setupFixture) {
		check(t, s.invoke(setupCall{}).status == 200, "connect failed")
		released, sent := s.logIndex("DELETE setup-db.invalid/rest/v1/voice_agent_setup_locks"), s.logIndex("response")
		check(t, released >= 0 && sent > released, "lock released at %d, response at %d", released, sent)
	})
	run("A linked member configures only their own account with scoped audits and locks", func(t *testing.T, s *setupFixture) {
		member := obj{"id": setupUser["id"], "email": "member@example.invalid", "email_confirmed_at": "confirmed"}
		r := s.invoke(setupCall{user: member})
		check(t, r.status == 200 && r.data["can_manage"] == true && r.data["connected"] == true, "member connect = %d %v", r.status, r.data)
		check(t, get(s.tools[0], "name") == "vc_result_v2_fixture" && strings.Contains(strOr(get(s.tools[0], "description")), "Voice Confirm account:account_fixture v2"), "tool not account scoped")
		check(t, get(s.db("/rpc/acquire_voice_agent_setup", "POST").Body, "p_account_id") == "account_fixture", "lock not account scoped")
		check(t, get(s.db("/voice_agent_setup_audits", "POST").Body, "account_id") == "account_fixture", "audit not account scoped")
		check(t, s.db("voice_agent_setup_locks", "DELETE").Query.Get("account_id") == "eq.account_fixture", "lock release not account scoped")
	})
	run("Opt-in transcript setup creates a separate guarded tool and reuses it on retry", func(t *testing.T, s *setupFixture) {
		original := strOr(get(s.agent, "agent_data", "system_instruction"))
		r := s.invoke(setupCall{transcript: true})
		check(t, r.status == 200 && r.data["connected"] == true, "transcript connect = %d %v", r.status, r.data)
		check(t, canon(get(s.tools[0], "parameters", "required")) == `["request_id","agent_id","transcript"]`, "transcript fields")
		prompt := strOr(get(s.agent, "agent_data", "system_instruction"))
		check(t, strings.Contains(prompt, "{{vc_record_conversation}}") && strings.HasPrefix(prompt, original), "transcript prompt %q", prompt)
		before := canon(s.agent)
		s.reset()
		check(t, s.invoke(setupCall{transcript: true}).data["already_connected"] == true, "retry not idempotent")
		check(t, s.writes() == 0 && canon(s.agent) == before, "retry changed agent")
	})
	run("Result and transcript tools coexist without replacing either instruction block", func(t *testing.T, s *setupFixture) {
		s.invoke(setupCall{})
		check(t, s.invoke(setupCall{transcript: true}).status == 200, "transcript after result failed")
		prompt := strOr(get(s.agent, "agent_data", "system_instruction"))
		check(t, len(s.tools) == 2 && strings.Contains(prompt, resultStart) && strings.Contains(prompt, transcriptStart), "blocks replaced")
		check(t, s.invoke(setupCall{method: "GET"}).data["connected"] == true, "result not connected")
		check(t, s.invoke(setupCall{method: "GET", transcript: true}).data["connected"] == true, "transcript not connected")
	})
	run("General event setup uses a separate scoped tool and supports system_prompt agents", func(t *testing.T, s *setupFixture) {
		data := s.agent["agent_data"].(obj)
		data["system_prompt"] = "Original support instructions"
		delete(data, "system_instruction")
		r := s.invoke(setupCall{general: true})
		check(t, r.status == 200 && r.data["connected"] == true, "general connect = %d %v", r.status, r.data)
		prompt := strOr(get(s.agent, "agent_data", "system_prompt"))
		check(t, strings.Contains(prompt, "VOICE_CONFIRM_GENERAL_EVENTS_V1") && strings.Contains(prompt, "ไม่ต้องถามเบอร์"), "general prompt %q", prompt)
		check(t, !has(get(s.agent, "agent_data"), "system_instruction"), "system_instruction added")
		check(t, get(s.tools[0], "execution", "endpoint") == "https://receiver.invalid/api/voice-events", "endpoint")
		check(t, canon(get(s.tools[0], "parameters", "required")) == `["query","event_id"]`, "general fields")
		created := s.find(func(c call) bool { return c.Path == "/platform-config/tools" && c.Method == "POST" })
		check(t, !strings.Contains(string(r.raw), strOr(get(created.Body, "execution", "auth", "api_key"))), "response leaks credential")
	})
	run("General event setup rejects stale account identity before creating a tool", func(t *testing.T, s *setupFixture) {
		r := s.invoke(setupCall{general: true, conn: obj{"owner_id": setupUser["id"], "account_id": "different"}})
		check(t, r.status == 403 && s.writes() == 0, "stale account = %d", r.status)
	})
	run("Connected receptionist can update confirmed company facts without duplicating tools", func(t *testing.T, s *setupFixture) {
		check(t, s.invoke(setupCall{general: true}).status == 200, "general connect failed")
		before := clone(s.agent).(obj)
		reception := obj{"company_name": "ไอบอทน้อย จำกัด", "support_phone": "064-192-2433"}
		s.reset()
		r := s.invoke(setupCall{general: true, body: obj{"reception": reception}})
		check(t, r.status == 200, "update = %d %v", r.status, r.data)
		check(t, canon(r.data["reception"]) == canon(obj{"company_name": "ไอบอทน้อย จำกัด", "support_phone": "0641922433", "company_details": ""}), "reception %v", r.data["reception"])
		check(t, strings.Contains(strOr(get(s.agent, "agent_data", "greeting_text")), "ไอบอทน้อย จำกัด"), "greeting not updated")
		check(t, canon(s.agent["transfer"]) == canon(before["transfer"]) && canon(s.agent["voice_data"]) == canon(before["voice_data"]), "unrelated config changed")
		check(t, len(s.tools) == 1 && s.count(func(c call) bool { return c.Path == "/platform-config/tools" && c.Method == "POST" }) == 0, "tool duplicated")
		check(t, canon(get(s.db("/voice_agent_setup_audits", "POST").Body, "before_config")) == canon(before), "backup wrong")
		s.reset()
		check(t, s.invoke(setupCall{general: true, body: obj{"reception": reception}}).data["already_connected"] == true, "repeat not idempotent")
		check(t, s.writes() == 0, "repeat wrote")
	})
	run("Invalid receptionist profile fails before upstream mutations", func(t *testing.T, s *setupFixture) {
		r := s.invoke(setupCall{general: true, body: obj{"reception": obj{"company_name": "Fixture", "support_phone": "bad"}}})
		check(t, r.status == 400 && s.writes() == 0, "invalid phone = %d", r.status)
		check(t, s.invoke(setupCall{body: obj{"reception": obj{"company_name": "Fixture", "support_phone": ""}}}).status == 400, "reception accepted outside general setup")
	})
}

// TestAgentSetupGolden compares the tool and prompt each setup kind writes with the Node output.
func TestAgentSetupGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/node_setup_flows.json")
	check(t, err == nil, "read flows: %v", err)
	decoded, _ := decodeJSON(raw)
	golden := decoded.(obj)
	for _, kind := range []string{"result", "transcript", "general"} {
		s := newSetupFixture(t)
		r := s.invoke(setupCall{transcript: kind == "transcript", general: kind == "general"})
		check(t, r.status == 200, "%s connect = %d %v", kind, r.status, r.data)
		created := s.find(func(c call) bool { return c.Path == "/platform-config/tools" && c.Method == "POST" })
		put := s.find(func(c call) bool { return c.Path == "/agent/create_update_agent" })
		want := golden[kind].(obj)
		check(t, canon(created.Body) == canon(want["tool"]), "%s tool differs:\n got %s\nwant %s", kind, canon(created.Body), canon(want["tool"]))
		check(t, canon(put.Body) == canon(want["put"]), "%s agent update differs:\n got %s\nwant %s", kind, canon(put.Body), canon(want["put"]))
		check(t, canon(r.data) == canon(want["response"]), "%s response differs:\n got %s\nwant %s", kind, canon(r.data), canon(want["response"]))
	}
}
