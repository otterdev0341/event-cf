package main

// Port of server/scheduler.mjs: campaign alarms and the worker that pg_cron calls every minute.

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"time"
)

func schedulerSecret(callbackSecret string) (string, error) {
	if jsLen(callbackSecret) < 32 {
		return "", errors.New("Scheduler is not configured")
	}
	mac := hmac.New(sha256.New, []byte(callbackSecret))
	mac.Write([]byte("voice-campaign-scheduler-v1"))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func publicJob(job obj) any {
	if job == nil {
		return nil
	}
	out := obj{}
	for _, k := range []string{"id", "campaign_id", "campaign_version", "run_at", "status", "last_error", "updated_at", "recurrence", "weekdays", "local_time", "redial", "contact_rows", "completed_runs", "last_completed_at"} {
		if has(job, k) {
			out[k] = job[k]
		}
	}
	return out
}

// invoke runs one /api/voice route as the job owner. This context is built only by server code.
func (a *App) invoke(ctx context.Context, store *db, user, job obj, path string, body any) (any, error) {
	if body != nil {
		// Hand the body over as decoded JSON, the form an HTTP request would have (numbers as float64).
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		body, _ = decodeJSON(data)
	}
	rec := httptest.NewRecorder()
	a.handleVoice(rec, nil, path, &worker{db: store, user: user, job: job}, ctx, body)
	result, _ := decodeJSON(rec.Body.Bytes())
	if rec.Code != 200 || truthy(get(result, "persistence_warning")) {
		return nil, errors.New(jsString(firstTruthy(get(result, "error"), get(result, "persistence_warning"), "ตรวจบริการโทรไม่สำเร็จ")))
	}
	return result, nil
}

func sameInstant(a, b any) bool {
	ta, okA := jsDateParse(a)
	tb, okB := jsDateParse(b)
	return okA && okB && ta == tb
}

// uniqueInts checks that every item is an integer in [0, below) and appears once.
func uniqueInts(list []any, below int) bool {
	seen := map[int]bool{}
	for _, item := range list {
		n, ok := jsInt(item)
		if !ok || n < 0 || n >= below || seen[n] {
			return false
		}
		seen[n] = true
	}
	return true
}

func includesNumber(list any, n int) bool {
	items, _ := list.([]any)
	for _, item := range items {
		if m, ok := jsInt(item); ok && m == n {
			return true
		}
	}
	return false
}

func (v *voiceRequest) handleSchedule(body any, campaignID string) error {
	store, userID := v.store, v.user["id"]
	campaign, err := store.MaybeSingle("voice_campaigns", "*", eq("id", campaignID), eq("owner_id", userID))
	if err != nil || campaign == nil {
		return fail(404, "ไม่พบแคมเปญของคุณ")
	}
	jobs, err := store.Select("voice_campaign_jobs", "*", eq("campaign_id", campaignID), eq("owner_id", userID), order("created_at.desc"), limit(1))
	if err != nil {
		return fail(503, "ระบบตั้งเวลาโทรยังไม่พร้อม กรุณาติดต่อผู้ดูแล")
	}
	var job obj
	if len(jobs) > 0 {
		job = jobs[0]
	}
	health, _ := store.MaybeSingle("voice_scheduler_health", "last_tick", eq("id", true))
	tick, ok := jsDateParse(get(health, "last_tick"))
	ready := ok && nowMS()-tick < 180000
	if v.method == "GET" {
		return v.send(200, obj{"job": publicJob(job), "ready": ready})
	}
	b, _ := body.(obj)
	if get(b, "action") == "cancel" {
		if job == nil || !jsSame(b["job_id"], job["id"]) {
			return fail(409, "คิวเปลี่ยนแล้ว กรุณารีเฟรช")
		}
		if _, err := store.Update("voice_campaign_jobs", obj{"status": "cancelled", "updated_at": nowISO()}, "",
			eq("id", job["id"]), eq("owner_id", userID), in("status", "scheduled", "running", "failed")); err != nil {
			return fail(503, "ยกเลิกคิวไม่ได้ กรุณาลองใหม่")
		}
		cancelled := objOr(job)
		cancelled["status"] = "cancelled"
		return v.send(200, obj{"job": publicJob(cancelled), "ready": ready})
	}
	if get(b, "action") != "configure" || b["consent"] != true || !jsSame(b["campaign_version"], campaign["updated_at"]) || campaign["state"] != "saved" {
		return fail(409, "กรุณาตรวจและยืนยันแคมเปญล่าสุดก่อนตั้งเวลา")
	}
	requestID, _ := b["request_id"].(string)
	if !uuidRe.MatchString(requestID) {
		return fail(400, "ไม่มีรหัสการตั้งเวลา")
	}
	// The browser keeps this ID through retries; each new confirmation has its own ID.
	existing, err := store.MaybeSingle("voice_campaign_jobs", "*", eq("owner_id", userID), eq("id", requestID))
	if err != nil {
		return fail(503, "ตรวจการตั้งเวลาเดิมไม่ได้")
	}
	if existing != nil {
		if existing["campaign_id"] != campaignID || !sameInstant(existing["campaign_version"], campaign["updated_at"]) {
			return fail(409, "รหัสการตั้งเวลานี้ถูกใช้แล้ว")
		}
		return v.send(200, obj{"job": publicJob(existing), "ready": ready})
	}
	if job != nil && (job["status"] == "scheduled" || job["status"] == "running") {
		return fail(409, "แคมเปญนี้มีคิวอยู่แล้ว กรุณายกเลิกคิวเดิมก่อน")
	}
	if !ready {
		return fail(503, "ตัวตั้งเวลาโทรยังไม่พร้อม ยังไม่ได้เริ่มคิว กรุณาลองใหม่ภายหลัง")
	}
	conn := v.conn
	if conn == nil || expired(conn["expires_at"]) {
		return fail(428, "กรุณาเชื่อมบัญชี Voice Bot ใหม่ก่อนตั้งเวลา")
	}
	rule := b["schedule"]
	recurrence := get(rule, "recurrence")
	_, redialOK := get(rule, "redial").(bool)
	weekdays, weekdaysOK := get(rule, "weekdays").([]any)
	if !truthy(rule) || (recurrence != "once" && recurrence != "daily" && recurrence != "weekly") || !redialOK || !weekdaysOK || len(weekdays) > 7 || !uniqueInts(weekdays, 7) {
		return fail(400, "รูปแบบการตั้งเวลาไม่ถูกต้อง")
	}
	runAt := firstScheduleTime(rule, nowMS())
	if runAt == "" {
		return fail(400, "กรุณาเลือกวันเวลาในอนาคต และวันที่ต้องการโทรซ้ำให้ครบ (เวลาไทย)")
	}
	selected := b["contact_rows"]
	if selected != nil {
		list, ok := selected.([]any)
		if !ok || len(list) == 0 || len(list) > 5000 || !uniqueInts(list, max(0, arrayLen(get(campaign, "data", "csv", "rows")))) {
			return fail(400, "กรุณาเลือกรายชื่อให้ถูกต้อง")
		}
	}
	if expiry, ok := jsDateParse(conn["expires_at"]); truthy(conn["expires_at"]) && ok {
		if start, _ := jsDateParse(runAt); expiry <= start {
			return fail(428, "Session Voice Bot จะหมดอายุก่อนเวลาโทร กรุณาเชื่อมใหม่")
		}
	}
	data := campaign["data"]
	agent, err := v.app.invoke(v.ctx, store, v.user, nil, "/agents/"+jsString(get(data, "agentId")), nil)
	if err != nil {
		return err
	}
	rows := prepareCampaignRows(data, promptVariables(agent))
	targets, invalid := 0, len(rows.Errors) > 0
	for _, r := range rows.Rows {
		if selected == nil || includesNumber(selected, r.Index) {
			targets++
			invalid = invalid || len(r.Errors) > 0
		}
	}
	if invalid || targets == 0 {
		return fail(400, "ข้อมูลรายชื่อหรือการจับคู่ Agent ยังไม่ครบ")
	}
	accountID := jsString(conn["account_id"])
	if voiceAccount := get(data, "voiceAccountId"); truthy(voiceAccount) && voiceAccount != conn["account_id"] {
		return fail(409, "บัญชี Voice Bot ไม่ตรงกับแคมเปญ")
	}
	version := jsString(campaign["updated_at"])
	foreign, err := store.Select("voice_call_requests", "id", eq("owner_id", userID), eq("metadata->>campaign_id", campaignID),
		or("metadata->>voice_account_id.is.null,metadata->>voice_account_id.neq."+accountID+",metadata->>campaign_version.is.null,metadata->>campaign_version.neq."+version), limit(1))
	if err != nil {
		return fail(503, "อ่านประวัติการโทรไม่ได้")
	}
	if len(foreign) > 0 {
		return fail(409, "ประวัติใช้บัญชีหรือแคมเปญเวอร์ชันอื่น กรุณาตรวจประวัติก่อนตั้งเวลา")
	}
	days := any([]any{})
	if recurrence == "weekly" {
		days = weekdays
	}
	saved, err := store.Insert("voice_campaign_jobs", obj{"id": requestID, "owner_id": userID, "campaign_id": campaignID, "campaign_version": campaign["updated_at"],
		"account_id": conn["account_id"], "run_at": runAt, "next_run_at": runAt, "recurrence": recurrence, "weekdays": days, "local_time": get(rule, "time"),
		"redial": get(rule, "redial"), "contact_rows": selected, "run_id": randomUUID()}, "*")
	if err != nil || len(saved) != 1 {
		return fail(409, "บันทึกคิวไม่ได้หรือมีคิวแล้ว กรุณารีเฟรชสถานะ")
	}
	return v.send(200, obj{"job": publicJob(saved[0]), "ready": ready})
}

// processCampaignJob submits at most one call for a claimed job, or advances or stops it.
func (a *App) processCampaignJob(ctx context.Context, store *db, job obj) error {
	finish := func(status string, lastError any, extra obj) error {
		values := obj{"status": status, "last_error": lastError, "lease_id": nil, "lease_until": nil, "updated_at": nowISO()}
		for k, v := range extra {
			values[k] = v
		}
		if _, err := store.Update("voice_campaign_jobs", values, "", eq("id", job["id"]), eq("lease_id", job["lease_id"]), eq("status", "running")); err != nil {
			return errors.New("Could not save worker progress")
		}
		return nil
	}
	err := func() error {
		user, err := store.AdminUser(jsString(job["owner_id"]))
		if err != nil {
			return errors.New("ไม่พบบัญชีเจ้าของแคมเปญ")
		}
		campaign, err := store.MaybeSingle("voice_campaigns", "*", eq("id", job["campaign_id"]), eq("owner_id", job["owner_id"]))
		if err != nil || campaign == nil || campaign["state"] != "saved" || !sameInstant(campaign["updated_at"], job["campaign_version"]) {
			return errors.New("แคมเปญถูกแก้ไขหลังยืนยัน คิวหยุดแล้ว")
		}
		deadline, cancel := context.WithTimeout(ctx, 45*time.Second)
		defer cancel()
		call := func(path string, body any) (any, error) { return a.invoke(deadline, store, user, job, path, body) }
		account, err := call("/me", nil)
		if err != nil {
			return err
		}
		if !jsSame(get(account, "_id"), job["account_id"]) {
			return errors.New("บัญชี Voice Bot เปลี่ยนแล้ว คิวหยุดแล้ว")
		}
		var attempts []obj
		for start := 0; ; start += 500 {
			page, err := store.Select("voice_call_requests", "id,call_id,status,created_at,metadata", eq("owner_id", job["owner_id"]),
				eq("metadata->>campaign_id", job["campaign_id"]), order("created_at.asc,id.asc"), offset(start), limit(500))
			if err != nil {
				return errors.New("อ่านประวัติการโทรไม่ได้")
			}
			attempts = append(attempts, page...)
			if len(page) < 500 {
				break
			}
		}
		var pending []obj
		for _, attempt := range attempts {
			if !jsSame(get(attempt, "metadata", "voice_account_id"), job["account_id"]) || !jsSame(get(attempt, "metadata", "campaign_version"), campaign["updated_at"]) {
				return errors.New("บัญชีหรือเวอร์ชันของประวัติไม่ตรงกับคิว")
			}
			if !terminalCall(attempt["status"]) {
				pending = append(pending, attempt)
			}
		}
		if len(pending) > 1 {
			return errors.New("พบหลายสายยังไม่จบ กรุณาตรวจประวัติ")
		}
		accountID := jsString(job["account_id"])
		for _, attempt := range pending {
			if !truthy(attempt["call_id"]) {
				return errors.New("ยังยืนยันคำขอเดิมไม่ได้ คิวหยุดเพื่อป้องกันโทรซ้ำ")
			}
			result, err := call("/v1/provisioning/tenants/"+accountID+"/calls/"+jsString(attempt["call_id"]), nil)
			if err != nil {
				return err
			}
			if !terminalCall(get(result, "status")) {
				return finish("running", nil, nil)
			}
			attempt["status"] = get(result, "status")
		}
		data := campaign["data"]
		agentID := get(data, "agentId")
		agent, err := call("/agents/"+jsString(agentID), nil)
		if err != nil {
			return err
		}
		prepared := prepareCampaignRows(data, promptVariables(agent))
		var targets []preparedRow
		for _, r := range prepared.Rows {
			if job["contact_rows"] == nil || includesNumber(job["contact_rows"], r.Index) {
				if len(r.Errors) > 0 {
					return errors.New("ข้อมูล Agent หรือรายชื่อเปลี่ยนแล้ว กรุณาตรวจแคมเปญ")
				}
				targets = append(targets, r)
			}
		}
		if len(prepared.Errors) > 0 || len(targets) == 0 {
			return errors.New("ข้อมูล Agent หรือรายชื่อเปลี่ยนแล้ว กรุณาตรวจแคมเปญ")
		}
		dialedThisRun := map[int]bool{}
		for _, attempt := range attempts {
			if row, ok := contactRow(attempt); ok && jsSame(get(attempt, "metadata", "schedule_job_id"), job["id"]) && jsSame(get(attempt, "metadata", "schedule_run_id"), job["run_id"]) {
				dialedThisRun[row] = true
			}
		}
		var row *preparedRow
		for i, r := range targets {
			if !dialedThisRun[r.Index] && (truthy(job["redial"]) || latestAttempt(attempts, r.Index) == nil) {
				row = &targets[i]
				break
			}
		}
		if row == nil {
			completedRuns, _ := job["completed_runs"].(float64)
			completed := obj{"completed_runs": completedRuns + 1, "last_completed_at": nowISO()}
			if recurrence := jsString(job["recurrence"]); truthy(job["recurrence"]) && recurrence != "once" {
				next := ""
				if runAt, ok := jsDateParse(job["run_at"]); ok {
					next = nextScheduleTime(max(nowMS(), runAt), recurrence, strOr(job["local_time"]), job["weekdays"])
				}
				if next == "" {
					return errors.New("คำนวณรอบถัดไปไม่ได้ กรุณาตั้งเวลาใหม่")
				}
				completed["run_at"], completed["next_run_at"], completed["run_id"] = next, next, randomUUID()
				return finish("scheduled", nil, completed)
			}
			return finish("completed", nil, completed)
		}
		previous := latestAttempt(attempts, row.Index)
		redialOf := ""
		if previous != nil {
			redialOf = jsString(previous["id"])
			if !truthy(previous["call_id"]) || !terminalCall(previous["status"]) {
				return errors.New("ยังยืนยันสายก่อนหน้าไม่ได้ คิวหยุดเพื่อป้องกันโทรซ้ำ")
			}
		}
		overview, err := call("/v1/provisioning/tenants/"+accountID+"/overview?include=tenant,trunk_status", nil)
		if err != nil {
			return err
		}
		config, trunk := get(overview, "sections", "tenant"), get(overview, "sections", "trunk_status")
		if !truthy(get(config, "ok")) || !truthy(get(trunk, "ok")) || !truthy(get(config, "data", "outbound", "enabled")) || truthy(get(trunk, "data", "disabled_at")) ||
			!truthy(get(config, "data", "readiness", "pbx", "ready")) || (get(trunk, "data", "mode") != "ip" && get(trunk, "data", "registration", "state") != "registered") {
			return errors.New("คู่สายไม่พร้อม กรุณาตรวจการเชื่อมต่อ")
		}
		version := jsString(campaign["updated_at"])
		metadata := obj{"variables": obj{}, "campaign_id": campaign["id"], "campaign_version": campaign["updated_at"], "campaign_batch": true, "contact_row": row.Index}
		if redialOf != "" {
			metadata["campaign_redial_of"] = redialOf
		}
		result, err := call("/v1/provisioning/tenants/"+accountID+"/calls", obj{"consent": true, "destination": row.Destination, "agent_id": agentID,
			"request_id": campaignRequestID(jsString(campaign["id"]), version, row.Index, redialOf), "metadata": metadata})
		if err != nil {
			return err
		}
		if !truthy(get(result, "call_id")) {
			return errors.New("ไม่ได้รับ Call ID คิวหยุดเพื่อป้องกันโทรซ้ำ")
		}
		return finish("running", nil, nil)
	}()
	if err != nil {
		message := jsSlice(err.Error(), 500)
		if message == "" {
			message = "คิวหยุด กรุณาตรวจการเชื่อมต่อ"
		}
		return finish("failed", message, nil)
	}
	return nil
}

// handleScheduler is POST /api/voice-scheduler, called by pg_cron with the derived scheduler token.
func (a *App) handleScheduler(w http.ResponseWriter, r *http.Request) {
	setJSONHeaders(w)
	unavailable := func() { send(w, 503, obj{"error": "Scheduler unavailable"}) }
	secret, err := schedulerSecret(a.cfg.CallbackSecret)
	if err != nil {
		unavailable()
		return
	}
	expected, supplied := []byte("Bearer "+secret), []byte(r.Header.Get("Authorization"))
	if r.Method != "POST" || len(supplied) != len(expected) || subtle.ConstantTimeCompare(supplied, expected) != 1 {
		send(w, 401, obj{"error": "Unauthorized"})
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 55*time.Second)
	defer cancel()
	store, err := a.connectionStore(ctx)
	if err != nil || store.Upsert("voice_scheduler_health", obj{"id": true, "last_tick": nowISO()}) != nil {
		unavailable()
		return
	}
	claimed, err := store.RPC("claim_voice_campaign_job", nil)
	if err != nil {
		unavailable()
		return
	}
	jobs, _ := claimed.([]any)
	if len(jobs) > 0 {
		if err := a.processCampaignJob(ctx, store, objOr(jobs[0])); err != nil {
			unavailable()
			return
		}
	}
	send(w, 200, obj{"ok": true, "processed": len(jobs)})
}
