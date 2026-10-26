package main

// Ports of the handler cases in scripts/test-audio-library.mjs and scripts/test-call-results.mjs.
// Their pure-function cases are covered by TestNodeGolden or stay with shared/*.mjs.

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"testing/iotest"
)

// ---- audio library

const audioFile = "agt_fixture/2026-10-14_12-30-15_33333333-3333-4333-8333-333333333333_0.txt"

var (
	audioEnv = map[string]string{"VITE_SUPABASE_URL": "https://audio-db.invalid", "VITE_SUPABASE_PUBLISHABLE_KEY": "fixture", "SUPABASE_SERVICE_ROLE_KEY": "fixture-role",
		"VOICE_CONNECTION_ENCRYPTION_KEY": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32)), "VOICE_BOT_BASE_URL": "https://voice.invalid", "VOICE_BOT_LOGS_BASE_URL": "https://logs.invalid"}
	audioWav = append(append(append([]byte("RIFF"), make([]byte, 4)...), "WAVE"...), make([]byte, 32)...)
)

type audioFixture struct {
	*fixture
	opt   map[string]bool
	files []any
}

func newAudioFixture(t *testing.T) *audioFixture {
	a := &audioFixture{fixture: &fixture{t: t}, opt: map[string]bool{}}
	a.serve = a.reply
	return a
}

func (a *audioFixture) reply(c call) reply {
	t := a.t
	if c.Host == "audio-db.invalid" {
		if c.Path == "/auth/v1/user" {
			return ok(obj{"id": cbOwner, "email": "fixture@example.invalid", "email_confirmed_at": "confirmed"})
		}
		if strings.HasSuffix(c.Path, "/voice_bot_connections") {
			check(t, c.Query.Get("owner_id") == "eq."+cbOwner, "connection query not scoped")
			sealed, _ := sealToken("upstream-fixture-secret", cbOwner, audioEnv["VOICE_CONNECTION_ENCRYPTION_KEY"])
			return ok(obj{"owner_id": cbOwner, "account_id": "tenant_fixture", "token_ciphertext": sealed})
		}
	}
	check(t, c.Header.Get("Authorization") == "Bearer upstream-fixture-secret" && c.Method == "GET", "upstream call %s %s", c.Method, c.Path)
	switch c.Host + c.Path {
	case "voice.invalid/me":
		if a.opt["wrongAccount"] {
			return ok(obj{"_id": "other"})
		}
		return ok(obj{"_id": "tenant_fixture"})
	case "voice.invalid/agents":
		if a.opt["foreign"] {
			return ok([]any{})
		}
		return ok([]any{obj{"agent_id": "agt_fixture"}})
	}
	check(t, c.Host == "logs.invalid", "unexpected request %s%s", c.Host, c.Path)
	if a.opt["noScope"] {
		return status(403, nil)
	}
	switch c.Path {
	case "/logs/list_file/":
		check(t, c.Query.Get("agent_id") == "agt_fixture" && c.Query.Get("start_date") == "2026/10/13" && c.Query.Get("end_date") == "2026/10/14", "listing query %v", c.Query)
		if a.files != nil {
			return ok(a.files)
		}
		return ok([]any{audioFile})
	case "/logs/audio":
		check(t, c.Query.Get("file_path") == strings.Replace(audioFile, ".txt", ".wav", 1), "audio path %s", c.Query.Get("file_path"))
		switch {
		case a.opt["missingAudio"]:
			return status(404, nil)
		case a.opt["html"]:
			return reply{status: 200, body: "<html>invalid</html>", header: http.Header{"Content-Type": {"text/html"}}}
		case a.opt["tooLarge"]:
			return reply{status: 200, body: audioWav, header: http.Header{"Content-Length": {"68157440"}}}
		case a.opt["split"]:
			return reply{status: 200, body: iotest.OneByteReader(bytes.NewReader(audioWav))}
		}
		return reply{status: 200, body: audioWav, header: http.Header{"Content-Type": {"audio/wav"}}}
	}
	t.Fatalf("unexpected request %s", c.Path)
	return reply{}
}

