package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAgentWebhookAuth(t *testing.T) {
	cfg := Config{SupabaseURL: "https://abc.supabase.co", ServiceRoleKey: "service", CallbackSecret: strings.Repeat("s", 32)}
	h := newServer("/event-confirm", nil, &App{cfg: cfg})
	key, _ := accountWebhookSecret("acct_fixture", cfg.CallbackSecret)
	post := func(account, supplied, body string) int {
		req := httptest.NewRequest("POST", "/event-confirm/api/voice-webhook?account="+account, strings.NewReader(body))
		req.Header.Set("X-Voice-Webhook-Key", supplied)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	cases := []struct {
		account, key, body string
		status             int
	}{
		{"acct_fixture", key, `{"call_id":"oc_1","transcript":"x"}`, 200},
		{"acct_other", key, `{}`, 401},
		{"acct_fixture", "", `{}`, 401},
		{"", key, `{}`, 401},
		{"acct_fixture", key, `not json`, 400},
	}
	for _, c := range cases {
		if got := post(c.account, c.key, c.body); got != c.status {
			t.Errorf("account %q key set %v body %q = %d, want %d", c.account, c.key != "", c.body, got, c.status)
		}
	}
}
