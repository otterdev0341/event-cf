package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// A handler panic must reach the browser as JSON, not a dropped connection the edge turns into a bare 502.
func TestVoicePanicReturnsJSON(t *testing.T) {
	a := &App{cfg: Config{SupabaseURL: "https://supabase.invalid", PublishableKey: "key"}} // nil client panics on first use
	r := httptest.NewRequest("GET", "/event-confirm/api/voice?path=%2Fme", nil)
	r.Header.Set("Authorization", "Bearer token")
	w := httptest.NewRecorder()
	a.handleVoice(w, r, "", nil, r.Context(), nil)
	if w.Code != 500 || !strings.Contains(w.Body.String(), `"code":"internal_panic"`) || strings.Contains(w.Body.String(), "detail") {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
}
