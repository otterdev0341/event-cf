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