func (a *audioFixture) invoke(file string, method string, route string, headers map[string]string) response {
	if route == "" {
		route = "/workspace/agents/agt_fixture/audio"
		if file != "" {
			route += "/" + file
		}
		route += "?start_date=2026-10-13&end_date=2026-10-14"
	}
	if method == "" {
		method = "GET"
	}
	if headers == nil {
		headers = map[string]string{"Authorization": "Bearer website-fixture"}
	}
	return serveHTTP(newApp(a.fixture, audioEnv), method, "/event-confirm/api/voice?path="+url.QueryEscape(route), headers, "")
}

func (a *audioFixture) get(file string) response { return a.invoke(file, "", "", nil) }

func (a *audioFixture) requests(path string) int {
	return a.count(func(c call) bool { return c.Path == path })
}

func (a *audioFixture) logsCalls() int {
	return a.count(func(c call) bool { return c.Host == "logs.invalid" })
}

func TestAudioLibrary(t *testing.T) {
	fileID := audioEntries([]any{audioFile}, "agt_fixture", dateRange{"2026-10-13", "2026-10-14"})[0].ID
	run := func(name string, fn func(t *testing.T, a *audioFixture)) {
		t.Run(name, func(t *testing.T) { fn(t, newAudioFixture(t)) })
	}
	run("Dated listing converts .txt to .wav, deduplicates and never exposes paths or tokens", func(t *testing.T, a *audioFixture) {
		a.files = []any{audioFile, strings.Replace(audioFile, ".txt", ".wav", 1)}
		r := a.get("")
		check(t, r.status == 200 && r.data["total"] == float64(1) && get(r.data["items"].([]any)[0], "file_time") == "2026-10-14 12:30:15", "= %d %s", r.status, r.raw)
		check(t, !strings.Contains(string(r.raw), "upstream-fixture-secret") && !strings.Contains(string(r.raw), "33333333-3333"), "listing leaks %s", r.raw)
		check(t, a.requests("/logs/audio") == 0, "audio fetched")
	})
	run("Only selected owned hash streams verified binary WAV, not audio_url JSON", func(t *testing.T, a *audioFixture) {
		r := a.get(fileID)
		check(t, r.status == 200 && r.header.Get("Content-Type") == "audio/wav" && bytes.Equal(r.raw, audioWav), "= %d %q", r.status, r.raw)
		check(t, a.requests("/logs/audio") == 1 && a.requests("/logs/audio_url") == 0 && r.header.Get("Cache-Control") == "private, no-store", "wrong upstream use")
	})
	run("Small upstream chunks still verify and reconstruct the exact WAV header", func(t *testing.T, a *audioFixture) {
		a.opt["split"] = true
		check(t, bytes.Equal(a.get(fileID).raw, audioWav), "split WAV changed")
	})
	run("Foreign Agent and changed account are rejected before reading file lists", func(t *testing.T, a *audioFixture) {
		a.opt["foreign"] = true
		check(t, a.get("").status == 403 && a.logsCalls() == 0, "foreign agent read")
		a.opt = map[string]bool{"wrongAccount": true}
		check(t, a.get("").status == 403 && a.logsCalls() == 0, "changed account read")
	})
	run("Authentication and GET are required", func(t *testing.T, a *audioFixture) {
		check(t, a.invoke("", "", "", map[string]string{}).status == 401, "unauthenticated allowed")
		check(t, a.invoke("", "POST", "", nil).status == 405, "POST allowed")
		check(t, a.logsCalls() == 0, "logs read")
	})
	run("Raw path and arbitrary URL parameters cannot select another recording", func(t *testing.T, a *audioFixture) {
		check(t, a.invoke("", "", "/workspace/agents/agt_fixture/audio?start_date=2026-10-13&end_date=2026-10-14&file_path=other.wav", nil).status == 400 && a.logsCalls() == 0, "raw path accepted")
	})
	run("Unknown hash is rejected without fetching audio", func(t *testing.T, a *audioFixture) {
		check(t, a.get(strings.Repeat("0", 64)).status == 404 && a.requests("/logs/audio") == 0, "unknown hash fetched")
	})
	run("Expired or unsupported log API credentials return connection guidance", func(t *testing.T, a *audioFixture) {
		a.opt["noScope"] = true
		check(t, a.get("").status == 428 && a.requests("/logs/audio") == 0, "no scope not 428")
	})
	run("Missing WAV returns an explicit unavailable message", func(t *testing.T, a *audioFixture) {
		a.opt["missingAudio"] = true
		r := a.get(fileID)
		check(t, r.status == 404 && strings.Contains(strOr(r.data["error"]), "ยังไม่มีไฟล์เสียง"), "= %d %s", r.status, r.raw)
	})
	run("HTML or non-WAV bytes are rejected before opening audio response", func(t *testing.T, a *audioFixture) {
		a.opt["html"] = true
		r := a.get(fileID)
		check(t, r.status == 502 && strings.Contains(r.header.Get("Content-Type"), "application/json"), "= %d %s", r.status, r.header.Get("Content-Type"))
	})
	run("Oversized audio is rejected before streaming", func(t *testing.T, a *audioFixture) {
		a.opt["tooLarge"] = true
		check(t, a.get(fileID).status == 413, "oversized streamed")
	})
}

