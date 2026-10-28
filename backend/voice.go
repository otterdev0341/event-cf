package main

// Port of server/voice.mjs: the authenticated browser API behind /api/voice?path=...
// It never accepts an upstream URL from the client; only the routes below are allowed.

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// voiceRequest is one /api/voice call, from the browser or from the scheduler worker.
type voiceRequest struct {
	app    *App
	ctx    context.Context
	w      http.ResponseWriter
	r      *http.Request // nil for the worker
	method string
	user   obj
	db     *db // caller session client; the service client for the worker
	store  *db // service client for server-only tables
	conn   obj // stored connection with decrypted "token", or nil
	base   *url.URL
	logs   *url.URL
	worker *worker
	body   any // worker request body
	sent   bool
	timing *serverTiming
}

// serverTiming adds a Server-Timing header (auth, connection and upstream phases) when the response starts,
// so slow requests can be diagnosed from the browser Network panel.
type serverTiming struct {
	http.ResponseWriter
	start                time.Time
	auth, conn, upstream time.Duration
	calls                int
	done                 bool
}

func (s *serverTiming) WriteHeader(code int) {
	if !s.done {
		s.done = true
		ms := func(d time.Duration) string { return strconv.FormatFloat(float64(d.Microseconds())/1000, 'f', 1, 64) }
		s.Header().Set("Server-Timing", "auth;dur="+ms(s.auth)+", conn;dur="+ms(s.conn)+", upstream;dur="+ms(s.upstream)+
			";desc=\""+strconv.Itoa(s.calls)+" calls\", total;dur="+ms(time.Since(s.start)))
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *serverTiming) Write(b []byte) (int, error) {
	if !s.done {
		s.WriteHeader(http.StatusOK)
	}
	return s.ResponseWriter.Write(b)
}

// worker is the context the scheduler builds; it never comes from HTTP data.
type worker struct {
	db   *db
	user obj
	job  obj
}

func (v *voiceRequest) send(status int, data any) error {
	send(v.w, status, data)
	v.sent = true
	return nil
}

// readBody is bodyOf(): at most 32000 bytes of JSON, an empty body reads as {}.
func (v *voiceRequest) readBody() (any, error) {
	if v.r == nil {
		if len(jsStringify(v.body)) > 32000 {
			return nil, fail(413, "ข้อมูลคำขอใหญ่เกินไป")
		}
		return v.body, nil
	}
	data, over, err := readLimited(v.r, 32000)
	if err != nil {
		return nil, err
	}
	if over {
		return nil, fail(413, "ข้อมูลคำขอใหญ่เกินไป")
	}
	if len(data) == 0 {
		data = []byte("{}")
	}
	body, err := decodeJSON(data)
	if err != nil {
		return nil, fail(400, "รูปแบบคำขอไม่ถูกต้อง")
	}
	return body, nil
}

func (v *voiceRequest) bodyIfPost() (any, error) {
	if v.method != "POST" {
		return nil, nil
	}
	return v.readBody()
}

// upstream calls the Voice Bot API with the caller's connected token.
func (v *voiceRequest) upstream(route string, body any, method string) (any, error) {
	if v.timing != nil {
		defer func(start time.Time) { v.timing.upstream += time.Since(start); v.timing.calls++ }(time.Now())
	}
	if method == "" {
		method = "GET"
		if body != nil {
			method = "POST"
		}
	}
	target, err := resolve(v.base, route)
	if err != nil {
		return nil, err
	}
	res, err := v.app.request(v.ctx, 20*time.Second, method, target, strOr(v.conn["token"]), body)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return nil, fail(428, "Voice Bot ไม่รับสิทธิ์ของ Token นี้ ไปที่ตั้งค่าเพื่อเชื่อม Session JWT ใหม่")
	}
	if route == "/call/tokens" && res.StatusCode == 503 {
		details, _ := readJSON(res)
		if get(details, "detail") == "token_mint_not_configured" || get(details, "code") == "token_mint_not_configured" {
			return nil, &httpError{503, "บริการทดสอบเสียงของ Voice Bot ยังไม่ได้เปิดใช้งาน ต้องให้ผู้ดูแล Voice Bot ตั้งค่าบริการก่อนเริ่มคุย", "preview_not_configured"}
		}
		return nil, &httpError{503, "บริการทดสอบเสียงของ Voice Bot ไม่พร้อมชั่วคราว กรุณาลองใหม่ภายหลัง", "preview_service_unavailable"}
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		status := 502
		if res.StatusCode == 429 {
			status = 429
		}
		return nil, fail(status, fmt.Sprintf("บริการ Voice Bot ตอบกลับ HTTP %d", res.StatusCode))
	}
	return readJSON(res)
}

func (v *voiceRequest) get(route string) (any, error) { return v.upstream(route, nil, "") }

// logsFetch returns the raw response of the recordings service; the caller closes it.
func (v *voiceRequest) logsFetch(route string) (*http.Response, error) {
	target, err := resolve(v.logs, route)
	if err != nil {
		return nil, err
	}
	res, err := v.app.request(v.ctx, 30*time.Second, "GET", target, strOr(v.conn["token"]), nil)
	if err != nil {
		return nil, err
	}
	if res.StatusCode == 401 || res.StatusCode == 403 {
		res.Body.Close()
		return nil, fail(428, "Voice Bot ไม่รับสิทธิ์ดึงเสียง ไปที่ตั้งค่าเพื่อเชื่อม Session JWT ใหม่")
	}
	return res, nil
}

