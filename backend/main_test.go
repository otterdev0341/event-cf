package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestServerRoutes(t *testing.T) {
	static := fstest.MapFS{
		"index.html":    {Data: []byte("<html>app</html>")},
		"assets/app.js": {Data: []byte("console.log(1)")},
	}
	h := newServer("/event-confirm", static)
	cases := []struct {
		method, url string
		status      int
		body        string
	}{
		{"GET", "/event-confirm/healthz", 200, "ok\n"},
		{"GET", "/event-confirm?x=1", 308, ""},
		{"POST", "/event-confirm/api/voice-result", 503, `"not_configured"`},
		{"GET", "/event-confirm/api/voice", 503, `"not_configured"`},
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
