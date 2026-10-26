// Command event-confirm serves the built frontend and the API under one base path.
// The API handlers are ports of the former Node server/*.mjs; each Vercel api/*.mjs route kept its path.
package main

import (
	"errors"
	"io/fs"
	"log"
	"net/http"
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
	return mux
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
	server := &http.Server{Addr: addr, Handler: newServer(base, os.DirFS(getenv("STATIC_DIR", "dist")), app), ReadHeaderTimeout: 10 * time.Second}
	log.Printf("listening on %s under %s/", addr, base)
	log.Fatal(server.ListenAndServe())
}