// me fetches /me and checks it is the connected account.
func (v *voiceRequest) me(message string) (obj, error) {
	account, err := v.get("/me")
	if err != nil {
		return nil, err
	}
	if !jsSame(get(account, "_id"), v.conn["account_id"]) {
		return nil, fail(403, message)
	}
	m, _ := account.(obj)
	return m, nil
}

// hasAgent reports whether the connected account owns agent id.
func hasAgent(agents any, id any) bool {
	list, ok := agents.([]any)
	if !ok {
		return false
	}
	for _, a := range list {
		if jsSame(get(a, "agent_id"), id) && get(a, "agent_id") != nil {
			return true
		}
	}
	return false
}

func (v *voiceRequest) ownsAgent(id any, message string) error {
	agents, err := v.get("/agents")
	if err != nil {
		return err
	}
	if !hasAgent(agents, id) {
		return fail(403, message)
	}
	return nil
}

var secretKey = regexp.MustCompile(`(?i)token|secret|password|credential|api.?key|authorization`)

// clean drops credential-like keys from provider responses before they reach the browser.
func clean(value any) any {
	switch x := value.(type) {
	case []any:
		out := make([]any, len(x))
		for i, item := range x {
			out[i] = clean(item)
		}
		return out
	case obj:
		out := obj{}
		for k, item := range x {
			if !secretKey.MatchString(k) {
				out[k] = clean(item)
			}
		}
		return out
	}
	return value
}

func pick(value any, keys ...string) obj {
	out := obj{}
	for _, k := range keys {
		if item := get(value, k); has(value, k) {
			out[k] = item
		}
	}
	return out
}

const uuidPattern = `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`

var (
	uuidRe          = regexp.MustCompile(`(?i)^` + uuidPattern + `$`)
	tenantRouteRe   = regexp.MustCompile(`^/v1/provisioning/tenants/([a-zA-Z0-9_-]+)(/overview|/trunk/status|/calls(?:/([a-zA-Z0-9_-]+))?)?$`)
	agentRouteRe    = regexp.MustCompile(`^/agents/([a-zA-Z0-9_-]+)$`)
	callLogRouteRe  = regexp.MustCompile(`^/logs/call_logs_platform/[a-zA-Z0-9_-]+$`)
	resultRouteRe   = regexp.MustCompile(`(?i)^/workspace/calls/(` + uuidPattern + `)/result$`)
	recordingRe     = regexp.MustCompile(`(?i)^/workspace/calls/(` + uuidPattern + `)/(recording|recording-audio)$`)
	audioRouteRe    = regexp.MustCompile(`^/workspace/agents/(agt_[a-zA-Z0-9_-]+)/audio(?:/([0-9a-f]{64}))?$`)
	setupRouteRe    = regexp.MustCompile(`^/workspace/agents/(agt_[a-zA-Z0-9_-]+)/(result-setup|transcript-setup|general-setup)$`)
	previewRouteRe  = regexp.MustCompile(`^/workspace/agents/(agt_[a-zA-Z0-9_-]+)/preview-token$`)
	inboundEventRe  = regexp.MustCompile(`(?i)^/workspace/inbound/events/([0-9a-f-]{36})$`)
	scheduleRouteRe = regexp.MustCompile(`(?i)^/workspace/campaigns/([0-9a-f-]{36})/schedule$`)
	encodedSepRe    = regexp.MustCompile(`(?i)%2f|%5c|\.\.`)
	destinationRe   = regexp.MustCompile(`^\+?[0-9]{8,15}$`)
	callbackRefRe   = regexp.MustCompile(`\{\{vc_call_reference\}\}`)
	voiceInvalid, _ = url.Parse("https://voice.invalid")
)

var readRoutes = []string{"/me", "/agents", "/dashboard/v1/overview", "/logs/call_logs_platform", "/platform-config/tools"}

// isDev reads the role from Supabase app_metadata, which only the service role can write.
// Never use user_metadata here: users can edit it themselves.
func isDev(user obj) bool { return get(user, "app_metadata", "role") == "dev" }

func validBearer(header string) bool {
	token, ok := strings.CutPrefix(header, "Bearer ")
	return ok && token != "" && !strings.ContainsFunc(token, isJSSpace)
}

// accessAllowed applies VOICE_ACCESS_MODE to a signed-in user.
func (a *App) accessAllowed(user obj) error {
	mode := jsTrim(a.cfg.AccessMode)
	if mode == "" {
		mode = "members"
	}
	switch mode {
	case "members":
		if !truthy(user["email"]) || !truthy(user["email_confirmed_at"]) {
			return fail(403, "กรุณายืนยันอีเมลของคุณก่อนใช้งาน Voice Bot")
		}
	case "allowlist":
		email, _ := user["email"].(string)
		allowed := slices.Contains(splitList(a.cfg.AllowedUserIDs), strOr(user["id"])) ||
			(truthy(user["email_confirmed_at"]) && email != "" && slices.ContainsFunc(splitList(a.cfg.AllowedEmails), func(e string) bool { return strings.EqualFold(e, email) }))
		if !allowed {
			return fail(403, "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้ Voice Bot กรุณาให้ผู้ดูแลเพิ่มสิทธิ์")
		}
	default:
		return fail(503, "ผู้ดูแลตั้งค่าโหมดสิทธิ์ไม่ถูกต้อง")
	}
	return nil
}

