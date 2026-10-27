package main

// Port of the handler cases in scripts/test-voice-connection.mjs.

import (
	"bytes"
	"encoding/base64"
	"maps"
	"net/url"
	"strings"
	"testing"
	"time"
)

type connFixture struct {
	*fixture
	user    string
	records map[string]obj
	opt     map[string]bool
}

var connEnv = map[string]string{"VITE_SUPABASE_URL": "https://connection-db.invalid", "VITE_SUPABASE_PUBLISHABLE_KEY": "fixture-public", "SUPABASE_SERVICE_ROLE_KEY": "fixture-service",
	"VOICE_CONNECTION_ENCRYPTION_KEY": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)), "VOICE_BOT_BASE_URL": "https://voice.invalid"}

const connOther = "22222222-2222-4222-8222-222222222222"

func testJWT(account string, exp int64) string {
	enc := base64.RawURLEncoding.EncodeToString
	return enc([]byte(`{"alg":"HS256","typ":"JWT"}`)) + "." + enc([]byte(jsonBody(obj{"sub": account, "exp": exp}))) + ".fixture_signature"
}

func validJWT(account string) string { return testJWT(account, time.Now().Unix()+3600) }

func newConnFixture(t *testing.T) *connFixture {
	c := &connFixture{fixture: &fixture{t: t}, user: goldenOwner, records: map[string]obj{}, opt: map[string]bool{}}
	c.serve = c.reply
	return c
}

