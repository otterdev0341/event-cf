package main

// Port of the handler cases in scripts/test-inbound-events.mjs; the pure functions are covered by
// TestNodeGolden.

import (
	"strings"
	"testing"
)

const (
	inboundAccount = "account_fixture"
	inboundOwner   = "owner_fixture"
	inboundID      = "11111111-1111-4111-8111-111111111111"
)

func inboundCampaign() obj {
	return obj{"id": inboundID, "updated_at": "2026-10-14T00:00:00Z", "data": obj{"name": "Fixture event", "eventDate": "2026-10-20", "eventTime": "10:00",
		"csv":         obj{"headers": []any{"phone", "private_note"}, "rows": []any{[]any{"0812345678", "PRIVATE_CUSTOMER_NOTE"}}},
		"mapping":     obj{"phone": "phone"},
		"inboundInfo": obj{"accountId": inboundAccount, "enabled": true, "location": "Fixture venue", "details": "Public event details"}}}
}

type inboundCase struct {
	action, method, direction, connAccount string
	body                                   any
	race                                   bool
}

func runInbound(t *testing.T, c inboundCase) (response, *fixture) {
	if c.action == "" {
		c.action = "lookup"
	}
	if c.method == "" {
		c.method = "POST"
	}
	if c.direction == "" {
		c.direction = "inbound"
	}
	if c.connAccount == "" {
		c.connAccount = inboundAccount
	}
	if c.body == nil {
		c.body = obj{"call_id": "call_fixture"}
	}
	f := &fixture{t: t}
	f.serve = func(r call) reply {
		switch {
		case r.Host == "voice.invalid" && r.Path == "/me":
			return ok(obj{"_id": inboundAccount})
		case r.Host == "voice.invalid" && r.Path == "/calls/call_fixture":
			return ok(obj{"id": "call_fixture", "direction": c.direction, "number": "+66812345678"})
		case r.Host == "db.invalid" && r.Path == "/rest/v1/voice_campaigns" && r.Method == "GET":
			return ok([]any{inboundCampaign()})
		case r.Host == "db.invalid" && r.Path == "/rest/v1/voice_campaigns" && r.Method == "PATCH":
			if c.race {
				return ok([]any{})
			}
			row := inboundCampaign()
			row["data"] = get(r.Body, "data")
			return ok([]any{row})
		}
		t.Fatalf("unexpected call %s %s%s", r.Method, r.Host, r.Path)
		return reply{}
	}
	a := newApp(f, map[string]string{"SUPABASE_URL": "https://db.invalid", "SUPABASE_SERVICE_ROLE_KEY": "service"})
	r := direct(f, a, c.method, obj{"id": inboundOwner}, obj{"account_id": c.connAccount, "owner_id": inboundOwner}, func(v *voiceRequest) error {
		return v.handleInboundEvents(c.action, inboundID, c.body)
	})
	return r, f
}

func campaignQueries(f *fixture, key, value string) int {
	return f.count(func(c call) bool { return c.Path == "/rest/v1/voice_campaigns" && c.Query.Get(key) == "eq."+value })
}

func patches(f *fixture) []call {
	var out []call
	for _, c := range f.calls {
		if c.Method == "PATCH" {
			out = append(out, c)
		}
	}
	return out
}

func TestInboundEvents(t *testing.T) {
	t.Run("Authenticated lookup reads canonical number by call ID and scopes database owner/state", func(t *testing.T) {
		r, f := runInbound(t, inboundCase{})
		check(t, r.status == 200 && r.data["status"] == "matched", "lookup = %d %v", r.status, r.data)
		check(t, campaignQueries(f, "owner_id", inboundOwner) > 0 && campaignQueries(f, "state", "saved") > 0, "query not scoped")
		check(t, len(patches(f)) == 0, "lookup wrote")
		check(t, !strings.Contains(string(r.raw), "PRIVATE_CUSTOMER_NOTE"), "lookup leaked CSV")
	})
	t.Run("Reject client supplied phone numbers and outbound call identities", func(t *testing.T) {
		r, _ := runInbound(t, inboundCase{body: obj{"call_id": "call_fixture", "phone_number": "0812345678"}})
		check(t, r.status == 400, "client phone = %d", r.status)
		r, _ = runInbound(t, inboundCase{direction: "outbound"})
		check(t, r.status == 404, "outbound call = %d", r.status)
	})
	t.Run("Connection mismatch fails before reading campaign records", func(t *testing.T) {
		r, f := runInbound(t, inboundCase{connAccount: "other_account"})
		check(t, r.status == 403 && f.count(func(c call) bool { return c.Host == "db.invalid" }) == 0, "mismatch = %d", r.status)
	})
	t.Run("Stale event edits cannot overwrite campaign data", func(t *testing.T) {
		r, f := runInbound(t, inboundCase{action: "save", body: obj{"account_id": inboundAccount, "enabled": true, "location": "Fixture", "details": "Facts", "expected_updated_at": "stale"}})
		check(t, r.status == 409 && len(patches(f)) == 0, "stale save = %d", r.status)
	})
	t.Run("Event save preserves CSV and outbound data and checks owner, state and timestamp", func(t *testing.T) {
		r, f := runInbound(t, inboundCase{action: "save", body: obj{"account_id": inboundAccount, "enabled": true, "location": "New venue", "details": "New factual details", "expected_updated_at": "2026-10-14T00:00:00Z"}})
		check(t, r.status == 200, "save = %d %v", r.status, r.data)
		writes := patches(f)
		check(t, len(writes) == 1, "%d writes", len(writes))
		data := get(writes[0].Body, "data")
		check(t, canon(get(data, "csv")) == canon(get(inboundCampaign(), "data", "csv")) && get(data, "eventDate") == "2026-10-20", "campaign data changed")
		check(t, get(data, "inboundInfo", "accountId") == inboundAccount, "account not stored")
		check(t, campaignQueries(f, "owner_id", inboundOwner) == 2, "owner filter count")
		check(t, writes[0].Query.Get("updated_at") == "eq.2026-10-14T00:00:00Z", "update not guarded by timestamp")
	})
	t.Run("Concurrent event save reports conflict rather than success", func(t *testing.T) {
		r, _ := runInbound(t, inboundCase{action: "save", race: true, body: obj{"account_id": inboundAccount, "enabled": true, "location": "New venue", "details": "Facts", "expected_updated_at": "2026-10-14T00:00:00Z"}})
		check(t, r.status == 409, "race = %d", r.status)
	})
}