// handleVoice serves /api/voice for the browser (wk == nil) and for the scheduler worker.
func (a *App) handleVoice(w http.ResponseWriter, r *http.Request, endpoint string, wk *worker, ctx context.Context, body any) {
	setJSONHeaders(w)
	timing := &serverTiming{ResponseWriter: w, start: time.Now()}
	w = timing
	v := &voiceRequest{app: a, ctx: ctx, w: w, worker: wk, body: body, timing: timing}
	if wk == nil {
		v.r = r
		v.method = r.Method
		if v.method == "" {
			v.method = "GET"
		}
		var cancel context.CancelFunc
		v.ctx, cancel = context.WithTimeout(r.Context(), 45*time.Second)
		defer cancel()
		endpoint = r.URL.Query().Get("path")
	} else {
		v.method = "GET"
		if body != nil {
			v.method = "POST"
		}
	}
	err := v.serve(endpoint)
	if err == nil || v.sent {
		return
	}
	if he, ok := asHTTPError(err); ok {
		out := obj{"error": he.msg}
		if he.code != "" {
			out["code"] = he.code
		}
		send(w, he.status, out)
		return
	}
	send(w, 503, obj{"error": "เชื่อมต่อบริการไม่ได้ กรุณาลองใหม่"})
}

func (v *voiceRequest) serve(endpoint string) error {
	a := v.app
	if a.cfg.SupabaseURL == "" || a.cfg.PublishableKey == "" {
		return fail(503, "ผู้ดูแลยังตั้งค่าการเชื่อมต่อเซิร์ฟเวอร์ไม่ครบ")
	}
	if v.worker == nil {
		bearer := v.r.Header.Get("Authorization")
		if !validBearer(bearer) {
			return fail(401, "กรุณาเข้าสู่ระบบ")
		}
		session := strings.TrimPrefix(bearer, "Bearer ")
		v.db = a.userDB(v.ctx, session)
		started := time.Now()
		user, err := a.cachedUser(v.db, session)
		v.timing.auth = time.Since(started)
		if err != nil {
			return fail(401, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่")
		}
		v.user = user
	} else {
		v.db, v.user = v.worker.db, v.worker.user
		banned, ok := jsDateParse(v.user["banned_until"])
		if truthy(v.user["deleted_at"]) || (ok && banned > nowMS()) {
			return fail(403, "บัญชีนี้ถูกระงับการใช้งาน")
		}
	}
	if err := a.accessAllowed(v.user); err != nil {
		return err
	}

	if !strings.HasPrefix(endpoint, "/") || strings.ContainsAny(endpoint, "\\#\r\n") || strings.HasPrefix(endpoint, "//") {
		return fail(400, "เส้นทางไม่ถูกต้อง")
	}
	// Encoded separators are invalid in the path; query values can contain them (e.g. Asia/Bangkok).
	requestedPath, rawQuery, _ := strings.Cut(endpoint, "?")
	if encodedSepRe.MatchString(requestedPath) {
		return fail(400, "เส้นทางไม่ถูกต้อง")
	}
	ref, err := url.Parse(strings.ReplaceAll(requestedPath, "\t", ""))
	if err != nil || ref.Host != "" || ref.Scheme != "" {
		return fail(400, "เส้นทางไม่ถูกต้อง")
	}
	path := voiceInvalid.ResolveReference(ref).EscapedPath()
	query := parseQuery(rawQuery)
	method := v.method
	if v.r != nil && method == "POST" && v.r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return fail(403, "ไม่อนุญาตคำขอจากเว็บไซต์อื่น")
	}

	tenantRoute := tenantRouteRe.FindStringSubmatch(path)
	agentRoute := agentRouteRe.FindStringSubmatch(path)
	readAllowed := slices.Contains(readRoutes, path) || agentRoute != nil || callLogRouteRe.MatchString(path) ||
		(tenantRoute != nil && tenantRoute[2] != "/calls")
	resultRoute := resultRouteRe.FindStringSubmatch(path)
	isResult := resultRoute != nil && (method == "GET" || method == "POST")
	recordingRoute := recordingRe.FindStringSubmatch(path)
	isRecording := recordingRoute != nil && method == "GET"
	audioRoute := audioRouteRe.FindStringSubmatch(path)
	isAudio := audioRoute != nil && method == "GET"
	setupRoute := setupRouteRe.FindStringSubmatch(path)
	isSetup := setupRoute != nil && (method == "GET" || method == "POST")
	previewRoute := previewRouteRe.FindStringSubmatch(path)
	isPreview := previewRoute != nil && method == "POST"
	isConnection := path == "/workspace/connection" && (method == "GET" || method == "POST")
	isUsage := path == "/workspace/usage" && method == "GET"
	inboundAction := ""
	switch {
	case path == "/workspace/inbound" && method == "GET":
		inboundAction = "overview"
	case path == "/workspace/inbound/history" && method == "GET":
		inboundAction = "history"
	case path == "/workspace/inbound/bind" && method == "POST":
		inboundAction = "bind"
	}
	inboundEventRoute := inboundEventRe.FindStringSubmatch(path)
	inboundEventAction := ""
	switch {
	case path == "/workspace/inbound/events" && method == "GET":
		inboundEventAction = "list"
	case path == "/workspace/inbound/lookup" && method == "POST":
		inboundEventAction = "lookup"
	case inboundEventRoute != nil && method == "POST":
		inboundEventAction = "save"
	}
	scheduleRoute := scheduleRouteRe.FindStringSubmatch(path)
	isSchedule := scheduleRoute != nil && (method == "GET" || method == "POST")
	isCall := method == "POST" && tenantRoute != nil && tenantRoute[2] == "/calls"
	if !(method == "GET" && readAllowed) && !isCall && !isResult && !isSetup && !isConnection && !isRecording && !isAudio &&
		!isPreview && !isUsage && inboundAction == "" && inboundEventAction == "" && !isSchedule {
		return fail(405, "ไม่อนุญาตให้เรียกบริการนี้")
	}
	// The bot test page (preview) and the Voice Bot account card are dev-only.
	if (isPreview || isConnection) && !isDev(v.user) {
		return fail(403, "เฉพาะทีมพัฒนาเท่านั้น")
	}

	queryKeys := []string{"agent_id", "limit", "start_at", "end_at", "timezone", "granularity", "include", "month"}
	switch {
	case isAudio:
		queryKeys = []string{"start_date", "end_date"}
	case isRecording:
		queryKeys = []string{"campaign_id"}
	case path == "/dashboard/v1/overview" || isUsage:
		queryKeys = append(queryKeys, "source")
	}
	for _, p := range query {
		if !slices.Contains(queryKeys, p.key) || jsLen(p.value) > 200 {
			return fail(400, "พารามิเตอร์ไม่ถูกต้อง")
		}
	}
	if source, ok := query.lookup("source"); ok {
		allowed := []string{"outbound", "preview"}
		if isUsage {
			allowed = []string{"all", "outbound", "inbound"}
		}
		if !slices.Contains(allowed, source) {
			return fail(400, "ประเภทการใช้งานไม่ถูกต้อง")
		}
	}
	search := ""
	if rawQuery != "" {
		search = "?" + rawQuery
	}
	if l, ok := query.lookup("limit"); ok {
		n, err := strconv.ParseFloat(jsTrim(l), 64)
		if jsTrim(l) == "" || err != nil || n == 0 || n != n {
			n = 50
		}
		query.set("limit", jsString(min(100, max(1, n))))
		search = "?" + query.encode()
	}
	if v.base, err = a.voiceBotBase(); err != nil {
		return err
	}
	if v.store, err = a.connectionStore(v.ctx); err != nil {
		return fail(503, "ผู้ดูแลยังตั้งค่าระบบเชื่อมบัญชีไม่ครบ")
	}
	started := time.Now()
	v.conn, err = a.loadConnection(v.store, v.user)
	v.timing.conn = time.Since(started)
	if err != nil {
		return err
	}

	if isSchedule {
		body, err := v.bodyIfPost()
		if err != nil {
			return err
		}
		return v.handleSchedule(body, scheduleRoute[1])
	}
	if isConnection {
		body, err := v.bodyIfPost()
		if err != nil {
			return err
		}
		return a.handleConnection(v, body)
	}
	// Saved evidence and manual review remain available even when a token expires or an account changes.
	if isResult && method == "POST" {
		body, err := v.readBody()
		if err != nil {
			return err
		}
		return v.handleCallResult(resultRoute[1], body, nil)
	}
	connExpired := v.conn != nil && expired(v.conn["expires_at"])
	if isResult && (v.conn == nil || connExpired) {
		noAccount := ""
		return v.handleCallResult(resultRoute[1], nil, &noAccount)
	}
	if v.conn == nil && a.cfg.SharedToken != "" {
		return fail(503, "บัญชี Voice Bot ของทีมใช้ไม่ได้ ผู้ดูแลต้องตรวจ VOICE_BOT_ACCESS_TOKEN")
	}
	if v.conn == nil {
		return fail(428, "ยังไม่ได้เชื่อมบัญชี Voice Bot ไปที่ตั้งค่าแล้วใส่ Session JWT ของคุณ")
	}
	if connExpired {
		return fail(428, "Session JWT ของ Voice Bot หมดอายุ ไปที่ตั้งค่าเพื่อเชื่อมใหม่")
	}
	if isAudio || isRecording {
		raw := a.cfg.LogsBaseURL
		if raw == "" {
			raw = "https://backend-voicebot-stg.botnoigroup.com"
		}
		logs, err := url.Parse(raw)
		if err != nil || logs.Scheme != "https" || logs.User != nil || logs.RawQuery != "" || logs.ForceQuery || logs.Fragment != "" {
			return fail(503, "การตั้งค่าบริการเสียงไม่ถูกต้อง")
		}
		v.logs = logs
	}
	accountID := strOr(v.conn["account_id"])
	switch {
	case isAudio:
		return v.handleAudioLibrary(audioRoute[1], audioRoute[2], query)
	case isUsage:
		return v.handleUsage(query)
	case inboundAction != "":
		body, err := v.bodyIfPost()
		if err != nil {
			return err
		}
		return v.handleInbound(inboundAction, body)
	case inboundEventAction != "":
		body, err := v.bodyIfPost()
		if err != nil {
			return err
		}
		id := ""
		if inboundEventRoute != nil {
			id = inboundEventRoute[1]
		}
		return v.handleInboundEvents(inboundEventAction, id, body)
	case isPreview:
		body, err := v.readBody()
		if err != nil {
			return err
		}
		return v.handlePreview(previewRoute[1], body)
	case isSetup:
		body, err := v.bodyIfPost()
		if err != nil {
			return err
		}
		cfg := a.cfg
		if setupRoute[2] != "general-setup" && jsLen(cfg.CallbackSecret) >= 32 {
			if cfg.CallbackSecret, err = accountCallbackSecret(accountID, cfg.CallbackSecret); err != nil {
				return err
			}
		}
		return v.handleAgentSetup(setupRoute[1], body, cfg, setupRoute[2] == "transcript-setup", setupRoute[2] == "general-setup")
	case isRecording:
		campaignID, hasCampaign := query.lookup("campaign_id")
		return v.handleRecording(recordingRoute[1], recordingRoute[2] == "recording-audio", campaignID, hasCampaign)
	case isResult:
		return v.handleCallResult(resultRoute[1], nil, &accountID)
	}

	if tenantRoute != nil {
		// The team account was already checked against /me when its connection was cached.
		var account any = obj{"_id": v.conn["account_id"]}
		if v.conn["shared"] != true {
			if account, err = v.get("/me"); err != nil {
				return err
			}
		}
		if !jsSame(get(account, "_id"), v.conn["account_id"]) || tenantRoute[1] != get(account, "_id") {
			return fail(403, "ไม่มีสิทธิ์เข้าถึงบัญชีนี้")
		}
	}
	agentFilter, hasAgentFilter := query.lookup("agent_id")
	if agentRoute != nil || isCall || hasAgentFilter {
		// Membership in the upstream account is checked again on the server.
		agents, err := v.get("/agents")
		if err != nil {
			return err
		}
		if agentRoute != nil && !hasAgent(agents, agentRoute[1]) {
			return fail(403, "ไม่มีสิทธิ์ใช้ Agent นี้")
		}
		if hasAgentFilter && !hasAgent(agents, agentFilter) {
			return fail(403, "ไม่มีสิทธิ์ใช้ Agent นี้")
		}
		if isCall {
			return v.placeCall(path, agents)
		}
	}
	var ownedCall obj
	if method == "GET" && tenantRoute != nil && tenantRoute[3] != "" {
		row, err := v.db.MaybeSingle("voice_call_requests", "id,metadata", eq("call_id", tenantRoute[3]), eq("owner_id", v.user["id"]))
		if err != nil || row == nil {
			return fail(404, "ไม่พบคำขอโทรในบัญชีนี้")
		}
		if !jsSame(get(row, "metadata", "voice_account_id"), v.conn["account_id"]) {
			return fail(403, "สายนี้ใช้บัญชี Voice Bot อีกบัญชี กรุณาเชื่อมบัญชีเดิม")
		}
		ownedCall = row
	}
	result, err := v.get(path + search)
	if err != nil {
		return err
	}
	if path == "/me" && !jsSame(get(result, "_id"), v.conn["account_id"]) {
		return fail(403, "บัญชี Voice Bot เปลี่ยนแล้ว กรุณาเชื่อมใหม่")
	}
	if status, ok := get(result, "status").(string); ownedCall != nil && ok {
		if get(result, "call_id") != tenantRoute[3] {
			return fail(502, "Call ID จากบริการไม่ตรงกับคำขอ")
		}
		if _, err := v.db.Update("voice_call_requests", obj{"status": status}, "", eq("id", ownedCall["id"]), eq("owner_id", v.user["id"])); err != nil {
			result.(obj)["persistence_warning"] = "อ่านสถานะล่าสุดแล้ว แต่บันทึกไม่ได้"
		}
	}
	if path == "/me" {
		return v.send(200, pick(result, "_id", "username", "role", "permissions", "email", "verified"))
	}
	return v.send(200, clean(result))
}