func (c *connFixture) reply(r call) reply {
	t := c.t
	if r.Host == "connection-db.invalid" {
		if r.Path == "/auth/v1/user" {
			return ok(obj{"id": c.user, "email": c.user + "@example.invalid", "email_confirmed_at": "2026-01-01", "app_metadata": obj{"role": "dev"}})
		}
		check(t, r.Path == "/rest/v1/voice_bot_connections" && r.Header.Get("apikey") == "fixture-service", "unexpected store call %s", r.Path)
		own := strings.TrimPrefix(r.Query.Get("owner_id"), "eq.")
		if own == "" {
			own = c.user
		}
		check(t, own == c.user, "only the authenticated owner may use the credential store")
		original := c.records[own]
		if r.Method == "GET" {
			if original == nil {
				return ok(nil)
			}
			return ok(original)
		}
		if expected := strings.TrimPrefix(r.Query.Get("updated_at"), "eq."); expected != "" && (original == nil || original["updated_at"] != expected) {
			return ok([]any{})
		}
		if r.Method == "DELETE" {
			delete(c.records, own)
			return ok([]any{obj{"owner_id": own}})
		}
		value := r.Body.(obj)
		check(t, value["owner_id"] == c.user && !has(value, "token") && strings.HasPrefix(strOr(value["token_ciphertext"]), "v1."), "stored value %v", value)
		if c.opt["storageFail"] {
			return status(500, obj{"message": "private storage failure"})
		}
		if r.Method == "POST" && original != nil {
			return status(409, obj{"message": "duplicate"})
		}
		c.records[own] = value
		return ok([]any{obj{"owner_id": own}})
	}
	if r.Host == "voice.invalid" {
		check(t, r.Method == "GET" && r.Path == "/me", "connection action called %s %s", r.Method, r.Path)
		if c.opt["invalidToken"] {
			return status(401, obj{"message": "private upstream failure"})
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims, _ := base64.RawURLEncoding.DecodeString(strings.Split(token, ".")[1])
		decoded, _ := decodeJSON(claims)
		sub := strOr(get(decoded, "sub"))
		return ok(obj{"_id": "tenant_" + sub, "username": "Account " + sub, "email": sub + "@example.invalid", "verified": true, "password": "do-not-return"})
	}
	t.Fatalf("unexpected request %s%s", r.Host, r.Path)
	return reply{}
}

func (c *connFixture) invoke(body any, route string, headers ...map[string]string) response {
	if route == "" {
		route = "/workspace/connection"
	}
	h := map[string]string{"Authorization": "Bearer fixture-session"}
	if len(headers) > 0 {
		for k, v := range headers[0] {
			h[k] = v
		}
	}
	method, raw := "GET", ""
	if body != nil {
		method, raw = "POST", jsonBody(body)
	}
	return serveHTTP(newApp(c.fixture, connEnv), method, "/event-confirm/api/voice?path="+url.QueryEscape(route), h, raw)
}

func (c *connFixture) connect(token string, revision any, id string) response {
	return c.invoke(obj{"action": "connect", "token": token, "confirm": true, "expected_account_id": id, "expected_updated_at": revision}, "")
}

func TestConnectionAPI(t *testing.T) {
	run := func(name string, fn func(t *testing.T, c *connFixture)) {
		t.Run(name, func(t *testing.T) { fn(t, newConnFixture(t)) })
	}
	key := connEnv["VOICE_CONNECTION_ENCRYPTION_KEY"]
	run("AES-GCM ciphertext is randomized, authenticated and bound to the owner", func(t *testing.T, c *connFixture) {
		token := validJWT("A")
		a, _ := sealToken(token, goldenOwner, key)
		b, _ := sealToken(token, goldenOwner, key)
		check(t, a != b, "ciphertext not randomized")
		opened, err := openToken(a, goldenOwner, key)
		check(t, err == nil && opened == token, "round trip failed")
		_, err = openToken(a, connOther, key)
		check(t, err != nil, "opened for another owner")
		_, err = openToken(a[:len(a)-4]+"AAAA", goldenOwner, key)
		check(t, err != nil, "tampered ciphertext opened")
		_, err = sealToken(token, goldenOwner, "short")
		check(t, err != nil, "short key accepted")
	})
	run("Unlinked members see a connect state and never inherit a global account", func(t *testing.T, c *connFixture) {
		check(t, canon(c.invoke(nil, "").data) == `{"connected":false}`, "unlinked state")
		check(t, c.invoke(nil, "/me").status == 428, "global account used")
		check(t, c.count(func(r call) bool { return r.Host == "voice.invalid" }) == 0, "Voice Bot called")
	})
	run("Verify shows actual provider identity but neither stores nor returns JWT", func(t *testing.T, c *connFixture) {
		token := validJWT("A")
		r := c.invoke(obj{"action": "verify", "token": token}, "")
		check(t, r.status == 200 && get(r.data, "account", "account_id") == "tenant_A" && len(c.records) == 0, "= %d %v", r.status, r.data)
		check(t, !strings.Contains(string(r.raw), token) && !strings.Contains(string(r.raw), "do-not-return"), "response leaks token")
	})
	run("Connect requires exact reviewed account and explicit confirmation", func(t *testing.T, c *connFixture) {
		check(t, c.invoke(obj{"action": "connect", "token": validJWT("A"), "confirm": false, "expected_account_id": "tenant_A"}, "").status == 409, "unconfirmed connect")
		check(t, c.connect(validJWT("A"), nil, "tenant_B").status == 409 && len(c.records) == 0, "wrong account connected")
	})
	run("Personal JWT is encrypted before storage and never returned in GET", func(t *testing.T, c *connFixture) {
		token := validJWT("A")
		check(t, c.connect(token, nil, "tenant_A").status == 200, "connect failed")
		opened, err := openToken(strOr(c.records[goldenOwner]["token_ciphertext"]), goldenOwner, key)
		check(t, err == nil && opened == token, "stored token wrong")
		r := c.invoke(nil, "")
		check(t, r.data["username"] == "Account A" && !strings.Contains(string(r.raw), token) && !strings.Contains(string(r.raw), "token_ciphertext"), "GET %s", r.raw)
		check(t, c.invoke(nil, "/me").data["_id"] == "tenant_A", "stored token not used")
	})
	run("Two website users keep separate Voice Bot accounts", func(t *testing.T, c *connFixture) {
		c.connect(validJWT("A"), nil, "tenant_A")
		c.user = connOther
		check(t, c.invoke(nil, "").data["connected"] == false, "second user inherited a connection")
		c.connect(validJWT("B"), nil, "tenant_B")
		check(t, c.invoke(nil, "/me").data["_id"] == "tenant_B", "second user account")
		c.user = goldenOwner
		check(t, c.invoke(nil, "/me").data["_id"] == "tenant_A" && len(c.records) == 2, "first user account")
	})
	run("Credential replacement and disconnect reject stale previews", func(t *testing.T, c *connFixture) {
		c.connect(validJWT("A"), nil, "tenant_A")
		check(t, c.connect(validJWT("B"), nil, "tenant_B").status == 409, "replacement without revision")
		check(t, c.invoke(obj{"action": "disconnect", "confirm": true, "expected_updated_at": "stale"}, "").status == 409, "stale disconnect")
		check(t, c.records[goldenOwner]["account_id"] == "tenant_A", "connection changed")
	})
	run("Same-account token renewal and deliberate account replacement work", func(t *testing.T, c *connFixture) {
		c.connect(validJWT("A"), nil, "tenant_A")
		check(t, c.connect(testJWT("A", time.Now().Unix()+7200), c.records[goldenOwner]["updated_at"], "tenant_A").status == 200, "renewal failed")
		check(t, c.connect(validJWT("B"), c.records[goldenOwner]["updated_at"], "tenant_B").status == 200, "replacement failed")
		check(t, c.invoke(nil, "/me").data["_id"] == "tenant_B", "replacement not used")
	})
	run("Malformed, expired and rejected JWTs never overwrite a valid connection", func(t *testing.T, c *connFixture) {
		c.connect(validJWT("A"), nil, "tenant_A")
		previous := canon(c.records[goldenOwner])
		for _, token := range []string{"password", testJWT("A", 1)} {
			check(t, c.invoke(obj{"action": "verify", "token": token}, "").status == 400, "%s accepted", token)
		}
		c.opt["invalidToken"] = true
		check(t, c.invoke(obj{"action": "verify", "token": validJWT("B")}, "").status == 400, "rejected token accepted")
		check(t, canon(c.records[goldenOwner]) == previous, "connection overwritten")
	})
	run("Requests cannot specify another owner, ciphertext, callback secret or destination", func(t *testing.T, c *connFixture) {
		for _, extra := range []obj{{"owner_id": connOther}, {"account_id": "other"}, {"token_ciphertext": "v1.forged"}, {"endpoint": "https://evil.invalid"}, {"callback_secret": "forged"}} {
			body := obj{"action": "verify", "token": validJWT("A")}
			for k, v := range extra {
				body[k] = v
			}
			check(t, c.invoke(body, "").status == 400, "%v accepted", extra)
		}
		check(t, len(c.records) == 0, "stored")
	})
	run("Cross-site credential writes are rejected before storage access", func(t *testing.T, c *connFixture) {
		r := c.invoke(obj{"action": "verify", "token": validJWT("A")}, "", map[string]string{"Sec-Fetch-Site": "cross-site"})
		check(t, r.status == 403 && len(c.calls) == 1, "= %d after %d calls", r.status, len(c.calls))
	})
	run("Disconnect removes only the current user credential", func(t *testing.T, c *connFixture) {
		c.connect(validJWT("A"), nil, "tenant_A")
		c.user = connOther
		c.connect(validJWT("B"), nil, "tenant_B")
		c.user = goldenOwner
		check(t, c.invoke(obj{"action": "disconnect", "confirm": true, "expected_updated_at": c.records[goldenOwner]["updated_at"]}, "").status == 200, "disconnect failed")
		_, mine := c.records[goldenOwner]
		_, theirs := c.records[connOther]
		check(t, !mine && theirs, "wrong credential removed")
		check(t, c.invoke(nil, "/me").status == 428, "disconnected account still used")
	})
}

func TestSharedTeamAccount(t *testing.T) {
	c := newConnFixture(t)
	env := maps.Clone(connEnv)
	env["VOICE_BOT_ACCESS_TOKEN"] = validJWT("TEAM")
	app := newApp(c.fixture, env)
	connection := func(body any) response {
		method, raw := "GET", ""
		if body != nil {
			method, raw = "POST", jsonBody(body)
		}
		return serveHTTP(app, method, "/event-confirm/api/voice?path="+url.QueryEscape("/workspace/connection"), map[string]string{"Authorization": "Bearer fixture-session"}, raw)
	}
	r := connection(nil)
	check(t, r.data["shared"] == true && r.data["account_id"] == "tenant_TEAM" && !strings.Contains(string(r.raw), env["VOICE_BOT_ACCESS_TOKEN"]), "GET %s", r.raw)
	c.user = connOther
	check(t, serveHTTP(app, "GET", "/event-confirm/api/voice?path=%2Fme", map[string]string{"Authorization": "Bearer fixture-session"}, "").data["_id"] == "tenant_TEAM", "second user not on team account")
	check(t, connection(obj{"action": "verify", "token": validJWT("A")}).status == 403 && len(c.records) == 0, "personal connection allowed in shared mode")
	check(t, c.count(func(r call) bool { return r.Path == "/me" && r.Host == "voice.invalid" }) == 2, "team /me not cached")
}
