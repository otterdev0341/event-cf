package main

import (
	"context"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// roleDev and roleAdmin are the two positions stored in Supabase app_metadata.role.
// Only the service role can write app_metadata, so this endpoint is the one place that does.
const (
	roleDev   = "dev"
	roleAdmin = "admin"
)

func validRole(role string) bool { return role == roleDev || role == roleAdmin }

// roleOf reads the position of a Supabase user; anyone without a role counts as admin.
func roleOf(user obj) string {
	if get(user, "app_metadata", "role") == roleDev {
		return roleDev
	}
	return roleAdmin
}

// devCount counts the users that currently hold the dev position.
func devCount(users []any) int {
	n := 0
	for _, item := range users {
		if user, ok := item.(obj); ok && roleOf(user) == roleDev {
			n++
		}
	}
	return n
}

// canChangeRole refuses to remove the last dev, which would lock everyone out of role management.
func canChangeRole(target obj, role string, users []any) bool {
	return roleOf(target) != roleDev || role == roleDev || devCount(users) > 1
}

// handleUsers lists website users (GET) and changes a user's position (POST). Dev only.
func (a *App) handleUsers(w http.ResponseWriter, r *http.Request) {
	setJSONHeaders(w)
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	if err := a.serveUsers(ctx, w, r); err != nil {
		if he, ok := asHTTPError(err); ok {
			send(w, he.status, obj{"error": he.msg})
			return
		}
		send(w, 503, obj{"error": "เชื่อมต่อบริการไม่ได้ กรุณาลองใหม่"})
	}
}

func (a *App) serveUsers(ctx context.Context, w http.ResponseWriter, r *http.Request) error {
	if r.Method != "GET" && r.Method != "POST" {
		w.Header().Set("Allow", "GET, POST")
		return fail(405, "ไม่อนุญาตให้เรียกบริการนี้")
	}
	if a.cfg.SupabaseURL == "" || a.cfg.PublishableKey == "" || a.cfg.ServiceRoleKey == "" {
		return fail(503, "ผู้ดูแลยังตั้งค่าการเชื่อมต่อเซิร์ฟเวอร์ไม่ครบ")
	}
	bearer := r.Header.Get("Authorization")
	if !validBearer(bearer) {
		return fail(401, "กรุณาเข้าสู่ระบบ")
	}
	if r.Method == "POST" && r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return fail(403, "ไม่อนุญาตคำขอจากเว็บไซต์อื่น")
	}
	caller, err := a.cachedUser(a.userDB(ctx, strings.TrimPrefix(bearer, "Bearer ")), strings.TrimPrefix(bearer, "Bearer "))
	if err != nil {
		return fail(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่")
	}
	if !isDev(caller) {
		return fail(403, "เฉพาะทีมพัฒนาเท่านั้น")
	}
	store := a.serviceDB(ctx)
	users, err := listAuthUsers(store)
	if err != nil {
		return fail(503, "อ่านรายชื่อผู้ใช้ไม่ได้ กรุณาลองใหม่")
	}
	if r.Method == "GET" {
		return sendJSON(w, 200, obj{"users": publicUsers(users), "me": caller["id"]})
	}

	raw, over, err := readLimited(r, 2000)
	if err != nil || over {
		return fail(413, "คำขอใหญ่เกินไป")
	}
	parsed, err := decodeJSON(raw)
	body, ok := parsed.(obj)
	if err != nil || !ok {
		return fail(400, "รูปแบบคำขอไม่ถูกต้อง")
	}
	id, role := strOr(body["user_id"]), strOr(body["role"])
	if id == "" || !validRole(role) {
		return fail(400, "ต้องระบุผู้ใช้และตำแหน่ง dev หรือ admin")
	}
	idx := slices.IndexFunc(users, func(item any) bool {
		user, ok := item.(obj)
		return ok && strOr(user["id"]) == id
	})
	if idx < 0 {
		return fail(404, "ไม่พบผู้ใช้นี้")
	}
	if !canChangeRole(users[idx].(obj), role, users) {
		return fail(409, "ต้องมีผู้ใช้ตำแหน่ง dev อย่างน้อย 1 คน")
	}
	if _, err := store.do("PUT", "/auth/v1/admin/users/"+url.PathEscape(id), nil, obj{"app_metadata": obj{"role": role}}, ""); err != nil {
		return fail(503, "เปลี่ยนตำแหน่งไม่สำเร็จ กรุณาลองใหม่")
	}
	return sendJSON(w, 200, obj{"ok": true, "user_id": id, "role": role})
}

// listAuthUsers loads the first 200 users with the service role.
// shortcut: no paging, upgrade when the site has more than 200 users.
func listAuthUsers(store *db) ([]any, error) {
	data, err := store.do("GET", "/auth/v1/admin/users", []q{{"per_page", "200"}}, nil, "")
	if err != nil {
		return nil, err
	}
	parsed, err := decodeJSON(data)
	if err != nil {
		return nil, err
	}
	list, _ := get(parsed, "users").([]any)
	return list, nil
}

// publicUsers keeps only what the settings page shows: no metadata, tokens or identities.
func publicUsers(users []any) []any {
	out := make([]any, 0, len(users))
	for _, item := range users {
		user, ok := item.(obj)
		if !ok {
			continue
		}
		out = append(out, obj{"id": user["id"], "email": user["email"], "role": roleOf(user), "last_sign_in_at": user["last_sign_in_at"]})
	}
	return out
}

func sendJSON(w http.ResponseWriter, status int, data any) error {
	send(w, status, data)
	return nil
}
