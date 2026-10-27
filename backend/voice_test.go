package main

// Port of scripts/test-backend.mjs: /api/voice access control, routing and the call path.

import (
	"context"
	"encoding/base64"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

const fixtureUser = "11111111-1111-4111-8111-111111111111"

var fixtureKey = base64.StdEncoding.EncodeToString([]byte(strings.Repeat("\x07", 32)))

var backendEnv = map[string]string{"VITE_SUPABASE_URL": "https://supabase.invalid", "VITE_SUPABASE_PUBLISHABLE_KEY": "test-key", "SUPABASE_SERVICE_ROLE_KEY": "fixture-role",
	"VOICE_CONNECTION_ENCRYPTION_KEY": fixtureKey, "VOICE_BOT_BASE_URL": "https://voice.invalid", "VOICE_ALLOWED_USER_IDS": fixtureUser, "VOICE_ACCESS_MODE": "allowlist"}

var receiverEnv = map[string]string{"VOICE_RESULT_CALLBACK_URL": "https://receiver.invalid/api/voice-result", "VOICE_RESULT_CALLBACK_SECRET": "fixture-callback-secret-longer-than-32"}

const callPath = "/v1/provisioning/tenants/tenant_fixture/calls"

// backendFixture mirrors the fetch stub in scripts/test-backend.mjs.
type backendFixture struct {
	*fixture
	opt map[string]any
}

func (b *backendFixture) on(key string) bool { return truthy(b.opt[key]) }

func receiverTool() obj {
	fields := []string{"request_id", "agent_id", "call_result", "needs_agent", "evidence"}
	return obj{"name": "vc_result_v2_fixture", "tool_id": "tool_fixture", "description": "Voice Confirm account:tenant_fixture v2", "status": "active", "tool_type": "http",
		"execution": obj{"method": "POST", "endpoint": "https://receiver.invalid/api/voice-result", "auth": obj{"type": "bearer", "has_api_key": true}, "param_map": bodyParamMap(fields...)},
		"parameters": obj{"type": "object", "required": toAny(fields), "properties": obj{"request_id": obj{"type": "string"}, "agent_id": obj{"type": "string", "enum": []any{"agt_fixture"}},
			"call_result": obj{"type": "string", "enum": toAny(setupOutcomes)}, "needs_agent": obj{"type": "boolean"}, "evidence": obj{"type": "string"}}}}
}

func newBackendFixture(t *testing.T) *backendFixture {
	b := &backendFixture{fixture: &fixture{t: t}, opt: map[string]any{}}
	b.serve = b.reply
	return b
}

func (b *backendFixture) connection() obj {
	sealed, err := sealToken("server-secret-fixture", fixtureUser, fixtureKey)
	check(b.t, err == nil, "seal: %v", err)
	var expires any
	if b.on("expired") {
		expires = "2000-01-01T00:00:00Z"
	}
	return obj{"owner_id": fixtureUser, "account_id": "tenant_fixture", "token_ciphertext": sealed, "expires_at": expires, "updated_at": "2026-01-01T00:00:00Z"}
}

func (b *backendFixture) reply(c call) reply {
	if c.Host == "supabase.invalid" {
		switch {
		case c.Path == "/auth/v1/user":
			if b.on("invalidSession") {
				return status(401, obj{"message": "invalid"})
			}
			var confirmed any = "2026-01-01"
			if b.on("unconfirmed") {
				confirmed = nil
			}
			user := obj{"id": fixtureUser, "email": "fixture@example.invalid", "email_confirmed_at": confirmed, "app_metadata": obj{"role": "dev"}}
			if b.on("normalUser") {
				// A self-written user_metadata role must not grant dev access.
				user["app_metadata"], user["user_metadata"] = obj{}, obj{"role": "dev"}
			}
			return ok(user)
		case strings.HasSuffix(c.Path, "/voice_bot_connections"):
			check(b.t, c.Query.Get("owner_id") == "eq."+fixtureUser, "connection query not scoped")
			if b.on("noConnection") {
				return ok(nil)
			}
			return ok(b.connection())
		case strings.HasSuffix(c.Path, "/rpc/reserve_voice_call"), strings.HasSuffix(c.Path, "/rpc/reserve_scheduled_voice_call"):
			if message, set := b.opt["reserveError"].(string); set {
				return status(400, obj{"message": message, "code": "P0001"})
			}
			return ok(nil)
		case strings.HasSuffix(c.Path, "/voice_campaigns"):
			if b.on("noCampaign") {
				return ok(nil)
			}
			data := b.opt["campaign"]
			if data == nil {
				data = obj{"csv": obj{"rows": []any{[]any{"Fixture"}}}}
			}
			return ok(obj{"id": fixtureUser, "data": clone(data), "updated_at": "version-1"})
		case strings.HasSuffix(c.Path, "/voice_campaign_jobs"):
			if b.on("activeJob") {
				return ok([]any{obj{"id": "active"}})
			}
			return ok([]any{})
		case strings.HasSuffix(c.Path, "/voice_call_requests"):
			if c.Method == "GET" {
				if c.Query.Has("metadata->>contact_row") {
					return ok(b.opt["lastAttempt"])
				}
				if b.on("foreignHistory") {
					return ok(obj{"id": fixtureUser})
				}
				return ok(nil)
			}
			if b.on("persistError") {
				return status(500, obj{"message": "failed"})
			}
			return status(204, nil)
		}
	}
	if c.Host == "voice.invalid" {
		check(b.t, c.Header.Get("Authorization") == "Bearer server-secret-fixture", "voice call without the stored token")
		if b.on("invalidVoiceToken") {
			return status(401, obj{"message": "invalid"})
		}
		switch {
		case c.Path == "/me":
			return ok(obj{"_id": "tenant_fixture", "username": "fixture", "access_token": "hidden", "password": "hidden"})
		case c.Path == "/agents":
			return ok([]any{obj{"agent_id": "agt_fixture", "name": "Fixture"}})
		case c.Path == "/platform-config/tools":
			tools := []any{}
			if b.on("connectedReceiver") {
				tools = append(tools, receiverTool())
			}
			if b.on("transcriptConnected") {
				tool := transcriptToolPayload("agt_fixture", "", "https://receiver.invalid/api/voice-result", "tenant_fixture")
				tool["tool_id"] = "tool_transcript"
				tool["execution"].(obj)["auth"] = obj{"type": "bearer", "has_api_key": true}
				tools = append(tools, clone(tool))
			}
			return ok(tools)
		case c.Path == "/agents/agt_fixture":
			prompt, _ := b.opt["prompt"].(string)
			if prompt == "" {
				prompt = "Hello {{guest_name}}"
			}
			instruction, bindings := "Base prompt", []any{}
			if b.on("connectedReceiver") {
				instruction = "Use {{vc_call_reference}} with vc_result_v2_fixture and agt_fixture"
				bindings = []any{obj{"tool_id": "tool_fixture", "tools_name": "vc_result_v2_fixture"}}
			}
			agent := obj{"agent_id": "agt_fixture", "bot_name": "Fixture", "agent_data": obj{"greeting_text": prompt, "system_instruction": instruction, "tools": bindings, "api_key": "hidden"}}
			if b.on("transcriptConnected") {
				extended, err := withTranscriptPrompt(agent, "vc_transcript_v1_fixture")
				check(b.t, err == nil, "bad fixture: %v", err)
				data := agent["agent_data"].(obj)
				data["system_instruction"] = extended
				data["tools"] = append(bindings, obj{"tool_id": "tool_transcript", "tools_name": "vc_transcript_v1_fixture"})
			}
			return ok(agent)
		case strings.HasSuffix(c.Path, "/calls") && c.Method == "POST":
			if b.on("timeout") {
				return networkFailure
			}
			return ok(obj{"call_id": "oc_fixture", "status": "queued"})
		case strings.HasPrefix(c.Path, "/logs"):
			return ok(obj{"items": []any{}})
		}
	}
	b.t.Fatalf("unexpected offline call %s %s%s", c.Method, c.Host, c.Path)
	return reply{}
}

type voiceCall struct {
	headers map[string]string
	env     map[string]string
	worker  *worker
}

// invoke sends /api/voice?path=... like the Node test: a nil body is a GET, a string is sent raw.
func (b *backendFixture) invoke(path string, body any, extra ...voiceCall) response {
	var x voiceCall
	if len(extra) > 0 {
		x = extra[0]
	}
	a := newApp(b.fixture, merge(backendEnv, x.env))
	if x.worker != nil {
		x.worker.db = a.serviceDB(context.Background())
		rec := httptest.NewRecorder()
		a.handleVoice(rec, nil, path, x.worker, context.Background(), roundJSON(body))
		out := response{status: rec.Code, header: rec.Header(), raw: rec.Body.Bytes()}
		decoded, _ := decodeJSON(out.raw)
		out.data, _ = decoded.(obj)
		return out
	}
	headers := map[string]string{"Authorization": "Bearer fixture-session"}
	for k, v := range x.headers {
		headers[k] = v
	}
	method, raw := "GET", ""
	if body != nil {
		method = "POST"
		if s, isString := body.(string); isString {
			raw = s
		} else {
			raw = jsonBody(body)
		}
	}
	return serveHTTP(a, method, "/event-confirm/api/voice?path="+url.QueryEscape(path), headers, raw)
}

func (b *backendFixture) dials() []call {
	var out []call
	for _, c := range b.calls {
		if c.Host == "voice.invalid" && c.Method == "POST" {
			out = append(out, c)
		}
	}
	return out
}

func (b *backendFixture) voiceCalls() int {
	return b.count(func(c call) bool { return c.Host == "voice.invalid" })
}

func (b *backendFixture) last() call { return b.calls[len(b.calls)-1] }

func callPayload() obj {
	return obj{"destination": "0812345678", "agent_id": "agt_fixture", "request_id": "22222222-2222-4222-8222-222222222222", "consent": true,
		"metadata": obj{"variables": obj{"guest_name": "Fixture"}}}
}

func with(base obj, changes obj) obj {
	out := clone(base).(obj)
	for k, v := range changes {
		out[k] = v
	}
	return out
}

func csvCampaign() obj {
	return obj{"agentId": "agt_fixture", "csv": obj{"headers": []any{"name", "phone"}, "rows": []any{[]any{"CSV One", "0812345678"}, []any{"CSV Two", "0898765432"}}},
		"mapping": obj{"phone": "phone"}, "variableBindings": obj{"guest_name": obj{"source": "csv", "column": "name"}, "call_result": obj{"source": "output"}}}
}

var batchID = campaignRequestID(fixtureUser, "version-1", 1, "")

func batchPayload() obj {
	return with(callPayload(), obj{"request_id": batchID, "metadata": obj{"campaign_id": fixtureUser, "contact_row": 1, "campaign_batch": true, "campaign_version": "version-1",
		"variables": obj{"guest_name": "browser override"}}})
}

func meta(p obj) obj { return p["metadata"].(obj) }

func TestVoiceAPI(t *testing.T) {
	run := func(name string, fn func(t *testing.T, b *backendFixture)) {
		t.Run(name, func(t *testing.T) { fn(t, newBackendFixture(t)) })
	}
	statusOf := func(r response) int { return r.status }
	run("Missing configuration fails closed", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke("/me", nil, voiceCall{env: map[string]string{"VOICE_CONNECTION_ENCRYPTION_KEY": ""}}).status == 503, "not 503")
	})
	run("Unauthenticated request is rejected before upstream calls", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke("/me", nil, voiceCall{headers: map[string]string{"Authorization": ""}}).status == 401 && len(b.calls) == 0, "not 401 or calls made")
	})
	run("Invalid session is rejected", func(t *testing.T, b *backendFixture) {
		b.opt["invalidSession"] = true
		check(t, b.invoke("/me", nil).status == 401, "not 401")
	})
	run("Empty allowlists deny authenticated users", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke("/me", nil, voiceCall{env: map[string]string{"VOICE_ALLOWED_USER_IDS": ""}}).status == 403, "not 403")
	})
	run("Unconfirmed email is not granted access", func(t *testing.T, b *backendFixture) {
		b.opt["unconfirmed"] = true
		check(t, b.invoke("/me", nil, voiceCall{env: map[string]string{"VOICE_ALLOWED_USER_IDS": "", "VOICE_ALLOWED_EMAILS": "fixture@example.invalid"}}).status == 403, "not 403")
	})
	run("Confirmed email allowlist permits access and response excludes secrets", func(t *testing.T, b *backendFixture) {
		r := b.invoke("/me", nil, voiceCall{env: map[string]string{"VOICE_ALLOWED_USER_IDS": "", "VOICE_ALLOWED_EMAILS": "FIXTURE@example.invalid"}})
		check(t, r.status == 200 && !has(r.data, "access_token") && r.header.Get("Cache-Control") == "no-store", "= %d %v %v", r.status, r.data, r.header)
	})
	run("Member mode permits a confirmed account without an allowlist entry", func(t *testing.T, b *backendFixture) {
		r := b.invoke("/agents", nil, voiceCall{env: map[string]string{"VOICE_ACCESS_MODE": "members", "VOICE_ALLOWED_USER_IDS": "", "VOICE_ALLOWED_EMAILS": ""}})
		list, _ := decodeJSON(r.raw)
		check(t, r.status == 200 && get(list.([]any)[0], "agent_id") == "agt_fixture", "= %d %s", r.status, r.raw)
	})
	run("Default mode permits confirmed members despite an unrelated legacy allowlist", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke("/me", nil, voiceCall{env: map[string]string{"VOICE_ACCESS_MODE": "", "VOICE_ALLOWED_USER_IDS": "other", "VOICE_ALLOWED_EMAILS": "other@example.invalid"}}).status == 200, "not 200")
	})
	run("Member mode rejects unconfirmed email before calling Voice Bot", func(t *testing.T, b *backendFixture) {
		b.opt["unconfirmed"] = true
		check(t, b.invoke("/agents", nil, voiceCall{env: map[string]string{"VOICE_ACCESS_MODE": "members"}}).status == 403 && b.voiceCalls() == 0, "not refused")
	})
	run("Member mode still rejects invalid sessions", func(t *testing.T, b *backendFixture) {
		b.opt["invalidSession"] = true
		check(t, b.invoke("/agents", nil, voiceCall{env: map[string]string{"VOICE_ACCESS_MODE": "members"}}).status == 401, "not 401")
	})
	run("Unknown access mode fails closed", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke("/me", nil, voiceCall{env: map[string]string{"VOICE_ACCESS_MODE": "typo"}}).status == 503, "not 503")
	})
	run("Absolute URLs and encoded slash attacks rejected", func(t *testing.T, b *backendFixture) {
		for _, p := range []string{"https://evil.invalid", "//evil.invalid", "/agents/%2Fme", "/../me"} {
			check(t, b.invoke(p, nil).status == 400, "%s accepted", p)
		}
	})
	run("Admin and credential endpoints unavailable", func(t *testing.T, b *backendFixture) {
		for _, p := range []string{"/me/connector-credentials", "/delete-user", "/v1/provisioning/tenants/tenant_fixture/trunk/password"} {
			check(t, b.invoke(p, nil).status == 405, "%s allowed", p)
		}
	})
	run("Tenant mismatch is forbidden", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke("/v1/provisioning/tenants/other/overview", nil).status == 403, "not 403")
	})
	run("Agent mismatch is forbidden", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke("/agents/agt_other", nil).status == 403, "not 403")
	})
	run("Query tokens are rejected; log limit capped", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke("/me?token=foo", nil).status == 400, "token query accepted")
		check(t, b.invoke("/logs/call_logs_platform?limit=10000", nil).status == 200, "logs failed")
		check(t, b.last().Query.Get("limit") == "100", "limit %q", b.last().Query.Get("limit"))
	})
	run("Secret fields nested inside Agent config are removed", func(t *testing.T, b *backendFixture) {
		r := b.invoke("/agents/agt_fixture", nil)
		check(t, r.status == 200 && !has(get(r.data, "agent_data"), "api_key"), "= %d %v", r.status, r.data)
	})
	run("Setup is available only for linked account; direct arbitrary writes remain denied", func(t *testing.T, b *backendFixture) {
		r := b.invoke("/workspace/agents/agt_fixture/result-setup", nil, voiceCall{env: map[string]string{"VOICE_RESULT_CALLBACK_SECRET": "fixture-callback-secret-longer-than-32"}})
		check(t, r.status == 200 && r.data["can_manage"] == true && r.data["connected"] == false && !strings.Contains(string(r.raw), "hidden"), "= %d %s", r.status, r.raw)
		for _, route := range []string{"/platform-config/tools", "/agent/create_update_agent"} {
			check(t, b.invoke(route, obj{}).status == 405, "%s allowed", route)
		}
	})
	run("Unlinked setup and cross-site setup cannot change Voice Bot", func(t *testing.T, b *backendFixture) {
		path := "/workspace/agents/agt_fixture/result-setup"
		b.opt["noConnection"] = true
		check(t, b.invoke(path, obj{"confirm": true, "expected_revision": strings.Repeat("0", 64)}).status == 428, "unlinked not 428")
		check(t, b.invoke(path, obj{}, voiceCall{headers: map[string]string{"Sec-Fetch-Site": "cross-site"}}).status == 403, "cross-site allowed")
		check(t, b.voiceCalls() == 0, "Voice Bot called")
	})
	run("Foreign Agent setup status is denied without reading its configuration", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke("/workspace/agents/agt_other/result-setup", nil).status == 403, "not 403")
		check(t, b.count(func(c call) bool { return c.Path == "/agents/agt_other" }) == 0, "foreign agent read")
	})
	run("Normal users cannot use dev-only controls or test calls", func(t *testing.T, b *backendFixture) {
		b.opt["normalUser"] = true
		for _, c := range []struct {
			route string
			body  any
		}{{"/workspace/agents/agt_fixture/preview-token", obj{}}, {"/workspace/agents/agt_fixture/result-setup", nil},
			{"/workspace/agents/agt_fixture/general-setup", obj{}}, {"/workspace/connection", nil}, {"/workspace/inbound/bind", obj{}}, {callPath, callPayload()}} {
			check(t, b.invoke(c.route, c.body).status == 403, "%s allowed for normal user", c.route)
		}
		check(t, len(b.dials()) == 0, "normal user dialed")
		check(t, b.invoke("/agents", nil).status == 200, "normal user cannot list Agents")
	})
	run("Missing consent prevents dial", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke(callPath, with(callPayload(), obj{"consent": false})).status == 400 && len(b.dials()) == 0, "dialed")
	})
	run("Invalid phone, missing variable and foreign agent prevent dial", func(t *testing.T, b *backendFixture) {
		for _, p := range []obj{with(callPayload(), obj{"destination": "invalid"}), with(callPayload(), obj{"metadata": obj{"variables": obj{}}}), with(callPayload(), obj{"agent_id": "other"})} {
			check(t, b.invoke(callPath, p).status == 400, "%v accepted", p)
		}
		check(t, len(b.dials()) == 0, "dialed")
	})
	run("Foreign campaign is forbidden", func(t *testing.T, b *backendFixture) {
		b.opt["noCampaign"] = true
		p := callPayload()
		meta(p)["campaign_id"] = fixtureUser
		check(t, b.invoke(callPath, p).status == 403 && len(b.dials()) == 0, "not refused")
	})
	run("Rate limit and duplicate reservation prevent dial", func(t *testing.T, b *backendFixture) {
		b.opt["reserveError"] = "rate_limit"
		check(t, b.invoke(callPath, callPayload()).status == 429, "rate limit not 429")
		b.opt["reserveError"] = "duplicate key"
		check(t, b.invoke(callPath, callPayload()).status == 409, "duplicate not 409")
		check(t, len(b.dials()) == 0, "dialed")
	})
	run("Accepted call reserves ID before dial and persists Call ID", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke(callPath, callPayload()).status == 200 && len(b.dials()) == 1, "dial failed")
		reserve, dial := -1, -1
		for i, c := range b.calls {
			if strings.HasSuffix(c.Path, "/reserve_voice_call") && reserve < 0 {
				reserve = i
			}
			if strings.HasSuffix(c.Path, "/calls") && dial < 0 {
				dial = i
			}
		}
		check(t, reserve >= 0 && reserve < dial, "reserve %d dial %d", reserve, dial)
		check(t, get(b.dials()[0].Body, "metadata", "variables", "guest_name") == "Fixture", "variables not sent")
		check(t, get(b.last().Body, "call_id") == "oc_fixture", "call ID not persisted")
	})
	run("Timeout marks request unknown and never retries the dial", func(t *testing.T, b *backendFixture) {
		b.opt["timeout"] = true
		check(t, b.invoke(callPath, callPayload()).status == 502 && len(b.dials()) == 1, "retried or wrong status")
		check(t, get(b.last().Body, "status") == "unknown", "not marked unknown")
	})
	run("Persistence failure preserves successful Call ID with warning", func(t *testing.T, b *backendFixture) {
		b.opt["persistError"] = true
		r := b.invoke(callPath, callPayload())
		check(t, r.status == 200 && r.data["call_id"] == "oc_fixture" && truthy(r.data["persistence_warning"]), "= %d %v", r.status, r.data)
	})
	run("Cross-site call rejected", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke(callPath, callPayload(), voiceCall{headers: map[string]string{"Sec-Fetch-Site": "cross-site"}}).status == 403 && len(b.dials()) == 0, "allowed")
	})
	run("Malformed JSON and null body return client errors", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke(callPath, "{").status == 400, "malformed accepted")
		check(t, b.invoke(callPath, "null").status == 400, "null accepted")
	})
	run("Non-string phone and invalid UUID rejected before dial", func(t *testing.T, b *backendFixture) {
		check(t, b.invoke(callPath, with(callPayload(), obj{"destination": 812345678})).status == 400, "number phone accepted")
		check(t, b.invoke(callPath, with(callPayload(), obj{"request_id": strings.Repeat("-", 36)})).status == 400, "bad UUID accepted")
		check(t, len(b.dials()) == 0, "dialed")
	})
	run("Batch derives destination and variables from owner CSV and omits classified outputs", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"], b.opt["prompt"] = csvCampaign(), "{{guest_name}} {{call_result}}"
		r := b.invoke(callPath, batchPayload())
		check(t, r.status == 200, "= %d %v", r.status, r.data)
		sent := b.dials()[0].Body
		check(t, get(sent, "destination") == "0898765432" && get(sent, "metadata", "variables", "guest_name") == "CSV Two", "CSV values not used: %v", sent)
		check(t, !has(get(sent, "metadata", "variables"), "call_result") && get(sent, "metadata", "campaign_version") == "version-1", "outputs or version wrong: %v", sent)
	})
	run("Batch rejects stale campaign version before reserving or dialing", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"] = csvCampaign()
		p := batchPayload()
		meta(p)["campaign_version"] = "old"
		check(t, b.invoke(callPath, p).status == 409 && len(b.dials()) == 0, "stale version accepted")
	})
	run("Selected valid row can dial when an unselected row is incomplete", func(t *testing.T, b *backendFixture) {
		campaign := csvCampaign()
		get(campaign, "csv", "rows").([]any)[0].([]any)[0] = ""
		b.opt["campaign"], b.opt["prompt"] = campaign, "{{guest_name}} {{call_result}}"
		check(t, b.invoke(callPath, batchPayload()).status == 200 && len(b.dials()) == 1, "valid row refused")
	})
	run("Selected incomplete row cannot use browser replacement values", func(t *testing.T, b *backendFixture) {
		campaign := csvCampaign()
		get(campaign, "csv", "rows").([]any)[1].([]any)[0] = ""
		b.opt["campaign"], b.opt["prompt"] = campaign, "{{guest_name}} {{call_result}}"
		check(t, b.invoke(callPath, batchPayload()).status == 400 && len(b.dials()) == 0, "incomplete row dialed")
	})
	run("Existing campaign row requires explicit terminal redial with stable request ID", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"], b.opt["prompt"] = csvCampaign(), "{{guest_name}} {{call_result}}"
		b.opt["lastAttempt"] = obj{"id": fixtureUser, "status": "completed", "call_id": "old"}
		p := batchPayload()
		check(t, b.invoke(callPath, p).status == 409, "implicit redial allowed")
		meta(p)["campaign_redial_of"] = fixtureUser
		p["request_id"] = campaignRequestID(fixtureUser, "version-1", 1, fixtureUser)
		check(t, b.invoke(callPath, p).status == 200, "explicit redial refused")
		check(t, get(b.dials()[0].Body, "metadata", "campaign_redial_of") == fixtureUser, "redial not recorded")
	})
	run("Redial rejects active, unknown, changed and forged requests before dialing", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"], b.opt["prompt"] = csvCampaign(), "{{guest_name}} {{call_result}}"
		p := batchPayload()
		meta(p)["campaign_redial_of"] = fixtureUser
		p["request_id"] = campaignRequestID(fixtureUser, "version-1", 1, fixtureUser)
		for _, last := range []any{nil, obj{"id": "other", "status": "completed", "call_id": "old"}, obj{"id": fixtureUser, "status": "ringing", "call_id": "old"}, obj{"id": fixtureUser, "status": "unknown", "call_id": nil}} {
			b.opt["lastAttempt"] = last
			check(t, b.invoke(callPath, p).status == 409, "last attempt %v allowed redial", last)
		}
		b.opt["lastAttempt"] = obj{"id": fixtureUser, "status": "completed", "call_id": "old"}
		p["request_id"] = callPayload()["request_id"]
		check(t, b.invoke(callPath, p).status == 400 && len(b.dials()) == 0, "forged request ID accepted")
	})
	run("Batch requires campaign, row, matching Agent and owner access", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"] = csvCampaign()
		for _, change := range []obj{{"campaign_id": nil}, {"contact_row": nil}, {"contact_row": -1}, {"contact_row": 20}} {
			p := batchPayload()
			for k, v := range change {
				if v == nil {
					delete(meta(p), k)
				} else {
					meta(p)[k] = v
				}
			}
			check(t, b.invoke(callPath, p).status == 400, "change %v accepted", change)
		}
		campaign := csvCampaign()
		campaign["agentId"] = "other"
		b.opt["campaign"] = campaign
		check(t, b.invoke(callPath, batchPayload()).status == 400, "other agent accepted")
		b.opt["noCampaign"] = true
		check(t, b.invoke(callPath, batchPayload()).status == 403 && len(b.dials()) == 0, "foreign campaign accepted")
	})
	run("Batch refuses new prompt variables until CSV mapping is updated", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"], b.opt["prompt"] = csvCampaign(), "{{guest_name}} {{new_input}} {{call_result}}"
		check(t, b.invoke(callPath, batchPayload()).status == 400 && len(b.dials()) == 0, "unmapped variable accepted")
	})
	run("Callback correlation and account come from server, never client input", func(t *testing.T, b *backendFixture) {
		b.opt["prompt"], b.opt["connectedReceiver"] = "{{guest_name}} {{vc_call_reference}}", true
		body := callPayload()
		meta(body)["variables"].(obj)["vc_call_reference"] = "client-forged-reference"
		meta(body)["voice_account_id"], meta(body)["voice_request_id"] = "forged", "forged"
		r := b.invoke(callPath, body, voiceCall{env: receiverEnv})
		check(t, r.status == 200, "= %d %v", r.status, r.data)
		sent := b.dials()[0].Body
		check(t, get(sent, "metadata", "variables", "vc_call_reference") == body["request_id"] && get(sent, "metadata", "voice_request_id") == body["request_id"], "client correlation used: %v", sent)
		check(t, get(sent, "metadata", "result_callback") == float64(1) && get(sent, "metadata", "voice_account_id") == "tenant_fixture" && get(sent, "metadata", "callback_auth") == "account_v2", "metadata %v", get(sent, "metadata"))
		reserved := b.find(func(c call) bool { return strings.HasSuffix(c.Path, "/rpc/reserve_voice_call") })
		check(t, get(reserved.Body, "p_metadata", "variables", "vc_call_reference") == body["request_id"], "reservation reference wrong")
	})
	run("Missing and expired personal connections never fall back to the global token", func(t *testing.T, b *backendFixture) {
		b.opt["noConnection"] = true
		check(t, b.invoke("/me", nil).status == 428 && b.voiceCalls() == 0, "missing connection not 428")
		b.opt["noConnection"], b.opt["expired"] = false, true
		check(t, b.invoke("/me", nil).status == 428, "expired connection not 428")
	})
	run("Revoked Voice Bot token prompts reconnect without exposing upstream errors", func(t *testing.T, b *backendFixture) {
		b.opt["invalidVoiceToken"] = true
		r := b.invoke("/agents", nil)
		check(t, r.status == 428 && strings.Contains(strOr(r.data["error"]), "Session JWT"), "= %d %v", r.status, r.data)
	})
	run("Foreign account campaign history prevents additional dial", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"], b.opt["foreignHistory"] = csvCampaign(), true
		check(t, b.invoke(callPath, batchPayload()).status == 409 && len(b.dials()) == 0, "foreign history ignored")
		b.opt["foreignHistory"] = false
		campaign := csvCampaign()
		campaign["voiceAccountId"] = "other"
		b.opt["campaign"] = campaign
		check(t, b.invoke(callPath, batchPayload()).status == 409, "foreign account ignored")
	})
	run("Agent requiring callback cannot dial with an unconfigured receiver", func(t *testing.T, b *backendFixture) {
		b.opt["prompt"] = "{{guest_name}} {{vc_call_reference}}"
		check(t, b.invoke(callPath, callPayload()).status == 503 && len(b.dials()) == 0, "dialed without receiver")
		check(t, b.count(func(c call) bool { return strings.HasSuffix(c.Path, "/rpc/reserve_voice_call") }) == 0, "reserved without receiver")
	})
	run("Browser cannot turn recording on using forged per-call metadata", func(t *testing.T, b *backendFixture) {
		b.opt["prompt"], b.opt["connectedReceiver"] = "{{guest_name}} {{vc_call_reference}}", true
		body := callPayload()
		meta(body)["record_conversation"] = true
		meta(body)["variables"].(obj)["vc_record_conversation"] = "true"
		check(t, b.invoke(callPath, body, voiceCall{env: receiverEnv}).status == 200, "call failed")
		sent := b.dials()[0].Body
		check(t, get(sent, "metadata", "variables", "vc_record_conversation") == "false" && !has(get(sent, "metadata"), "record_conversation"), "forged recording: %v", sent)
	})
	run("Saved recording preference requires a connected transcript tool before any dial", func(t *testing.T, b *backendFixture) {
		b.opt["prompt"], b.opt["connectedReceiver"] = "{{guest_name}} {{vc_call_reference}}", true
		b.opt["campaign"] = with(csvCampaign(), obj{"recordConversation": true})
		check(t, b.invoke(callPath, batchPayload(), voiceCall{env: receiverEnv}).status == 409 && len(b.dials()) == 0, "recorded without transcript tool")
	})
	run("Recording flag is derived from the saved campaign and bound to the new request", func(t *testing.T, b *backendFixture) {
		b.opt["transcriptConnected"], b.opt["prompt"] = true, "{{guest_name}} {{call_result}}"
		b.opt["campaign"] = with(csvCampaign(), obj{"recordConversation": true})
		r := b.invoke(callPath, batchPayload(), voiceCall{env: receiverEnv})
		check(t, r.status == 200, "= %d %v", r.status, r.data)
		sent := b.dials()[0].Body
		check(t, get(sent, "metadata", "record_conversation") == true && get(sent, "metadata", "variables", "vc_record_conversation") == "true", "recording flag: %v", sent)
		check(t, get(sent, "metadata", "variables", "vc_call_reference") == batchID && get(sent, "metadata", "variables", "guest_name") == "CSV Two", "variables: %v", sent)
	})
	run("Manual calls cannot overtake an active automatic campaign job", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"], b.opt["activeJob"] = csvCampaign(), true
		check(t, b.invoke(callPath, batchPayload()).status == 409 && len(b.dials()) == 0, "overtook job")
	})
	run("Recurring worker correlates its run and uses a leased reservation for explicit redial", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"], b.opt["prompt"] = csvCampaign(), "{{guest_name}} {{call_result}}"
		b.opt["lastAttempt"] = obj{"id": fixtureUser, "status": "completed", "call_id": "old"}
		body := batchPayload()
		meta(body)["campaign_redial_of"] = fixtureUser
		body["request_id"] = campaignRequestID(fixtureUser, "version-1", 1, fixtureUser)
		job := obj{"id": fixtureUser, "lease_id": fixtureUser, "run_id": "occurrence_fixture", "owner_id": fixtureUser, "campaign_id": fixtureUser, "account_id": "tenant_fixture", "redial": true, "contact_rows": []any{float64(1)}}
		wk := &worker{user: obj{"id": fixtureUser, "email": "fixture@example.invalid", "email_confirmed_at": "2026-01-01"}, job: job}
		r := b.invoke(callPath, body, voiceCall{worker: wk})
		check(t, r.status == 200, "= %d %v", r.status, r.data)
		reserved := b.find(func(c call) bool { return strings.HasSuffix(c.Path, "/rpc/reserve_scheduled_voice_call") })
		check(t, reserved != nil && get(reserved.Body, "p_metadata", "schedule_run_id") == "occurrence_fixture" && get(reserved.Body, "p_lease_id") == fixtureUser, "reservation %v", reserved)
	})
	run("A worker cannot redial or select rows outside its saved alarm", func(t *testing.T, b *backendFixture) {
		b.opt["campaign"] = csvCampaign()
		b.opt["lastAttempt"] = obj{"id": fixtureUser, "status": "completed", "call_id": "old"}
		body := batchPayload()
		meta(body)["campaign_redial_of"] = fixtureUser
		body["request_id"] = campaignRequestID(fixtureUser, "version-1", 1, fixtureUser)
		for _, changes := range []obj{{"redial": false}, {"redial": true, "contact_rows": []any{float64(0)}}} {
			job := obj{"id": fixtureUser, "lease_id": fixtureUser, "run_id": "occurrence", "owner_id": fixtureUser, "campaign_id": fixtureUser, "account_id": "tenant_fixture"}
			for k, v := range changes {
				job[k] = v
			}
			wk := &worker{user: obj{"id": fixtureUser, "email_confirmed_at": "2026-01-01"}, job: job}
			check(t, statusOf(b.invoke(callPath, body, voiceCall{worker: wk})) == 403, "worker allowed with %v", changes)
		}
		check(t, len(b.dials()) == 0, "dialed")
	})
}