// placeCall reserves and submits one outbound call.
func (v *voiceRequest) placeCall(path string, agents any) error {
	a := v.app
	raw, err := v.readBody()
	if err != nil {
		return err
	}
	body, ok := raw.(obj)
	if !ok {
		return fail(400, "รูปแบบคำขอไม่ถูกต้อง")
	}
	destination, _ := body["destination"].(string)
	if body["consent"] != true || !destinationRe.MatchString(destination) || !hasAgent(agents, body["agent_id"]) {
		return fail(400, "กรุณาตรวจเบอร์ Agent และยืนยันการโทร")
	}
	agentID := body["agent_id"].(string)
	requestID, _ := body["request_id"].(string)
	if !uuidRe.MatchString(requestID) {
		return fail(400, "ไม่มีรหัสคำขอโทร")
	}
	bodyMeta, _ := body["metadata"].(obj)
	if !truthy(get(bodyMeta, "campaign_id")) && !isDev(v.user) {
		return fail(403, "โทรทดสอบได้เฉพาะทีมพัฒนา ผู้ใช้ทั่วไปโทรผ่านแคมเปญเท่านั้น")
	}
	variablesValue := any(obj{})
	if bodyMeta != nil && bodyMeta["variables"] != nil {
		variablesValue = bodyMeta["variables"]
	}
	variables, ok := variablesValue.(obj)
	if !ok || len(variables) > 50 {
		return fail(400, "ข้อมูลตัวแปรไม่ถูกต้อง")
	}
	for k, value := range variables {
		s, isString := value.(string)
		if !variableName.MatchString(k) || slices.Contains(reservedKeys, k) || !isString || jsLen(s) > 2000 {
			return fail(400, "ข้อมูลตัวแปรไม่ถูกต้อง")
		}
	}
	detail, err := v.get("/agents/" + agentID)
	if err != nil {
		return err
	}
	required := promptVariables(detail)
	previewTest := get(bodyMeta, "preview_test") == true
	outputs := []string{}
	if previewTest {
		list, isList := get(bodyMeta, "output_variables").([]any)
		valid := isList && len(list) <= 50 && !truthy(get(bodyMeta, "campaign_id")) && !truthy(get(bodyMeta, "campaign_batch"))
		for _, key := range list {
			s, isString := key.(string)
			if !isString || !slices.Contains(required, s) || slices.Contains(outputs, s) {
				valid = false
				break
			}
			outputs = append(outputs, s)
		}
		if !valid {
			return fail(400, "กรุณาดึงตัวแปรล่าสุดและตรวจข้อมูลสำหรับโทรทดสอบอีกครั้ง")
		}
	}
	usesCallback := callbackRefRe.MatchString(orEmpty(currentPrompt(detail)) + orEmpty(get(detail, "agent_data", "greeting_text")))
	if usesCallback && !a.callbackConfigured() {
		return fail(503, "Agent นี้ต้องใช้ระบบรับผล ผู้ดูแลต้องตั้งค่าเซิร์ฟเวอร์รับผลก่อนโทร")
	}
	accountID := strOr(v.conn["account_id"])
	recordingConnected := false
	if usesCallback {
		tools, err := v.get("/platform-config/tools")
		if err != nil {
			return err
		}
		recordingConnected = connectedTranscriptTool(detail, tools, receiverURL(a.cfg), accountID) != nil
		if connectedTool(detail, tools, receiverURL(a.cfg), accountID) == nil && !recordingConnected {
			return fail(409, "บอทยังไม่ได้เชื่อมระบบรับผลของบัญชีนี้ กรุณาเชื่อมในขั้นตอนเลือก Agent ก่อนโทร")
		}
	}
	metadata := obj{"variables": variables, "voice_account_id": accountID}
	if previewTest {
		metadata["preview_test"] = true
		metadata["output_variables"] = toAny(outputs)
	}
	if campaignID := get(bodyMeta, "campaign_id"); truthy(campaignID) {
		if err := v.applyCampaign(body, bodyMeta, metadata, &variables, &destination, required, recordingConnected); err != nil {
			return err
		}
	}
	if get(bodyMeta, "campaign_batch") == true && !truthy(metadata["campaign_id"]) {
		return fail(400, "ต้องระบุแคมเปญ")
	}
	if get(bodyMeta, "campaign_batch") != true {
		for _, key := range required {
			if s, ok := variables[key].(string); !slices.Contains(outputs, key) && (!ok || jsTrim(s) == "") {
				return fail(400, "กรุณาเติมตัวแปรใน Prompt ให้ครบก่อนโทร")
			}
		}
	}
	if previewTest {
		for _, key := range outputs {
			delete(variables, key)
		}
	}
	// Reserved correlation comes from this request, never CSV/browser data.
	reference := strings.ToLower(requestID)
	metadata["voice_request_id"] = reference
	delete(variables, "vc_call_reference")
	delete(variables, "vc_record_conversation")
	if usesCallback {
		withReference := objOr(variables)
		withReference["vc_call_reference"] = reference
		withReference["vc_record_conversation"] = "false"
		if metadata["record_conversation"] == true {
			withReference["vc_record_conversation"] = "true"
		}
		metadata["variables"] = withReference
		metadata["result_callback"] = 1
		metadata["callback_auth"] = "account_v2"
	}
	// A durable reservation prevents a retry with the same ID from dialing twice.
	if v.worker != nil && !truthy(metadata["campaign_id"]) {
		return fail(403, "ต้องระบุแคมเปญของคิว")
	}
	rpc, args := "reserve_voice_call", obj{}
	if v.worker != nil {
		rpc = "reserve_scheduled_voice_call"
		args["p_job_id"] = v.worker.job["id"]
		args["p_lease_id"] = v.worker.job["lease_id"]
	}
	args["p_id"], args["p_destination"], args["p_agent_id"], args["p_metadata"] = requestID, destination, agentID, metadata
	if _, err := v.db.RPC(rpc, args); err != nil {
		status := 409
		if pe, ok := err.(*pgError); ok && strings.Contains(pe.Message, "rate_limit") {
			status = 429
		}
		return fail(status, "ยังส่งคำขอโทรไม่ได้: อาจส่งซ้ำ เกินโควตาต่อนาที หรือยังไม่ได้ติดตั้งตารางการโทร")
	}
	// ponytail: Botnoi has not confirmed which form fills prompts. Its console and Tero send flat keys for
	// <<name>>, so send each variable both ways; drop the copy once a live call proves one form.
	sent := objOr(metadata)
	for k, value := range objOr(metadata["variables"]) {
		if _, taken := sent[k]; !taken {
			sent[k] = value
		}
	}
	result, err := v.upstream(path, obj{"destination": destination, "agent_id": agentID, "metadata": sent}, "")
	if err != nil {
		v.db.Update("voice_call_requests", obj{"status": "unknown"}, "", eq("id", requestID))
		return fail(502, "ยังยืนยันผลการส่งคำขอไม่ได้ กรุณาตรวจประวัติก่อนโทรซ้ำ")
	}
	cleaned := clean(result)
	callID, status := get(result, "call_id"), get(result, "status")
	if !truthy(callID) {
		callID = nil
	}
	if !truthy(status) {
		status = "unknown"
	}
	_, persistErr := v.db.Update("voice_call_requests", obj{"call_id": callID, "status": status, "response": cleaned}, "", eq("id", requestID))
	out := objOr(cleaned)
	if persistErr != nil {
		out["persistence_warning"] = "รับผลโทรแล้ว แต่บันทึกผลไม่สำเร็จ กรุณาเก็บ Call ID ไว้"
	}
	return v.send(200, out)
}