// ---- call results

const (
	resultsPath     = "agt_fixture/2026-10-11_00-00-00_33333333-3333-4333-8333-333333333333_0.txt"
	resultsCampaign = "44444444-4444-4444-8444-444444444444"
)

var resultsEnv = map[string]string{"VITE_SUPABASE_URL": "https://supabase.invalid", "VITE_SUPABASE_PUBLISHABLE_KEY": "test", "SUPABASE_SERVICE_ROLE_KEY": "fixture-role",
	"VOICE_CONNECTION_ENCRYPTION_KEY": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32)), "VOICE_BOT_BASE_URL": "https://voice.invalid", "VOICE_BOT_LOGS_BASE_URL": "https://voice.invalid"}

type resultsFixture struct {
	*fixture
	opt                    map[string]bool
	record, patch          obj
	files                  []any
	log, callExtra, detail obj
}

func newResultsFixture(t *testing.T) *resultsFixture {
	r := &resultsFixture{fixture: &fixture{t: t}, opt: map[string]bool{}}
	r.record = obj{"id": cbID, "owner_id": cbOwner, "call_id": "oc_fixture", "agent_id": "agt_fixture", "status": "queued", "response": obj{"status": "queued"}, "destination": "0812345678",
		"metadata": obj{"campaign_id": "fixture", "contact_row": float64(0), "voice_account_id": "tenant_fixture"}, "created_at": "2026-10-11T00:00:00Z"}
	r.serve = r.reply
	return r
}

// guard is the expected filter for a response timestamp that a PATCH must compare.
func guard(response any, path ...string) string {
	if v := get(response, path...); truthy(v) {
		return "eq." + jsString(v)
	}
	return "is.null"
}