// Handler cases from scripts/test-general-events.mjs.

var generalEnv = map[string]string{"SUPABASE_URL": "https://general-db.invalid", "SUPABASE_SERVICE_ROLE_KEY": "fixture-service",
	"VOICE_RESULT_CALLBACK_SECRET": "fixture-general-longer-than-32-characters"}

func TestGeneralEventTool(t *testing.T) {
	const account = "account_fixture"
	token, _ := generalCredential(cbOwner, account, generalEnv["VOICE_RESULT_CALLBACK_SECRET"])
	setup := func(t *testing.T, connected string) *fixture {
		f := &fixture{t: t}
		f.serve = func(c call) reply {
			check(t, c.Host == "general-db.invalid" && c.Header.Get("apikey") == "fixture-service" && c.Query.Get("owner_id") == "eq."+cbOwner, "unscoped request %s%s", c.Host, c.Path)
			if strings.HasSuffix(c.Path, "/voice_bot_connections") {
				return ok(obj{"account_id": connected})
			}
			check(t, strings.HasSuffix(c.Path, "/voice_campaigns") && c.Query.Get("state") == "eq.saved", "unexpected %s", c.Path)
			return ok([]any{obj{"id": "22222222-2222-4222-8222-222222222222", "data": obj{"name": "งานประชุม", "eventDate": "2026-10-20", "eventTime": "10:00",
				"csv":         obj{"rows": []any{[]any{"PRIVATE_PHONE", "PRIVATE_NAME"}}},
				"inboundInfo": obj{"accountId": account, "enabled": true, "publicEnabled": true, "location": "Public venue", "details": "Public facts"}}}})
		}
		return f
	}
	invoke := func(f *fixture, method, bearer, body string) response {
		return serveHTTP(newApp(f, generalEnv), method, "/event-confirm/api/voice-events", map[string]string{"Authorization": "Bearer " + bearer, "Content-Type": "application/json"}, body)
	}
	empty := `{"query":"","event_id":""}`
	t.Run("Scoped authentication reads current connection and only owner campaigns", func(t *testing.T) {
		f := setup(t, account)
		r := invoke(f, "POST", token, empty)
		check(t, r.status == 200 && r.data["status"] == "choose_event" && len(f.calls) == 2, "= %d %s after %d calls", r.status, r.raw, len(f.calls))
		check(t, !strings.Contains(string(r.raw), "PRIVATE_"), "private data leaked")
	})
	t.Run("Forged credentials fail before database requests", func(t *testing.T) {
		f := setup(t, account)
		last := "A"
		if strings.HasSuffix(token, "A") {
			last = "B"
		}
		check(t, invoke(f, "POST", token[:len(token)-1]+last, empty).status == 401 && len(f.calls) == 0, "forged token accepted")
	})
	t.Run("Account replacement revokes previously issued lookup access", func(t *testing.T) {
		f := setup(t, "different")
		check(t, invoke(f, "POST", token, empty).status == 401 && len(f.calls) == 1, "old account accepted")
	})
	t.Run("Team account mode checks the shared account, not personal connections", func(t *testing.T) {
		for teamAccount, want := range map[string]int{account: 200, "different": 401} {
			f := setup(t, "unused")
			campaigns := f.serve
			f.serve = func(c call) reply {
				if c.Path == "/me" {
					return ok(obj{"_id": teamAccount})
				}
				check(t, !strings.HasSuffix(c.Path, "/voice_bot_connections"), "personal connection read in team mode")
				return campaigns(c)
			}
			env := merge(generalEnv, map[string]string{"VOICE_BOT_ACCESS_TOKEN": validJWT("TEAM")})
			r := serveHTTP(newApp(f, env), "POST", "/event-confirm/api/voice-events", map[string]string{"Authorization": "Bearer " + token, "Content-Type": "application/json"}, empty)
			check(t, r.status == want, "team account %s = %d %s", teamAccount, r.status, r.raw)
		}
	})
	t.Run("Caller identity and arbitrary scope cannot be supplied by the tool", func(t *testing.T) {
		f := setup(t, account)
		for _, body := range []obj{{"query": "", "event_id": "", "phone": "PRIVATE_PHONE"}, {"query": "", "event_id": "", "owner_id": cbOwner}, {"query": "", "event_id": "invalid"},
			{"query": strings.Repeat("x", 161), "event_id": ""}} {
			check(t, invoke(f, "POST", token, jsonBody(body)).status == 400, "%v accepted", body)
		}
		check(t, len(f.calls) == 0, "database called")
	})
	t.Run("Malformed JSON, oversized bodies and unsupported methods fail closed", func(t *testing.T) {
		f := setup(t, account)
		check(t, invoke(f, "POST", token, "invalid").status == 400, "malformed accepted")
		check(t, invoke(f, "POST", token, strings.Repeat("x", 2049)).status == 413, "oversized accepted")
		check(t, invoke(f, "GET", token, "").status == 405, "GET allowed")
	})
}
