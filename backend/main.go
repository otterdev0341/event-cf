// Command event-confirm serves the built frontend and the API under one base path.
// The API handlers are ports of the former Node server/*.mjs; each Vercel api/*.mjs route kept its path.
package main

import (
	"errors"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func newServer(base string, static fs.FS, a *App) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+base+"/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("ok\n"))
	})
	mux.HandleFunc(base+"/api/voice", func(w http.ResponseWriter, r *http.Request) { a.handleVoice(w, r, "", nil, nil, nil) })
	mux.HandleFunc(base+"/api/voice-result", a.handleResultCallback)
	mux.HandleFunc(base+"/api/voice-recording", a.handleRecordingCallback)
	mux.HandleFunc(base+"/api/voice-events", a.handleGeneralEventTool)
	mux.HandleFunc(base+"/api/voice-scheduler", a.handleScheduler)
	mux.HandleFunc(base+"/api/", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w)
		send(w, http.StatusNotFound, obj{"error": "Not found"})
	})
	mux.Handle(base+"/", spa(base, static))
	mux.HandleFunc("GET "+base, func(w http.ResponseWriter, r *http.Request) {
		target := base + "/"
		if r.URL.RawQuery != "" {
			target += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, target, http.StatusPermanentRedirect)
	})
	return securityHeaders(base, a.cfg.SupabaseURL, mux)
}

// securityHeaders sets browser hardening headers on every response.
// HSTS is left to the shared edge proxy, which owns TLS for the whole host.
func securityHeaders(base, supabaseURL string, next http.Handler) http.Handler {
	// Voice preview streams to the provider WebSocket returned by workspace.go.
	connect := "'self' wss://voicebot-ws-stg.botnoigroup.com"
	if u, err := url.Parse(supabaseURL); err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" {
		ws := "wss"
		if u.Scheme == "http" {
			ws = "ws"
		}
		connect += " " + u.Scheme + "://" + u.Host + " " + ws + "://" + u.Host
	}
	common := "; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
	// index.html loads Google Sans from Google Fonts.
	app := "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com" +
		"; media-src 'self' blob:; worker-src 'self'; connect-src " + connect + common
	// ReDoc loads its pinned bundle (SRI-checked) from jsDelivr, injects styles and runs search in a blob worker.
	docs := "default-src 'none'; script-src https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src 'self' data:" +
		"; font-src 'self' data:; worker-src blob:; connect-src 'self'" + common
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		policy := app
		if r.URL.Path == base+"/api-docs.html" {
			policy = docs
		}
		h.Set("Content-Security-Policy", policy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), payment=(), usb=()")
		next.ServeHTTP(w, r)
	})
}

// spa serves files from static and falls back to index.html for client-side routes.
func spa(base string, static fs.FS) http.Handler {
	files := http.StripPrefix(base, http.FileServerFS(static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(strings.TrimPrefix(r.URL.Path, base)), "/")
		if name == "" {
			name = "." // os.DirFS rejects ""
		}
		if info, err := fs.Stat(static, name); err != nil || info.IsDir() {
			if !errors.Is(err, fs.ErrNotExist) && err != nil {
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			http.ServeFileFS(w, r, static, "index.html")
			return
		}
		files.ServeHTTP(w, r)
	})
}

func main() {
	base := strings.TrimRight(getenv("BASE_PATH", "/event-confirm"), "/")
	addr := getenv("ADDR", ":80")
	app := &App{cfg: configFromEnv(), client: newClient(http.DefaultTransport)}
	// No WriteTimeout: WAV recordings up to 16 MB stream to slow clients; handlers bound their own upstream work.
	server := &http.Server{Addr: addr, Handler: newServer(base, os.DirFS(getenv("STATIC_DIR", "dist")), app),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second, MaxHeaderBytes: 64 << 10}
	log.Printf("listening on %s under %s/", addr, base)
	log.Fatal(server.ListenAndServe())
}