func (r *resultsFixture) reply(c call) reply {
	t := r.t
	if c.Host == "supabase.invalid" {
		switch {
		case c.Path == "/auth/v1/user":
			return ok(obj{"id": cbOwner, "email": "fixture@example.invalid", "email_confirmed_at": "2026-01-01"})
		case strings.HasSuffix(c.Path, "/voice_bot_connections"):
			if r.opt["noConnection"] {
				return ok(nil)
			}
			sealed, _ := sealToken("test-secret", cbOwner, resultsEnv["VOICE_CONNECTION_ENCRYPTION_KEY"])
			return ok(obj{"owner_id": cbOwner, "account_id": "tenant_fixture", "token_ciphertext": sealed})
		case strings.HasSuffix(c.Path, "/voice_call_requests"):
			check(t, c.Query.Get("owner_id") == "eq."+cbOwner, "call query not scoped")
			if c.Method == "PATCH" {
				r.patch = c.Body.(obj)
				res := r.record["response"]
				for field, path := range map[string][]string{"audio_link->>updated_at": {"audio_link", "updated_at"}, "callback->>received_at": {"callback", "received_at"},
					"review->>updated_at": {"review", "updated_at"}, "followup->>checked_at": {"followup", "checked_at"}} {
					check(t, c.Query.Get("response->"+field) == guard(res, path...), "%s guard = %q", field, c.Query.Get("response->"+field))
				}
				if r.opt["conflict"] {
					return ok([]any{})
				}
				return ok([]any{obj{"id": cbID}})
			}
			if r.opt["foreign"] {
				return ok(nil)
			}
			return ok(clone(r.record))
		}
	}
	check(t, c.Host == "voice.invalid", "unexpected request %s%s", c.Host, c.Path)
	check(t, c.Method == "GET", "Result refresh must never dial")
	switch {
	case c.Path == "/me":
		return ok(obj{"_id": "tenant_fixture"})
	case c.Path == "/agents":
		if r.opt["foreignAgent"] {
			return ok([]any{})
		}
		return ok([]any{obj{"agent_id": "agt_fixture"}})
	case c.Path == "/calls/oc_fixture":
		if r.opt["failDetail"] {
			return status(503, obj{})
		}
		return ok(with(obj{"id": "oc_fixture", "conversation": nil}, r.detail))
	case strings.HasSuffix(c.Path, "/calls/oc_fixture"):
		if r.opt["failStatus"] {
			return status(500, obj{})
		}
		id := "oc_fixture"
		if r.opt["wrongId"] {
			id = "other"
		}
		return ok(with(obj{"call_id": id, "status": "completed", "answered_at": "2026-10-11T00:00:01Z", "completed_at": "2026-10-11T00:00:21Z"}, r.callExtra))
	case c.Path == "/logs/list_file/":
		if r.opt["failLogs"] {
			return status(500, obj{})
		}
		if r.files == nil {
			return ok([]any{})
		}
		return ok(r.files)
	case c.Path == "/logs/read_log/":
		if r.log != nil {
			return ok(r.log)
		}
		return ok(obj{"text": "user: ตกลงครับ"})
	}
	t.Fatalf("unexpected fixture request %s", c.Path)
	return reply{}
}

// invoke calls /workspace/calls/{id}/{path}; a nil body is a GET.
func (r *resultsFixture) invoke(body any, path string, campaignID string) response {
	if path == "" {
		path = "result"
	}
	route := "/workspace/calls/" + cbID + "/" + path
	if campaignID != "" {
		route += "?" + url.Values{"campaign_id": {campaignID}}.Encode()
	}
	method, raw := "GET", ""
	if body != nil {
		method, raw = "POST", jsonBody(body)
	}
	return serveHTTP(newApp(r.fixture, resultsEnv), method, "/event-confirm/api/voice?path="+url.QueryEscape(route), map[string]string{"Authorization": "Bearer fixture"}, raw)
}

func (r *resultsFixture) refresh() response { return r.invoke(nil, "", "") }

func (r *resultsFixture) recording(campaignID string) response {
	return r.invoke(nil, "recording", campaignID)
}

func (r *resultsFixture) voiceCalls() int {
	return r.count(func(c call) bool { return c.Host == "voice.invalid" })
}

func manualReview() obj {
	return obj{"call_result": "CONFIRMED", "needs_agent": false, "evidence": "Heard the recipient confirm", "expected_review_at": nil}
}