// applyCampaign checks a campaign call against the saved campaign and, for batch calls,
// replaces the destination and variables with the owner's saved CSV row.
func (v *voiceRequest) applyCampaign(body, bodyMeta, metadata obj, variables *obj, destination *string, required []string, recordingConnected bool) error {
	userID := v.user["id"]
	accountID := strOr(v.conn["account_id"])
	campaign, err := v.db.MaybeSingle("voice_campaigns", "id,data,updated_at", eq("id", bodyMeta["campaign_id"]), eq("owner_id", userID))
	if err != nil || campaign == nil {
		return fail(403, "ไม่พบแคมเปญของคุณ")
	}
	data := campaign["data"]
	if wk := v.worker; wk != nil {
		job := wk.job
		rows, hasRows := job["contact_rows"].([]any)
		contact := bodyMeta["contact_row"]
		if job == nil || !jsSame(job["owner_id"], userID) || !jsSame(job["campaign_id"], campaign["id"]) || job["account_id"] != accountID ||
			bodyMeta["campaign_batch"] != true ||
			(hasRows && !slices.ContainsFunc(rows, func(r any) bool { return jsSame(r, contact) })) {
			return fail(403, "คิวไม่ตรงกับแคมเปญ")
		}
		metadata["schedule_run_id"] = job["run_id"]
	} else {
		active, err := v.store.Select("voice_campaign_jobs", "id", eq("owner_id", userID), eq("campaign_id", campaign["id"]), in("status", "scheduled", "running"), limit(1))
		// Older installations can keep manual calls until the scheduling migration is installed.
		if pe, ok := err.(*pgError); err != nil && !(ok && (pe.Code == "42P01" || pe.Code == "PGRST205")) {
			return fail(503, "ตรวจคิวตั้งเวลาไม่ได้")
		}
		if len(active) > 0 {
			return fail(409, "มีคิวอัตโนมัติอยู่ กรุณายกเลิกคิวก่อนเริ่มโทรเอง")
		}
	}
	if get(data, "recordConversation") == true {
		if !jsSame(body["agent_id"], get(data, "agentId")) {
			return fail(400, "Agent ไม่ตรงกับแคมเปญ")
		}
		if !recordingConnected {
			return fail(409, "บอทยังไม่ได้เชื่อมบันทึกบทสนทนา กรุณาแก้แคมเปญและเชื่อมในขั้นตอนเลือก Agent")
		}
		metadata["record_conversation"] = true
	}
	metadata["campaign_id"] = campaign["id"]
	if saved := get(data, "voiceAccountId"); truthy(saved) && saved != accountID {
		return fail(409, "แคมเปญนี้ใช้บัญชี Voice Bot อีกบัญชี กรุณาเชื่อมบัญชีเดิมหรือสร้างแคมเปญใหม่")
	}
	foreign, err := v.db.MaybeSingle("voice_call_requests", "id", eq("metadata->>campaign_id", campaign["id"]),
		or("metadata->>voice_account_id.is.null,metadata->>voice_account_id.neq."+accountID), limit(1))
	if err != nil {
		return fail(503, "ยังตรวจบัญชีของคำขอเดิมไม่ได้")
	}
	if foreign != nil {
		return fail(409, "แคมเปญนี้มีคำขอของบัญชี Voice Bot อื่นหรือประวัติที่ยังไม่ผูกบัญชี กรุณาเชื่อมบัญชีเดิมหรือติดต่อผู้ดูแล")
	}
	version := campaign["updated_at"]
	if bodyMeta["campaign_batch"] == true {
		if !jsSame(bodyMeta["campaign_version"], version) {
			return fail(409, "แคมเปญถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนเริ่มคิว")
		}
		if !jsSame(body["agent_id"], get(data, "agentId")) {
			return fail(400, "Agent ไม่ตรงกับแคมเปญ")
		}
		index, ok := jsInt(bodyMeta["contact_row"])
		if !ok {
			return fail(400, "ต้องระบุแถว CSV")
		}
		prepared := prepareCampaignRows(data, required)
		if len(prepared.Errors) > 0 || index < 0 || index >= len(prepared.Rows) || len(prepared.Rows[index].Errors) > 0 {
			return fail(400, "ข้อมูล CSV ของแถวที่เลือกหรือการจับคู่ไม่ครบ กรุณาแก้ไขก่อนเริ่มคิว")
		}
		row := prepared.Rows[index]
		last, err := v.db.MaybeSingle("voice_call_requests", "id,status,call_id,metadata", eq("metadata->>campaign_id", campaign["id"]),
			eq("metadata->>campaign_version", version), eq("metadata->>contact_row", strconv.Itoa(row.Index)),
			order("created_at.desc,id.desc"), limit(1))
		if err != nil {
			return fail(503, "ตรวจประวัติแถวที่เลือกไม่ได้")
		}
		retry, hasRetry := bodyMeta["campaign_redial_of"]
		if hasRetry && (last == nil || !jsSame(retry, last["id"]) || !truthy(last["call_id"]) || !terminalCall(last["status"])) {
			return fail(409, "สายเดิมยังไม่จบหรือประวัติเปลี่ยนแล้ว กรุณาตรวจและยืนยันใหม่")
		}
		// A job without redial may only retry its own attempt of this run.
		if wk := v.worker; wk != nil && hasRetry && !truthy(wk.job["redial"]) &&
			(!jsSame(get(last, "metadata", "schedule_job_id"), wk.job["id"]) || !jsSame(get(last, "metadata", "schedule_run_id"), wk.job["run_id"])) {
			return fail(403, "คิวไม่ตรงกับแคมเปญ")
		}
		if last != nil && !truthy(retry) {
			return fail(409, "แถวนี้มีคำขอแล้ว กรุณาตรวจประวัติ หรือเลือกโทรซ้ำพร้อมยืนยัน")
		}
		retryID := ""
		if truthy(retry) {
			retryID = jsString(retry)
		}
		if body["request_id"] != campaignRequestID(jsString(campaign["id"]), jsString(version), row.Index, retryID) {
			return fail(400, "รหัสคำขอของแถวนี้ไม่ตรง กรุณาโหลดหน้าใหม่")
		}
		if retryID != "" {
			metadata["campaign_redial_of"] = retry
		}
		// Authoritative destination and inputs come from the owner's saved CSV, not browser overrides.
		*destination = row.Destination
		*variables = row.Variables
		metadata["variables"] = row.Variables
		metadata["campaign_batch"] = true
		metadata["campaign_version"] = version
	}
	if contact, ok := bodyMeta["contact_row"]; ok {
		rows, _ := get(data, "csv", "rows").([]any)
		index, isInt := jsInt(contact)
		if !isInt || index < 0 || index >= len(rows) {
			return fail(400, "แถวผู้ติดต่อไม่ถูกต้อง")
		}
		metadata["contact_row"] = contact
	}
	return nil
}

