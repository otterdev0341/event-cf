package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestServerRoutes(t *testing.T) {
	static := fstest.MapFS{
		"index.html":    {Data: []byte("<html>app</html>")},
		"assets/app.js": {Data: []byte("console.log(1)")},
	}
	h := newServer("/event-confirm", static, &App{})
	cases := []struct {
		method, url string
		status      int
		body        string
	}{
		{"GET", "/event-confirm/healthz", 200, "ok\n"},
		{"GET", "/event-confirm?x=1", 308, ""},
		{"POST", "/event-confirm/api/voice-result", 503, `"error"`},
		{"GET", "/event-confirm/api/voice-scheduler", 503, `"Scheduler unavailable"`},
		{"GET", "/event-confirm/api/missing", 404, `"Not found"`},
		{"GET", "/event-confirm/", 200, "app"},
		{"GET", "/event-confirm/campaigns/42", 200, "app"},
		{"GET", "/event-confirm/assets/app.js", 200, "console.log"},
		{"GET", "/event-confirm/assets/", 200, "app"},
		{"GET", "/event-confirm/../etc/passwd", 307, ""},
		{"POST", "/event-confirm/campaigns", 405, ""},
		{"GET", "/other", 404, ""},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(c.method, c.url, nil))
		if rec.Code != c.status || !strings.Contains(rec.Body.String(), c.body) {
			t.Errorf("%s %s = %d %q", c.method, c.url, rec.Code, rec.Body.String())
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/event-confirm?x=1", nil))
	if loc := rec.Header().Get("Location"); loc != "/event-confirm/?x=1" {
		t.Errorf("redirect Location = %q", loc)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/event-confirm/assets/app.js", nil))
	if rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Errorf("asset Cache-Control = %q", rec.Header().Get("Cache-Control"))
	}
}

func TestSecurityHeaders(t *testing.T) {
	static := fstest.MapFS{"index.html": {Data: []byte("app")}, "api-docs.html": {Data: []byte("docs")}}
	h := newServer("/event-confirm", static, &App{cfg: Config{SupabaseURL: "https://abc.supabase.co"}})
	csp := func(url string) string {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", url, nil))
		if rec.Header().Get("X-Frame-Options") != "DENY" || rec.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s missing hardening headers: %v", url, rec.Header())
		}
		return rec.Header().Get("Content-Security-Policy")
	}
	app := csp("/event-confirm/campaigns")
	if !strings.Contains(app, "script-src 'self';") || !strings.Contains(app, "https://abc.supabase.co wss://abc.supabase.co") || strings.Contains(app, "jsdelivr") {
		t.Errorf("app CSP = %q", app)
	}
	if docs := csp("/event-confirm/api-docs.html"); !strings.Contains(docs, "script-src https://cdn.jsdelivr.net;") {
		t.Errorf("docs CSP = %q", docs)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/event-confirm/index.html", nil))
	if rec.Header().Get("Cache-Control") == "public, max-age=31536000, immutable" {
		t.Error("index.html cached as immutable")
	}
	if api := csp("/event-confirm/api/voice-result"); !strings.Contains(api, "frame-ancestors 'none'") {
		t.Errorf("API CSP = %q", api)
	}
}

func TestRootOnDisk(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.html"), []byte("app"), 0o644)
	rec := httptest.NewRecorder()
	newServer("/event-confirm", os.DirFS(dir), &App{}).ServeHTTP(rec, httptest.NewRequest("GET", "/event-confirm/", nil))
	if rec.Code != 200 || rec.Body.String() != "app" {
		t.Fatalf("root = %d %q", rec.Code, rec.Body.String())
	}
}