func TestCallResults(t *testing.T) {
	fixtureID := audioEntries([]any{resultsPath}, "agt_fixture", dateRange{"2026-10-10", "2026-10-12"})[0].ID
	run := func(name string, fn func(t *testing.T, r *resultsFixture)) {
		t.Run(name, func(t *testing.T) { fn(t, newResultsFixture(t)) })
	}
	response := func(r *resultsFixture) obj { return r.record["response"].(obj) }
	run("Foreign call rejected before accessing provider", func(t *testing.T, r *resultsFixture) {
		r.opt["foreign"] = true
		check(t, r.refresh().status == 404 && r.voiceCalls() == 0, "foreign call read")
	})
	run("Refresh persists actual completed state and missing evidence explicitly", func(t *testing.T, r *resultsFixture) {
		res := r.refresh()
		check(t, res.status == 200 && r.patch["status"] == "completed", "= %d %v", res.status, r.patch)
		check(t, get(res.data, "response", "followup", "outcome", "source") == "unavailable" && get(res.data, "response", "followup", "log_state") == "not_available", "followup %v", get(res.data, "response", "followup"))
	})
	run("Exact linked transcript and structured outputs are retrieved", func(t *testing.T, r *resultsFixture) {
		r.files = []any{"logs/oc_fixture.txt"}
		r.log = obj{"text": "user: yes", "outputs": obj{"call_result": "CONFIRMED", "needs_agent": false}}
		res := r.refresh()
		check(t, get(res.data, "response", "followup", "transcript") == "user: yes" && get(res.data, "response", "followup", "outcome", "call_result") == "CONFIRMED", "followup %v", get(res.data, "response", "followup"))
	})
	run("Log error does not lose completed status", func(t *testing.T, r *resultsFixture) {
		r.opt["failLogs"] = true
		res := r.refresh()
		check(t, res.status == 200 && r.patch["status"] == "completed" && get(res.data, "response", "followup", "log_state") == "error", "= %d %s", res.status, res.raw)
	})
	run("Wrong call ID and failed provider read never overwrite data", func(t *testing.T, r *resultsFixture) {
		r.opt["wrongId"] = true
		check(t, r.refresh().status == 502 && r.patch == nil, "wrong call ID written")
		r.opt = map[string]bool{"failStatus": true}
		check(t, r.refresh().status == 502 && r.patch == nil, "failed read written")
	})
	run("Unknown attempt without Call ID never redials", func(t *testing.T, r *resultsFixture) {
		r.record["call_id"] = nil
		res := r.refresh()
		check(t, truthy(res.data["warning"]) && r.patch == nil && r.voiceCalls() == 0, "= %s", res.raw)
	})
	run("Changing or disconnecting Voice Bot retains recorded results without fetching other account calls", func(t *testing.T, r *resultsFixture) {
		r.record["metadata"].(obj)["voice_account_id"] = "another_tenant"
		res := r.refresh()
		check(t, res.status == 200 && truthy(res.data["warning"]) && r.patch == nil && r.voiceCalls() == 0, "= %d %s", res.status, res.raw)
		r.opt["noConnection"] = true
		res = r.refresh()
		check(t, res.status == 200 && truthy(res.data["warning"]), "= %d %s", res.status, res.raw)
		check(t, r.invoke(manualReview(), "", "").status == 200, "review refused while disconnected")
	})
	run("Manual review requires valid typed fields and validates optional evidence", func(t *testing.T, r *resultsFixture) {
		for _, body := range []obj{with(manualReview(), obj{"evidence": 123}), with(manualReview(), obj{"call_result": "success"}), with(manualReview(), obj{"needs_agent": "false"})} {
			check(t, r.invoke(body, "", "").status == 400, "%v accepted", body)
		}
		check(t, r.patch == nil, "wrote")
	})
	run("Manual review preserves provider evidence and records owner and time", func(t *testing.T, r *resultsFixture) {
		response(r)["followup"] = obj{"outcome": obj{"call_result": "UNDETERMINED", "needs_agent": nil, "source": "unavailable"}, "transcript": "real text"}
		check(t, r.invoke(manualReview(), "", "").status == 200, "review refused")
		check(t, get(r.patch, "response", "review", "reviewed_by") == cbOwner && get(r.patch, "response", "followup", "transcript") == "real text", "patch %v", r.patch)
		check(t, truthy(get(r.patch, "response", "review", "updated_at")), "review time missing")
	})
	run("Stale or concurrent updates are visible conflicts", func(t *testing.T, r *resultsFixture) {
		response(r)["review"] = obj{"updated_at": "new"}
		check(t, r.invoke(manualReview(), "", "").status == 409, "stale review accepted")
		r.record["response"] = obj{}
		r.opt["conflict"] = true
		check(t, r.refresh().status == 409, "conflict hidden")
	})
	run("Refresh retains manual review and previously fetched evidence", func(t *testing.T, r *resultsFixture) {
		response(r)["review"] = with(manualReview(), obj{"updated_at": "time"})
		response(r)["followup"] = obj{"transcript": "saved text", "outcome": obj{"call_result": "DECLINED", "needs_agent": false, "source": "provider"}}
		check(t, r.refresh().status == 200, "refresh failed")
		check(t, get(r.patch, "response", "review", "call_result") == "CONFIRMED" && get(r.patch, "response", "followup", "transcript") == "saved text" &&
			get(r.patch, "response", "followup", "outcome", "call_result") == "DECLINED", "patch %v", r.patch)
	})
	run("Polling preserves callback result and compares its timestamp before writing", func(t *testing.T, r *resultsFixture) {
		response(r)["callback"] = obj{"received_at": "callback-time", "outcome": obj{"call_result": "CONFIRMED", "needs_agent": false, "source": "agent_tool"}}
		check(t, r.refresh().status == 200 && get(r.patch, "response", "callback", "received_at") == "callback-time", "callback lost: %v", r.patch)
	})
	run("An owned exact linked recording returns an authenticated playback path without storing a URL", func(t *testing.T, r *resultsFixture) {
		r.files = []any{resultsPath}
		r.callExtra = obj{"log_file_path": resultsPath}
		res := r.recording("")
		check(t, res.status == 200 && res.data["state"] == "available" && res.data["playback_path"] == "/workspace/calls/"+cbID+"/recording-audio" && !has(res.data, "url") && r.patch == nil, "= %d %s", res.status, res.raw)
		list := r.find(func(c call) bool { return c.Path == "/logs/list_file/" })
		check(t, list.Query.Get("start_date") == "2026/10/10" && list.Query.Get("end_date") == "2026/10/12", "listing range %v", list.Query)
		check(t, r.count(func(c call) bool { return c.Path == "/logs/audio_url" }) == 0, "audio_url used")
	})
	run("Missing recording returns a truthful empty state and never guesses another file", func(t *testing.T, r *resultsFixture) {
		r.files = []any{"logs/other.wav"}
		res := r.recording("")
		check(t, res.status == 200 && res.data["state"] == "not_available", "= %d %s", res.status, res.raw)
	})
	run("Foreign user or provider account cannot retrieve recording capabilities", func(t *testing.T, r *resultsFixture) {
		r.opt["foreign"] = true
		check(t, r.recording("").status == 404, "foreign user read")
		r.opt = map[string]bool{}
		r.record["metadata"].(obj)["voice_account_id"] = "other"
		check(t, r.recording("").status == 403 && r.voiceCalls() == 0, "foreign account read")
	})
	run("Unlinked Agent files are never exposed as campaign recording candidates", func(t *testing.T, r *resultsFixture) {
		r.files = []any{resultsPath, strings.Replace(resultsPath, "agt_fixture", "agt_other", 1)}
		res := r.recording("")
		check(t, res.data["state"] == "not_available" && !has(res.data, "candidates") && !has(res.data, "agent_id") && !has(res.data, "range") && r.patch == nil, "= %s", res.raw)
		check(t, r.invoke(nil, "recording-audio", "").status == 404, "unlinked audio served")
	})
	run("Campaign identity is checked before reading provider files", func(t *testing.T, r *resultsFixture) {
		check(t, r.recording(resultsCampaign).status == 404 && r.voiceCalls() == 0, "wrong campaign read")
		check(t, r.invoke(nil, "recording-audio", resultsCampaign).status == 404, "wrong campaign audio served")
	})
	run("Exact campaign recording retains campaign scope in playback path", func(t *testing.T, r *resultsFixture) {
		r.record["metadata"].(obj)["campaign_id"] = resultsCampaign
		r.files = []any{resultsPath}
		r.callExtra = obj{"log_file_path": resultsPath}
		res := r.recording(resultsCampaign)
		check(t, res.status == 200 && res.data["state"] == "available" && res.data["playback_path"] == "/workspace/calls/"+cbID+"/recording-audio?campaign_id="+resultsCampaign, "= %d %s", res.status, res.raw)
	})
	run("Arbitrary Agent files cannot be manually attached through the campaign route", func(t *testing.T, r *resultsFixture) {
		res := r.invoke(obj{"recording_id": fixtureID, "confirm": true, "expected_link_at": nil}, "recording", "")
		check(t, res.status == 405 && r.patch == nil && r.voiceCalls() == 0, "= %d", res.status)
	})
	run("Existing user-confirmed link stays with its own attempt and survives refresh", func(t *testing.T, r *resultsFixture) {
		r.files = []any{resultsPath}
		r.record["metadata"].(obj)["campaign_id"] = resultsCampaign
		stored := obj{"recording_id": fixtureID, "account_id": "tenant_fixture", "agent_id": "agt_fixture", "source": "manual", "updated_at": "saved-time"}
		response(r)["audio_link"] = stored
		res := r.recording(resultsCampaign)
		check(t, res.data["state"] == "available" && res.data["source"] == "manual", "= %s", res.raw)
		check(t, r.refresh().status == 200 && canon(get(r.patch, "response", "audio_link")) == canon(stored), "link lost: %v", r.patch)
		delete(response(r), "audio_link")
		check(t, r.recording(resultsCampaign).data["state"] == "not_available", "link guessed")
	})
	run("Provider recording callback reference must match request, Call ID and campaign", func(t *testing.T, r *resultsFixture) {
		r.files = []any{resultsPath}
		r.record["metadata"].(obj)["campaign_id"] = resultsCampaign
		link := obj{"recording_id": fixtureID, "account_id": "tenant_fixture", "agent_id": "agt_fixture", "source": "provider_callback", "request_id": cbID, "call_id": "oc_fixture",
			"campaign_id": resultsCampaign, "updated_at": "callback-time"}
		response(r)["audio_link"] = link
		res := r.recording(resultsCampaign)
		check(t, res.data["state"] == "available" && res.data["source"] == "provider_callback", "= %s", res.raw)
		for key, value := range map[string]string{"request_id": "other", "call_id": "oc_other", "campaign_id": "other"} {
			response(r)["audio_link"] = with(link, obj{key: value})
			check(t, r.recording(resultsCampaign).data["state"] == "not_available", "%s mismatch accepted", key)
		}
		check(t, r.patch == nil, "wrote")
	})
	run("Call history exact conversation key resolves the recording session to the campaign attempt", func(t *testing.T, r *resultsFixture) {
		r.record["metadata"].(obj)["campaign_id"] = resultsCampaign
		r.files = []any{resultsPath}
		r.detail = obj{"conversation": obj{"key": resultsPath, "agent_id": "agt_fixture", "linked_by": "exact"}}
		res := r.recording(resultsCampaign)
		check(t, res.status == 200 && res.data["state"] == "available" && res.data["source"] == "provider" &&
			res.data["playback_path"] == "/workspace/calls/"+cbID+"/recording-audio?campaign_id="+resultsCampaign && r.patch == nil, "= %d %s", res.status, res.raw)
	})
	run("Call history time guesses, wrong Agents, missing files and incomplete links are rejected", func(t *testing.T, r *resultsFixture) {
		r.files = []any{resultsPath}
		for _, conversation := range []obj{{"key": resultsPath, "agent_id": "agt_fixture", "linked_by": "time"}, {"key": resultsPath, "agent_id": "agt_other", "linked_by": "exact"},
			{"key": strings.Replace(resultsPath, "33333333", "55555555", 1), "agent_id": "agt_fixture", "linked_by": "exact"}, {"key": resultsPath, "agent_id": "agt_fixture"},
			{"key": "https://example.invalid/file.wav", "agent_id": "agt_fixture", "linked_by": "exact"}} {
			r.detail = obj{"conversation": conversation}
			check(t, r.recording("").data["state"] == "not_available", "%v accepted", conversation)
		}
		check(t, r.patch == nil, "wrote")
	})
	run("Wrong call history identity or failed lookup cannot expose a recording", func(t *testing.T, r *resultsFixture) {
		r.files = []any{resultsPath}
		r.detail = obj{"id": "oc_other", "conversation": obj{"key": resultsPath, "agent_id": "agt_fixture", "linked_by": "exact"}}
		check(t, r.recording("").status == 502, "wrong identity accepted")
		r.opt["failDetail"] = true
		check(t, r.recording("").status == 502 && r.patch == nil, "failed lookup accepted")
	})
}
