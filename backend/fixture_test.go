package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
)

// call is one outbound request seen by the fixture transport.
type call struct {
	Method, Host, Path string
	Query              url.Values
	Header             http.Header
	Body               any // decoded JSON body, or nil
}

// reply is a fixture response; status 0 simulates a network failure. An io.Reader, []byte or string
// body is sent as is; anything else is JSON.
type reply struct {
	status int
	body   any
	header http.Header
}

func ok(body any) reply               { return reply{status: 200, body: body} }
func status(code int, body any) reply { return reply{status: code, body: body} }

var networkFailure = reply{}

// fixture is an http.RoundTripper that records every request and answers from serve.
// It stands in for Supabase and Voice Bot, so no test touches the network.
type fixture struct {
	t     *testing.T
	mu    sync.Mutex
	calls []call
	log   []string // ordered markers: "METHOD host/path" per request, plus anything tests append
	serve func(c call) reply
}

func (f *fixture) mark(s string) {
	f.mu.Lock()
	f.log = append(f.log, s)
	f.mu.Unlock()
}

func (f *fixture) RoundTrip(r *http.Request) (*http.Response, error) {
	var raw []byte
	if r.Body != nil {
		raw, _ = io.ReadAll(r.Body)
	}
	var body any
	if len(raw) > 0 {
		body, _ = decodeJSON(raw)
	}
	c := call{Method: r.Method, Host: r.URL.Hostname(), Path: r.URL.Path, Query: r.URL.Query(), Header: r.Header.Clone(), Body: body}
	f.mu.Lock()
	f.calls = append(f.calls, c)
	f.log = append(f.log, r.Method+" "+c.Host+c.Path)
	f.mu.Unlock()
	rep := f.serve(c)
	if rep.status == 0 {
		return nil, errors.New("fixture network failure")
	}
	header := rep.header
	if header == nil {
		header = http.Header{}
	}
	var data []byte
	switch b := rep.body.(type) {
	case io.Reader:
		return &http.Response{StatusCode: rep.status, Header: header, Body: io.NopCloser(b), ContentLength: -1, Request: r}, nil
	case []byte:
		data = b
	case string:
		data = []byte(b)
	case nil:
		if rep.status != 204 {
			data = []byte("null")
		}
	default:
		data, _ = json.Marshal(b)
		if header.Get("Content-Type") == "" {
			header.Set("Content-Type", "application/json")
		}
	}
	length := int64(len(data))
	if n, err := strconv.ParseInt(header.Get("Content-Length"), 10, 64); err == nil {
		length = n
	}
	return &http.Response{StatusCode: rep.status, Header: header, Body: io.NopCloser(bytes.NewReader(data)), ContentLength: length, Request: r}, nil
}

// count returns how many recorded calls match.
func (f *fixture) count(match func(c call) bool) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if match(c) {
			n++
		}
	}
	return n
}

func (f *fixture) find(match func(c call) bool) *call {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := range f.calls {
		if match(f.calls[i]) {
			return &f.calls[i]
		}
	}
	return nil
}

func (f *fixture) reset() {
	f.mu.Lock()
	f.calls, f.log = nil, nil
	f.mu.Unlock()
}

func newApp(f *fixture, env map[string]string) *App {
	return &App{cfg: configFrom(func(k string) string { return env[k] }), client: newClient(f)}
}

func merge(base map[string]string, extra map[string]string) map[string]string {
	out := map[string]string{}
	for k, v := range base {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

// response is a handler result decoded for assertions.
type response struct {
	status int
	header http.Header
	raw    []byte
	data   obj
}

// serveHTTP sends one request through the real router.
func serveHTTP(a *App, method, target string, header map[string]string, body string) response {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	newServer("/event-confirm", fstest.MapFS{"index.html": {Data: []byte("app")}}, a).ServeHTTP(rec, req)
	out := response{status: rec.Code, header: rec.Header(), raw: rec.Body.Bytes()}
	if decoded, err := decodeJSON(out.raw); err == nil {
		out.data, _ = decoded.(obj)
	}
	return out
}

func jsonBody(v any) string { b, _ := json.Marshal(v); return string(b) }

// recordingWriter marks the moment a handler starts its response in the fixture log.
type recordingWriter struct {
	*httptest.ResponseRecorder
	f *fixture
}

func (w recordingWriter) WriteHeader(code int) {
	w.f.mark("response")
	w.ResponseRecorder.WriteHeader(code)
}

// direct runs a voiceRequest handler without the HTTP layer, mapping errors like the Node test harness
// (an error without a status reads as 502).
func direct(f *fixture, a *App, method string, user, conn obj, run func(v *voiceRequest) error) response {
	rec := httptest.NewRecorder()
	base, _ := url.Parse("https://voice.invalid")
	ctx := context.Background()
	v := &voiceRequest{app: a, ctx: ctx, w: recordingWriter{rec, f}, method: method, user: user, conn: conn, base: base, store: a.serviceDB(ctx), db: a.serviceDB(ctx)}
	err := run(v)
	if err != nil && !v.sent {
		status, msg := 502, err.Error()
		if he, ok := asHTTPError(err); ok {
			status, msg = he.status, he.msg
		}
		return response{status: status, data: obj{"error": msg}}
	}
	out := response{status: rec.Code, header: rec.Header(), raw: rec.Body.Bytes()}
	decoded, _ := decodeJSON(out.raw)
	out.data, _ = decoded.(obj)
	return out
}

func clone(v any) any { return roundJSON(v) }

func roundJSON(v any) any {
	data, _ := json.Marshal(v)
	out, _ := decodeJSON(data)
	return out
}
