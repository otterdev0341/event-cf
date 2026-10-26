package main

// Ports of scripts/test-result-callback.mjs and scripts/test-recording-callback.mjs. Cases for
// Vercel pre-parsed bodies do not apply to net/http and are left out.

import (
	"strings"
	"testing"
)

const (
	cbID    = "22222222-2222-4222-8222-222222222222"
	cbOwner = "11111111-1111-4111-8111-111111111111"
)

var resultEnv = map[string]string{"SUPABASE_URL": "https://callback-db.invalid", "SUPABASE_SERVICE_ROLE_KEY": "fixture-service-role",
	"VOICE_RESULT_CALLBACK_SECRET": "fixture-secret-32-characters-long-enough"}

type resultFixture struct {
	*fixture
	record  obj
	opt     map[string]bool
	patches []call
}

func newResultFixture(t *testing.T) *resultFixture {
	r := &resultFixture{fixture: &fixture{t: t}, opt: map[string]bool{}}
	r.record = obj{"id": cbID, "owner_id": cbOwner, "agent_id": "agt_fixture", "call_id": "oc_fixture", "status": "completed",
		"metadata": obj{"result_callback": 1, "variables": obj{"vc_call_reference": cbID}},
		"response": obj{"review": obj{"call_result": "DECLINED", "needs_agent": nil, "evidence": "Manual evidence", "updated_at": "manual-time"}, "followup": obj{"checked_at": "check-time"}}}
	r.record = clone(r.record).(obj)
	r.serve = r.reply
	return r
}

func (r *resultFixture) reply(c call) reply {
	t := r.t
	check(t, c.Host == "callback-db.invalid" && c.Path == "/rest/v1/voice_call_requests", "callback called %s%s", c.Host, c.Path)
	check(t, c.Header.Get("apikey") == "fixture-service-role" && c.Query.Get("id") == "eq."+cbID, "callback query not scoped")
	if c.Method == "PATCH" {
		r.patches = append(r.patches, c)
		check(t, canon(sortedKeys(c.Body.(obj))) == `["response"]`, "patch changes %v", sortedKeys(c.Body.(obj)))
		q := c.Query
		check(t, q.Get("owner_id") == "eq."+cbOwner && q.Get("agent_id") == "eq.agt_fixture" && q.Get("call_id") == "eq.oc_fixture", "patch not scoped: %v", q)
		check(t, q.Get("response->review->>updated_at") == "eq.manual-time" && q.Get("response->followup->>checked_at") == "eq.check-time", "patch not guarded: %v", q)
		if r.opt["writeError"] {
			return status(500, obj{"message": "private db error"})
		}
		if r.opt["conflict"] {
			return ok([]any{})
		}
		r.record["response"] = get(c.Body, "response")
		return ok([]any{obj{"id": cbID}})
	}
	if r.opt["readError"] {
		return status(500, obj{"message": "private db error"})
	}
	if r.opt["missing"] {
		return ok(nil)
	}
	return ok(clone(r.record))
}

func resultPayload() obj {
	return obj{"request_id": cbID, "agent_id": "agt_fixture", "call_result": "CONFIRMED", "needs_agent": false, "evidence": "Recipient explicitly confirmed attendance"}
}

func transcriptPayload() obj {
	return obj{"request_id": cbID, "agent_id": "agt_fixture", "transcript": "บอท: ยืนยันเข้าร่วมไหมครับ\nผู้รับ: ยืนยันครับ"}
}

type cbCall struct {
	method  string
	headers map[string]string
	env     map[string]string
}

func (r *resultFixture) invoke(body any, extra ...cbCall) response {
	x := cbCall{method: "POST"}
	if len(extra) > 0 {
		x = extra[0]
		if x.method == "" {
			x.method = "POST"
		}
	}
	headers := x.headers
	if headers == nil {
		headers = map[string]string{"Authorization": "Bearer " + resultEnv["VOICE_RESULT_CALLBACK_SECRET"], "Content-Type": "application/json"}
	}
	raw, isRaw := body.(string)
	if !isRaw {
		raw = jsonBody(body)
	}
	return serveHTTP(newApp(r.fixture, merge(resultEnv, x.env)), x.method, "/event-confirm/api/voice-result", headers, raw)
}

