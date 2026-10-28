package main

import (
	"encoding/json"
	"log"
	"net/http"
	"slices"
)

func accountWebhookSecret(accountID, callbackSecret string) (string, error) {
	return accountSecret("voice-account-webhook-v1:", accountID, callbackSecret)
}

// handleAgentWebhook receives the Botnoi agent webhook sent after a call ends.
// ponytail: Botnoi does not document the payload, so this only authenticates and logs
// field names and types (never values). Store it against the call once a real payload is seen.
func (a *App) handleAgentWebhook(w http.ResponseWriter, r *http.Request) {
	setJSONHeaders(w)
	if r.Method != "POST" {
		w.Header().Set("Allow", "POST")
		send(w, 405, obj{"error": "POST required"})
		return
	}
	if !a.callbackConfigured() {
		send(w, 503, obj{"error": "Webhook receiver is not configured"})
		return
	}
	expected, err := accountWebhookSecret(r.URL.Query().Get("account"), a.cfg.CallbackSecret)
	if err != nil || !sameSecret(r.Header.Get("X-Voice-Webhook-Key"), expected) {
		send(w, 401, obj{"error": "Invalid webhook credentials"})
		return
	}
	raw, over, err := readLimited(r, 256000)
	if err != nil || over {
		send(w, 413, obj{"error": "Payload too large"})
		return
	}
	parsed, err := decodeJSON(raw)
	if err != nil {
		send(w, 400, obj{"error": "Invalid JSON"})
		return
	}
	shape := obj{}
	if body, ok := parsed.(obj); ok {
		for key := range body {
			shape[key] = jsonTypeName(body, key)
			if nested, ok := body[key].(obj); ok {
				keys := make([]string, 0, len(nested))
				for k := range nested {
					keys = append(keys, k)
				}
				slices.Sort(keys)
				shape[key] = keys
			}
		}
	}
	summary, _ := json.Marshal(shape)
	log.Printf("voice_agent_webhook bytes=%d fields=%s", len(raw), summary)
	send(w, 200, obj{"ok": true})
}
