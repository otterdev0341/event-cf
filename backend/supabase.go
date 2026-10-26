package main

// Minimal Supabase client over HTTP: the PostgREST and Auth calls supabase-js made,
// with the same query syntax, so RLS and database functions behave as before.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// pgError is a PostgREST or Auth error response.
type pgError struct {
	Status  int
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *pgError) Error() string {
	return fmt.Sprintf("supabase %d %s: %s", e.Status, e.Code, e.Message)
}

// db talks to one Supabase project as either the service role or a signed-in user.
type db struct {
	app           *App
	ctx           context.Context
	apikey, token string
}

func (a *App) serviceDB(ctx context.Context) *db {
	return &db{app: a, ctx: ctx, apikey: a.cfg.ServiceRoleKey, token: a.cfg.ServiceRoleKey}
}

// userDB acts with the caller's own session, so row-level security applies.
func (a *App) userDB(ctx context.Context, sessionToken string) *db {
	return &db{app: a, ctx: ctx, apikey: a.cfg.PublishableKey, token: sessionToken}
}

// q is one query parameter; filters are kept in call order like postgrest-js.
type q struct{ key, value string }

func filterValue(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case int:
		return strconv.Itoa(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	}
	return fmt.Sprint(v)
}

func eq(column string, v any) q { return q{column, "eq." + filterValue(v)} }
func isNull(column string) q    { return q{column, "is.null"} }
func or(filters string) q       { return q{"or", "(" + filters + ")"} }
func order(spec string) q       { return q{"order", spec} }
func limit(n int) q             { return q{"limit", strconv.Itoa(n)} }
func offset(n int) q            { return q{"offset", strconv.Itoa(n)} }
func columns(cols string) q     { return q{"select", cols} }
func eqOrNull(column string, v any) q {
	if truthy(v) {
		return eq(column, v)
	}
	return isNull(column)
}

func in(column string, values ...string) q {
	quoted := make([]string, len(values))
	for i, v := range values {
		if strings.ContainsAny(v, ",()") {
			v = `"` + v + `"`
		}
		quoted[i] = v
	}
	return q{column, "in.(" + strings.Join(quoted, ",") + ")"}
}

func (d *db) do(method, path string, params []q, body any, prefer string) ([]byte, error) {
	if d.app.cfg.SupabaseURL == "" {
		return nil, &pgError{Status: 503, Message: "storage not configured"}
	}
	query := url.Values{}
	for _, p := range params {
		query.Add(p.key, p.value)
	}
	target := strings.TrimRight(d.app.cfg.SupabaseURL, "/") + path
	if len(params) > 0 {
		target += "?" + query.Encode()
	}
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	ctx, cancel := context.WithTimeout(d.ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", d.apikey)
	req.Header.Set("Authorization", "Bearer "+d.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if prefer != "" {
		req.Header.Set("Prefer", prefer)
	}
	res, err := d.app.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode >= 300 {
		e := &pgError{Status: res.StatusCode}
		json.Unmarshal(data, e)
		return nil, e
	}
	return data, nil
}

func rows(data []byte) ([]obj, error) {
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, nil
	}
	var out []obj
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Select returns the matching rows.
func (d *db) Select(table, cols string, params ...q) ([]obj, error) {
	data, err := d.do("GET", "/rest/v1/"+table, append([]q{columns(cols)}, params...), nil, "")
	if err != nil {
		return nil, err
	}
	return rows(data)
}

// MaybeSingle returns the only matching row, nil when none, and an error for several.
func (d *db) MaybeSingle(table, cols string, params ...q) (obj, error) {
	data, err := d.do("GET", "/rest/v1/"+table, append([]q{columns(cols)}, params...), nil, "")
	if err != nil {
		return nil, err
	}
	var v any
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, err
	}
	switch x := v.(type) {
	case nil:
		return nil, nil
	case obj:
		return x, nil
	case []any:
		if len(x) == 0 {
			return nil, nil
		}
		if row, ok := x[0].(obj); ok && len(x) == 1 {
			return row, nil
		}
	}
	return nil, &pgError{Status: 406, Code: "PGRST116", Message: "JSON object requested, multiple (or no) rows returned"}
}

func returning(cols string) ([]q, string) {
	if cols == "" {
		return nil, "return=minimal"
	}
	return []q{columns(cols)}, "return=representation"
}

// Insert adds rows; with cols set it returns the inserted rows.
func (d *db) Insert(table string, values any, cols string) ([]obj, error) {
	params, prefer := returning(cols)
	data, err := d.do("POST", "/rest/v1/"+table, params, values, prefer)
	if err != nil {
		return nil, err
	}
	return rows(data)
}

// Upsert inserts or merges on the primary key.
func (d *db) Upsert(table string, values any) error {
	_, err := d.do("POST", "/rest/v1/"+table, nil, values, "resolution=merge-duplicates,return=minimal")
	return err
}

// Update patches matching rows; with cols set it returns the updated rows.
func (d *db) Update(table string, values any, cols string, filters ...q) ([]obj, error) {
	params, prefer := returning(cols)
	data, err := d.do("PATCH", "/rest/v1/"+table, append(params, filters...), values, prefer)
	if err != nil {
		return nil, err
	}
	return rows(data)
}

// Delete removes matching rows; with cols set it returns the deleted rows.
func (d *db) Delete(table, cols string, filters ...q) ([]obj, error) {
	params, prefer := returning(cols)
	data, err := d.do("DELETE", "/rest/v1/"+table, append(params, filters...), nil, prefer)
	if err != nil {
		return nil, err
	}
	return rows(data)
}

// RPC calls a database function and returns its decoded result.
func (d *db) RPC(name string, args any) (any, error) {
	if args == nil {
		args = obj{}
	}
	data, err := d.do("POST", "/rest/v1/rpc/"+name, nil, args, "")
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, nil
	}
	return decodeJSON(data)
}

// User returns the user for a session token (auth.getUser).
func (d *db) User(sessionToken string) (obj, error) {
	user := &db{app: d.app, ctx: d.ctx, apikey: d.apikey, token: sessionToken}
	return user.authObject("/auth/v1/user")
}

// AdminUser loads a user by ID with the service role (auth.admin.getUserById).
func (d *db) AdminUser(id string) (obj, error) {
	return d.authObject("/auth/v1/admin/users/" + url.PathEscape(id))
}

func (d *db) authObject(path string) (obj, error) {
	data, err := d.do("GET", path, nil, nil, "")
	if err != nil {
		return nil, err
	}
	var user obj
	if err := json.Unmarshal(data, &user); err != nil || user == nil || strOr(user["id"]) == "" {
		return nil, &pgError{Status: 401, Message: "no user"}
	}
	return user, nil
}
