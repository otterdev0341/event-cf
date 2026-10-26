package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// Config holds the server-only settings that the Node handlers read from process.env.
type Config struct {
	SupabaseURL     string // SUPABASE_URL or VITE_SUPABASE_URL
	PublishableKey  string // SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_PUBLISHABLE_KEY
	ServiceRoleKey  string
	EncryptionKey   string // VOICE_CONNECTION_ENCRYPTION_KEY
	CallbackSecret  string // VOICE_RESULT_CALLBACK_SECRET
	CallbackURL     string // VOICE_RESULT_CALLBACK_URL
	VoiceBotBaseURL string
	LogsBaseURL     string
	AccessMode      string
	AllowedEmails   string
	AllowedUserIDs  string
}

func configFromEnv() Config { return configFrom(os.Getenv) }

// configFrom reads the settings through getenv, so tests can supply their own environment.
func configFrom(getenv func(string) string) Config {
	first := func(keys ...string) string {
		for _, k := range keys {
			if v := getenv(k); v != "" {
				return v
			}
		}
		return ""
	}
	return Config{
		SupabaseURL:     first("SUPABASE_URL", "VITE_SUPABASE_URL"),
		PublishableKey:  first("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"),
		ServiceRoleKey:  getenv("SUPABASE_SERVICE_ROLE_KEY"),
		EncryptionKey:   getenv("VOICE_CONNECTION_ENCRYPTION_KEY"),
		CallbackSecret:  getenv("VOICE_RESULT_CALLBACK_SECRET"),
		CallbackURL:     getenv("VOICE_RESULT_CALLBACK_URL"),
		VoiceBotBaseURL: getenv("VOICE_BOT_BASE_URL"),
		LogsBaseURL:     getenv("VOICE_BOT_LOGS_BASE_URL"),
		AccessMode:      getenv("VOICE_ACCESS_MODE"),
		AllowedEmails:   getenv("VOICE_ALLOWED_EMAILS"),
		AllowedUserIDs:  getenv("VOICE_ALLOWED_USER_IDS"),
	}
}

// App carries configuration and the outbound HTTP client (replaced in tests).
type App struct {
	cfg    Config
	client *http.Client
}

// httpError is the Go form of the Node HttpError/fail(): its message goes to the client.
type httpError struct {
	status int
	msg    string
	code   string
}

func (e *httpError) Error() string { return e.msg }

func fail(status int, msg string) error { return &httpError{status: status, msg: msg} }

func asHTTPError(err error) (*httpError, bool) {
	var he *httpError
	ok := errors.As(err, &he)
	return he, ok
}

func setJSONHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
}

func send(w http.ResponseWriter, status int, v any) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// readLimited reads at most limit bytes; over reports a body larger than limit.
func readLimited(r *http.Request, limit int64) (body []byte, over bool, err error) {
	body, err = io.ReadAll(io.LimitReader(r.Body, limit+1))
	return body, int64(len(body)) > limit, err
}

// decodeJSON parses a JSON document into the dynamic form the handlers use.
func decodeJSON(data []byte) (any, error) {
	var v any
	err := json.Unmarshal(data, &v)
	return v, err
}

func splitList(value string) []string {
	var out []string
	for _, s := range strings.Split(value, ",") {
		if s = jsTrim(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

var jsonContentType = regexp.MustCompile(`(?i)^application/json(?:;|$)`)

var errRedirect = errors.New("redirects are not followed")

// newClient never follows redirects, like fetch(..., {redirect: 'error'}).
func newClient(transport http.RoundTripper) *http.Client {
	return &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return errRedirect }}
}

// request sends one upstream call with a bearer token and optional JSON body.
func (a *App) request(ctx context.Context, timeout time.Duration, method, target, token string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		cancel()
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := a.client.Do(req)
	if err != nil {
		cancel()
		return nil, err
	}
	res.Body = cancelOnClose{res.Body, cancel}
	return res, nil
}

type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}

func readJSON(res *http.Response) (any, error) {
	data, err := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	return decodeJSON(data)
}

// resolve is new URL(route, base): an absolute route path replaces the base path.
func resolve(base *url.URL, route string) (string, error) {
	ref, err := url.Parse(route)
	if err != nil {
		return "", err
	}
	return base.ResolveReference(ref).String(), nil
}