func toAny(list []string) []any {
	out := make([]any, len(list))
	for i, s := range list {
		out[i] = s
	}
	return out
}

// queryParam/queryList keep URLSearchParams order and decoding.
type queryParam struct{ key, value string }
type queryList []queryParam

func parseQuery(raw string) queryList {
	var out queryList
	if raw == "" {
		return out
	}
	decode := func(s string) string {
		s = strings.ReplaceAll(s, "+", " ")
		if d, err := url.PathUnescape(s); err == nil {
			return d
		}
		return s
	}
	for _, part := range strings.Split(raw, "&") {
		if part == "" {
			continue
		}
		k, value, _ := strings.Cut(part, "=")
		out = append(out, queryParam{decode(k), decode(value)})
	}
	return out
}

func (l queryList) lookup(key string) (string, bool) {
	for _, p := range l {
		if p.key == key {
			return p.value, true
		}
	}
	return "", false
}

// set replaces the first value and drops later duplicates, like URLSearchParams#set.
func (l *queryList) set(key, value string) {
	out := (*l)[:0:0]
	done := false
	for _, p := range *l {
		if p.key != key {
			out = append(out, p)
		} else if !done {
			out = append(out, queryParam{key, value})
			done = true
		}
	}
	if !done {
		out = append(out, queryParam{key, value})
	}
	*l = out
}

func (l queryList) encode() string {
	parts := make([]string, len(l))
	for i, p := range l {
		parts[i] = formEncode(p.key) + "=" + formEncode(p.value)
	}
	return strings.Join(parts, "&")
}

// formEncode is the application/x-www-form-urlencoded serializer URLSearchParams uses.
func formEncode(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '*', c == '-', c == '.', c == '_':
			b.WriteByte(c)
		case c == ' ':
			b.WriteByte('+')
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func formQuery(pairs ...string) string {
	var l queryList
	for i := 0; i+1 < len(pairs); i += 2 {
		l = append(l, queryParam{pairs[i], pairs[i+1]})
	}
	return l.encode()
}