func bearerJSON(token string) cbCall {
	return cbCall{headers: map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"}}
}

func (r *resultFixture) enableTranscript() {
	meta := r.record["metadata"].(obj)
	meta["record_conversation"] = true
	meta["variables"].(obj)["vc_record_conversation"] = "true"
}

func TestResultCallback(t *testing.T) {
	run := func(name string, fn func(t *testing.T, r *resultFixture)) {
		t.Run(name, func(t *testing.T) { fn(t, newResultFixture(t)) })
	}
	run("Unconfigured receiver fails closed", func(t *testing.T, r *resultFixture) {
		for _, env := range []map[string]string{{"SUPABASE_SERVICE_ROLE_KEY": ""}, {"VOICE_RESULT_CALLBACK_SECRET": "short"}, {"SUPABASE_URL": ""}} {
			check(t, r.invoke(resultPayload(), cbCall{env: env}).status == 503, "env %v not refused", env)
		}
		check(t, len(r.calls) == 0, "database called")
	})
	run("Only authenticated POST JSON requests are accepted", func(t *testing.T, r *resultFixture) {
		check(t, r.invoke(resultPayload(), cbCall{method: "GET"}).status == 405, "GET allowed")
		for _, auth := range []string{"", "Bearer wrong"} {
			check(t, r.invoke(resultPayload(), cbCall{headers: map[string]string{"Authorization": auth, "Content-Type": "application/json"}}).status == 401, "auth %q allowed", auth)
		}
		check(t, r.invoke(resultPayload(), cbCall{headers: map[string]string{"Content-Type": "application/json"}}).status == 401, "missing auth allowed")
		check(t, len(r.calls) == 0, "database called")
	})
	run("Content type, malformed JSON and size rejected before database", func(t *testing.T, r *resultFixture) {
		check(t, r.invoke(resultPayload(), cbCall{headers: map[string]string{"Authorization": "Bearer " + resultEnv["VOICE_RESULT_CALLBACK_SECRET"]}}).status == 415, "no content type accepted")
		check(t, r.invoke("{").status == 400, "malformed accepted")
		check(t, r.invoke(strings.Repeat("a", 16001)).status == 413, "oversized accepted")
		check(t, len(r.calls) == 0, "database called")
	})
	run("Payload uses explicit typed result with no owner or arbitrary response fields", func(t *testing.T, r *resultFixture) {
		for _, body := range []any{nil, []any{}, with(resultPayload(), obj{"owner_id": cbOwner}), with(resultPayload(), obj{"needs_agent": "false"}), with(resultPayload(), obj{"evidence": ""}),
			with(resultPayload(), obj{"call_result": "completed"}), with(resultPayload(), obj{"call_result": []any{"CONFIRMED"}}), with(resultPayload(), obj{"request_id": []any{cbID}})} {
			check(t, r.invoke(body).status == 400, "%v accepted", body)
		}
		check(t, len(r.calls) == 0, "database called")
	})
	run("Unknown request and wrong Agent cannot write", func(t *testing.T, r *resultFixture) {
		r.opt["missing"] = true
		check(t, r.invoke(resultPayload()).status == 404, "missing not 404")
		r.opt["missing"] = false
		r.record["agent_id"] = "agt_other"
		check(t, r.invoke(resultPayload()).status == 404 && len(r.patches) == 0, "wrong agent wrote")
	})
	run("Invalid callbacks identify fields without returning private payload values", func(t *testing.T, r *resultFixture) {
		res := r.invoke(with(resultPayload(), obj{"needs_agent": "false", "evidence": "PRIVATE_CONVERSATION", "request_id": "PRIVATE_REFERENCE", "PRIVATE_KEY": "PRIVATE_VALUE"}))
		check(t, res.status == 400 && canon(res.data["fields"]) == `["unexpected_fields","request_id","needs_agent"]` && len(r.calls) == 0, "= %d %s", res.status, res.raw)
		for _, private := range []string{"PRIVATE_CONVERSATION", "PRIVATE_REFERENCE", "PRIVATE_KEY", "PRIVATE_VALUE"} {
			check(t, !strings.Contains(string(res.raw), private), "response leaks %s", private)
		}
	})
	run("Legacy/unrelated call references cannot receive results", func(t *testing.T, r *resultFixture) {
		meta := r.record["metadata"].(obj)
		delete(meta, "result_callback")
		check(t, r.invoke(resultPayload()).status == 404, "legacy call accepted")
		meta["result_callback"] = 1
		meta["variables"].(obj)["vc_call_reference"] = "other"
		check(t, r.invoke(resultPayload()).status == 404 && len(r.patches) == 0, "unrelated reference accepted")
	})
	run("Callback arriving before initial persistence is retriable without write", func(t *testing.T, r *resultFixture) {
		r.record["call_id"] = nil
		check(t, r.invoke(resultPayload()).status == 409 && len(r.patches) == 0, "unpersisted call accepted")
	})
	run("Result persists evidence and source while preserving manual review and phone status", func(t *testing.T, r *resultFixture) {
		check(t, r.invoke(resultPayload()).status == 200, "callback failed")
		response := r.record["response"]
		check(t, r.record["status"] == "completed" && get(response, "callback", "call_id") == "oc_fixture", "callback %v", response)
		check(t, get(response, "callback", "outcome", "needs_agent") == false && get(response, "callback", "outcome", "source") == "agent_tool", "outcome %v", get(response, "callback", "outcome"))
		check(t, get(response, "review", "call_result") == "DECLINED" && get(response, "followup", "checked_at") == "check-time" && truthy(get(response, "callback", "received_at")), "evidence lost: %v", response)
		check(t, r.patches[0].Query.Get("response->callback->>received_at") == "is.null", "first write not guarded")
	})
	run("Identical retry succeeds without another write", func(t *testing.T, r *resultFixture) {
		r.invoke(resultPayload())
		res := r.invoke(resultPayload())
		check(t, res.status == 200 && res.data["duplicate"] == true && len(r.patches) == 1, "= %d %v, %d patches", res.status, res.data, len(r.patches))
	})
	run("Different final result cannot overwrite accepted result", func(t *testing.T, r *resultFixture) {
		r.invoke(resultPayload())
		check(t, r.invoke(with(resultPayload(), obj{"call_result": "DECLINED"})).status == 409 && len(r.patches) == 1, "overwritten")
	})
	run("Concurrent update returns conflict without success", func(t *testing.T, r *resultFixture) {
		r.opt["conflict"] = true
		check(t, r.invoke(resultPayload()).status == 409 && !has(r.record["response"], "callback"), "conflict reported success")
	})
	run("Database errors are retriable and do not expose details", func(t *testing.T, r *resultFixture) {
		r.opt["readError"] = true
		res := r.invoke(resultPayload())
		check(t, res.status == 503 && !strings.Contains(string(res.raw), "private db"), "= %d %s", res.status, res.raw)
		r.opt["readError"], r.opt["writeError"] = false, true
		check(t, r.invoke(resultPayload()).status == 503, "write error not 503")
	})
	run("Account callback keys differ and only the matching account may report results", func(t *testing.T, r *resultFixture) {
		meta := r.record["metadata"].(obj)
		meta["voice_account_id"], meta["callback_auth"] = "tenant_A", "account_v2"
		secret := resultEnv["VOICE_RESULT_CALLBACK_SECRET"]
		a, _ := accountCallbackSecret("tenant_A", secret)
		b, _ := accountCallbackSecret("tenant_B", secret)
		check(t, a != b, "account keys equal")
		check(t, r.invoke(resultPayload(), bearerJSON(secret)).status == 401, "root secret accepted for account call")
		check(t, r.invoke(resultPayload(), bearerJSON(b)).status == 401 && len(r.patches) == 0, "other account key accepted")
		check(t, r.invoke(resultPayload(), bearerJSON(a)).status == 200, "own account key refused")
	})
	run("Disabled conversation recording rejects even a correctly authenticated tool", func(t *testing.T, r *resultFixture) {
		check(t, r.invoke(transcriptPayload()).status == 403 && len(r.patches) == 0, "transcript accepted while disabled")
		r.record["metadata"].(obj)["record_conversation"] = true
		check(t, r.invoke(transcriptPayload()).status == 403, "transcript accepted without per-call flag")
	})
	run("Enabled conversation stores text on the exact call and preserves results", func(t *testing.T, r *resultFixture) {
		r.enableTranscript()
		check(t, r.invoke(transcriptPayload()).status == 200, "transcript refused")
		response := r.record["response"]
		check(t, get(response, "transcript", "text") == transcriptPayload()["transcript"] && get(response, "transcript", "call_id") == "oc_fixture", "transcript %v", get(response, "transcript"))
		check(t, get(response, "review", "call_result") == "DECLINED" && r.record["status"] == "completed", "results lost")
		check(t, r.invoke(transcriptPayload()).data["duplicate"] == true && len(r.patches) == 1, "retry wrote again")
		check(t, r.invoke(with(transcriptPayload(), obj{"transcript": "Different text"})).status == 409, "different text overwrote")
	})
	run("Transcript cannot accept foreign accounts, unexpected fields, excessive text or pending calls", func(t *testing.T, r *resultFixture) {
		r.enableTranscript()
		check(t, r.invoke(with(transcriptPayload(), obj{"owner_id": cbOwner})).status == 400, "extra field accepted")
		check(t, r.invoke(with(transcriptPayload(), obj{"transcript": strings.Repeat("x", 10001)})).status == 400, "long transcript accepted")
		meta := r.record["metadata"].(obj)
		meta["voice_account_id"], meta["callback_auth"] = "tenant_A", "account_v2"
		other, _ := accountCallbackSecret("tenant_B", resultEnv["VOICE_RESULT_CALLBACK_SECRET"])
		check(t, r.invoke(transcriptPayload(), bearerJSON(other)).status == 401, "foreign account accepted")
		delete(meta, "callback_auth")
		r.record["call_id"] = nil
		check(t, r.invoke(transcriptPayload()).status == 409 && len(r.patches) == 0, "pending call accepted")
	})
	run("Transcript update guards concurrent changes and retries without claiming success", func(t *testing.T, r *resultFixture) {
		r.enableTranscript()
		r.opt["conflict"] = true
		check(t, r.invoke(transcriptPayload()).status == 409 && !has(r.record["response"], "transcript"), "conflict reported success")
	})
	run("Result received after transcript retains conversation text and guards its timestamp", func(t *testing.T, r *resultFixture) {
		r.enableTranscript()
		r.invoke(transcriptPayload())
		received := get(r.record["response"], "transcript", "received_at")
		check(t, r.invoke(resultPayload()).status == 200, "result refused")
		check(t, get(r.record["response"], "transcript", "text") == transcriptPayload()["transcript"], "transcript lost")
		last := r.patches[len(r.patches)-1]
		check(t, last.Query.Get("response->transcript->>received_at") == "eq."+jsString(received), "transcript timestamp not guarded: %v", last.Query)
	})
}

// ---- recording callback

const (
	recCampaign = "44444444-4444-4444-8444-444444444444"
	recAccount  = "account_fixture"
	recPath     = "agt_fixture/2026-10-14_19-38-55_33333333-3333-4333-8333-333333333333_0.txt"
)

var recordingEnv = map[string]string{"SUPABASE_URL": "https://recording-db.invalid", "SUPABASE_SERVICE_ROLE_KEY": "fixture-service",
	"VOICE_RESULT_CALLBACK_SECRET": "fixture-recording-root-secret-over-32-characters"}

type recFixture struct {
	*fixture
	record  obj
	opt     map[string]bool
	patches int
}

func newRecFixture(t *testing.T) *recFixture {
	r := &recFixture{fixture: &fixture{t: t}, opt: map[string]bool{}}
	r.record = obj{"id": cbID, "owner_id": cbOwner, "call_id": "oc_fixture", "agent_id": "agt_fixture", "created_at": "2026-10-14T12:38:51Z",
		"metadata": obj{"campaign_id": recCampaign, "voice_account_id": recAccount, "voice_request_id": cbID},
		"response": obj{"callback": obj{"received_at": "callback-time"}, "review": obj{"updated_at": "review-time"}, "followup": obj{"checked_at": "check-time"}, "transcript": obj{"received_at": "transcript-time"}}}
	r.serve = r.reply
	return r
}

func (r *recFixture) reply(c call) reply {
	t := r.t
	check(t, c.Host == "recording-db.invalid" && c.Header.Get("apikey") == "fixture-service", "callback called %s", c.Host)
	if strings.HasSuffix(c.Path, "/voice_bot_connections") {
		check(t, c.Query.Get("owner_id") == "eq."+cbOwner, "connection query not scoped")
		if r.opt["disconnected"] {
			return ok(nil)
		}
		account := recAccount
		if r.opt["accountChanged"] {
			account = "another"
		}
		return ok(obj{"account_id": account})
	}
	check(t, c.Path == "/rest/v1/voice_call_requests" && c.Query.Get("id") == "eq."+cbID, "unexpected %s", c.Path)
	if c.Method == "PATCH" {
		r.patches++
		q := c.Query
		check(t, canon(sortedKeys(c.Body.(obj))) == `["response"]`, "patch changes more than response")
		check(t, q.Get("owner_id") == "eq."+cbOwner && q.Get("call_id") == "eq.oc_fixture" && q.Get("agent_id") == "eq.agt_fixture" &&
			q.Get("metadata->>voice_account_id") == "eq."+recAccount && q.Get("metadata->>campaign_id") == "eq."+recCampaign, "patch not scoped: %v", q)
		check(t, q.Get("response->audio_link->>updated_at") == "is.null", "audio link not guarded")
		for field, value := range map[string]string{"callback->>received_at": "callback-time", "review->>updated_at": "review-time", "followup->>checked_at": "check-time", "transcript->>received_at": "transcript-time"} {
			check(t, q.Get("response->"+field) == "eq."+value, "%s not guarded", field)
		}
		if r.opt["writeError"] {
			return status(500, obj{"message": "fixture private error"})
		}
		if r.opt["conflict"] {
			return ok([]any{})
		}
		r.record["response"] = get(c.Body, "response")
		return ok([]any{obj{"id": cbID}})
	}
	if r.opt["readError"] {
		return status(500, obj{"message": "fixture private error"})
	}
	if r.opt["missing"] {
		return ok(nil)
	}
	return ok(clone(r.record))
}

func recPayload() obj {
	return obj{"request_id": cbID, "call_id": "oc_fixture", "agent_id": "agt_fixture", "file_path": recPath}
}

func recSecret(account string) string {
	s, _ := accountRecordingSecret(account, recordingEnv["VOICE_RESULT_CALLBACK_SECRET"])
	return s
}

func (r *recFixture) invoke(body any, token string, extra ...cbCall) response {
	x := cbCall{method: "POST"}
	if len(extra) > 0 {
		x = extra[0]
		if x.method == "" {
			x.method = "POST"
		}
	}
	if token == "" {
		token = recSecret(recAccount)
	}
	headers := x.headers
	if headers == nil {
		headers = map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"}
	}
	raw, isRaw := body.(string)
	if !isRaw {
		raw = jsonBody(body)
	}
	return serveHTTP(newApp(r.fixture, merge(recordingEnv, x.env)), x.method, "/event-confirm/api/voice-recording", headers, raw)
}

func TestRecordingCallback(t *testing.T) {
	run := func(name string, fn func(t *testing.T, r *recFixture)) {
		t.Run(name, func(t *testing.T) { fn(t, newRecFixture(t)) })
	}
	run("POST and configured server storage are required", func(t *testing.T, r *recFixture) {
		check(t, r.invoke(recPayload(), "", cbCall{method: "GET"}).status == 405, "GET allowed")
		check(t, r.invoke(recPayload(), "", cbCall{env: map[string]string{"VOICE_RESULT_CALLBACK_SECRET": ""}}).status == 503, "unconfigured accepted")
		check(t, len(r.calls) == 0, "database called")
	})
	run("Recording credentials are separate from result credentials and reject malformed auth", func(t *testing.T, r *recFixture) {
		root := recordingEnv["VOICE_RESULT_CALLBACK_SECRET"]
		result, _ := accountCallbackSecret(recAccount, root)
		check(t, recSecret(recAccount) != result, "recording and result keys equal")
		for _, token := range []string{"Bearer ", "Bearer bad", "Bearer " + result, "Bearer " + recSecret("another")} {
			check(t, r.invoke(recPayload(), "", cbCall{headers: map[string]string{"Authorization": token, "Content-Type": "application/json"}}).status == 401, "%q accepted", token)
		}
		check(t, r.patches == 0, "wrote")
	})
	run("Wrong JSON type, invalid syntax and oversized stream are rejected", func(t *testing.T, r *recFixture) {
		check(t, r.invoke(recPayload(), "", cbCall{headers: map[string]string{"Authorization": "Bearer " + recSecret(recAccount), "Content-Type": "text/plain"}}).status == 415, "text accepted")
		check(t, r.invoke("{", "").status == 400, "malformed accepted")
		check(t, r.invoke(strings.Repeat("x", 4097), "").status == 413, "oversized accepted")
		check(t, len(r.calls) == 0, "database called")
	})
	run("Scope, external URL and extra fields cannot be supplied by callers", func(t *testing.T, r *recFixture) {
		for _, body := range []any{nil, []any{}, with(recPayload(), obj{"owner_id": cbOwner}), with(recPayload(), obj{"campaign_id": recCampaign}), with(recPayload(), obj{"recording_id": "arbitrary"}),
			with(recPayload(), obj{"file_path": "https://foreign.invalid/file.wav"}), with(recPayload(), obj{"request_id": "bad"}), with(recPayload(), obj{"call_id": []any{}}), with(recPayload(), obj{"agent_id": "other"})} {
			check(t, r.invoke(body, "").status == 400, "%v accepted", body)
		}
		check(t, r.patches == 0, "wrote")
	})
	run("Missing requests and changed original connections cannot grant access", func(t *testing.T, r *recFixture) {
		for _, key := range []string{"missing", "accountChanged", "disconnected"} {
			r.opt = map[string]bool{key: true}
			check(t, r.invoke(recPayload(), "").status == 401, "%s accepted", key)
		}
		check(t, r.patches == 0, "wrote")
	})
	run("Wrong Agent, noncampaign call, wrong Call ID and unpersisted call never save", func(t *testing.T, r *recFixture) {
		r.record["agent_id"] = "agt_other"
		check(t, r.invoke(recPayload(), "").status == 404, "wrong agent accepted")
		r.record["agent_id"] = "agt_fixture"
		meta := r.record["metadata"].(obj)
		delete(meta, "campaign_id")
		check(t, r.invoke(recPayload(), "").status == 404, "noncampaign call accepted")
		meta["campaign_id"] = recCampaign
		r.record["call_id"] = "oc_other"
		check(t, r.invoke(recPayload(), "").status == 409, "wrong call accepted")
		r.record["call_id"] = nil
		check(t, r.invoke(recPayload(), "").status == 409 && r.patches == 0, "unpersisted call accepted")
	})
	run("Only valid files from this Agent and call date range are accepted", func(t *testing.T, r *recFixture) {
		for _, file := range []string{strings.Replace(recPath, "agt_fixture", "agt_other", 1), strings.Replace(recPath, "2026-10-14", "2026-01-01", 1), strings.Replace(recPath, "19-38-55", "99-38-55", 1),
			strings.Replace(recPath, "_0.txt", "_0.wav?token=x", 1), "../" + recPath, strings.Replace(recPath, ".txt", ".mp3", 1)} {
			check(t, r.invoke(with(recPayload(), obj{"file_path": file}), "").status == 400, "%s accepted", file)
		}
		check(t, r.patches == 0, "wrote")
	})
	run("Explicit provider join saves an opaque recording reference without overwriting evidence", func(t *testing.T, r *recFixture) {
		before := clone(r.record["response"]).(obj)
		res := r.invoke(recPayload(), "")
		check(t, res.status == 200 && canon(res.data) == `{"received":true}`, "= %d %s", res.status, res.raw)
		link := get(r.record["response"], "audio_link")
		want := audioEntries([]any{recPath}, "agt_fixture", dateRange{"2026-10-13", "2026-10-15"})[0].ID
		check(t, get(link, "source") == "provider_callback" && get(link, "recording_id") == want && get(link, "request_id") == cbID, "link %v", link)
		check(t, get(link, "call_id") == "oc_fixture" && get(link, "campaign_id") == recCampaign && get(link, "account_id") == recAccount, "link scope %v", link)
		check(t, !has(link, "file_path") && !has(link, "url"), "link exposes path or URL")
		for k, v := range before {
			check(t, canon(get(r.record["response"], k)) == canon(v), "%s overwritten", k)
		}
	})
	run("Retries and equivalent TXT/WAV filenames are idempotent", func(t *testing.T, r *recFixture) {
		check(t, r.invoke(recPayload(), "").status == 200, "first failed")
		check(t, canon(r.invoke(recPayload(), "").data) == `{"duplicate":true,"received":true}`, "retry not duplicate")
		check(t, canon(r.invoke(with(recPayload(), obj{"file_path": strings.Replace(recPath, ".txt", ".wav", 1)}), "").data) == `{"duplicate":true,"received":true}`, "WAV name not duplicate")
		check(t, r.patches == 1, "%d writes", r.patches)
	})
	run("Different files cannot overwrite an already linked call", func(t *testing.T, r *recFixture) {
		r.invoke(recPayload(), "")
		previous := canon(get(r.record["response"], "audio_link"))
		check(t, r.invoke(with(recPayload(), obj{"file_path": strings.Replace(recPath, "_0.txt", "_1.txt", 1)}), "").status == 409, "overwrite accepted")
		check(t, canon(get(r.record["response"], "audio_link")) == previous && r.patches == 1, "link changed")
	})
	run("Storage and concurrent result changes return retryable errors", func(t *testing.T, r *recFixture) {
		for key, want := range map[string]int{"readError": 503, "writeError": 503, "conflict": 409} {
			r.opt = map[string]bool{key: true}
			check(t, r.invoke(recPayload(), "").status == want, "%s not %d", key, want)
		}
		check(t, !has(r.record["response"], "audio_link"), "link saved")
	})
}
