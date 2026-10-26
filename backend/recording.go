package main

// Ports of server/audio-library.mjs, server/recording.mjs and server/recording-callback.mjs.

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxAudioBytes = 64 << 20

var (
	audioFileRe = regexp.MustCompile(`(?i)^(agt_[a-zA-Z0-9_-]+)/(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_(` + uuidPattern + `)_(\d+)\.(txt|wav)$`)
	txtSuffixRe = regexp.MustCompile(`(?i)\.txt$`)
	audioPathRe = regexp.MustCompile(`(?i)\.(wav|mp3|ogg|m4a|flac|webm)$`)
	extensionRe = regexp.MustCompile(`\.[^.]+$`)
)

type dateRange struct{ start, end string }

type audioEntry struct {
	ID       string `json:"id"`
	FileTime string `json:"file_time"`
	Part     int64  `json:"part"`
	Path     string `json:"-"`
}

func validDay(s string) bool {
	t, err := time.Parse("2006-01-02", s)
	return datePattern.MatchString(s) && err == nil && t.Format("2006-01-02") == s
}

func audioDateRange(query queryList) (dateRange, error) {
	start, _ := query.lookup("start_date")
	end, _ := query.lookup("end_date")
	if !validDay(start) || !validDay(end) || end < start {
		return dateRange{}, fail(400, "เลือกช่วงวันที่ไม่เกิน 31 วัน")
	}
	s, _ := jsDateParse(start)
	e, _ := jsDateParse(end)
	if float64(e-s)/86400000 > 30 {
		return dateRange{}, fail(400, "เลือกช่วงวันที่ไม่เกิน 31 วัน")
	}
	return dateRange{start, end}, nil
}

func wavPath(path string) string { return txtSuffixRe.ReplaceAllString(path, ".wav") }

// audioEntries keeps only this agent's recordings inside the range, newest first.
func audioEntries(files any, agentID string, r dateRange) []audioEntry {
	list, ok := files.([]any)
	if !ok {
		return nil
	}
	unique := map[string]audioEntry{}
	for _, f := range list {
		path, ok := f.(string)
		if !ok || jsLen(path) > 400 {
			continue
		}
		m := audioFileRe.FindStringSubmatch(path)
		if m == nil || m[1] != agentID || m[2] < r.start || m[2] > r.end {
			continue
		}
		part, err := strconv.ParseInt(m[5], 10, 64)
		if err != nil || part > 1<<53-1 {
			continue
		}
		audio := wavPath(path)
		id := sha256Hex(audio)
		unique[id] = audioEntry{ID: id, FileTime: m[2] + " " + strings.ReplaceAll(m[3], "-", ":"), Part: part, Path: audio}
	}
	out := make([]audioEntry, 0, len(unique))
	for _, e := range unique {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.FileTime != b.FileTime {
			return a.FileTime > b.FileTime
		}
		if a.Part != b.Part {
			return a.Part < b.Part
		}
		return a.ID < b.ID
	})
	return out
}

func logFileListPath(agentID string, r dateRange) string {
	return "/logs/list_file/?" + formQuery("agent_id", agentID, "start_date", strings.ReplaceAll(r.start, "-", "/"), "end_date", strings.ReplaceAll(r.end, "-", "/"))
}

// streamWav checks the WAV header and streams the file to the browser.
func (v *voiceRequest) streamWav(res *http.Response) error {
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return fail(404, "บันทึกนี้ยังไม่มีไฟล์เสียง")
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fail(502, fmt.Sprintf("บริการเสียงตอบกลับ HTTP %d", res.StatusCode))
	}
	if res.ContentLength > maxAudioBytes {
		return fail(413, "ไฟล์เสียงนี้มีขนาดเกินที่เว็บรองรับ")
	}
	head := make([]byte, 12)
	n, err := io.ReadFull(res.Body, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return err
	}
	head = head[:n]
	if n < 12 || !bytes.Equal(head[:4], []byte("RIFF")) || !bytes.Equal(head[8:12], []byte("WAVE")) {
		return fail(502, "บริการส่งข้อมูลที่ไม่ใช่ไฟล์เสียง WAV")
	}
	h := v.w.Header()
	h.Set("Content-Type", "audio/wav")
	h.Set("Cache-Control", "private, no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Disposition", `inline; filename="voice-recording.wav"`)
	v.w.WriteHeader(200)
	v.sent = true
	v.w.Write(head)
	copied, err := io.Copy(v.w, io.LimitReader(res.Body, maxAudioBytes-12+1))
	if err != nil || copied > maxAudioBytes-12 {
		// Headers are already sent: abort the connection so the client sees a broken download.
		panic(http.ErrAbortHandler)
	}
	return nil
}

func (v *voiceRequest) handleAudioLibrary(agentID, fileID string, query queryList) error {
	r, err := audioDateRange(query)
	if err != nil {
		return err
	}
	if _, err := v.me("บัญชี Voice Bot ไม่ตรงกับบัญชีที่เชื่อม"); err != nil {
		return err
	}
	if err := v.ownsAgent(agentID, "ไม่มีสิทธิ์ฟังบันทึกของ Agent นี้"); err != nil {
		return err
	}
	listing, err := v.logsFetch(logFileListPath(agentID, r))
	if err != nil {
		return err
	}
	files, err := listingJSON(listing)
	if err != nil {
		return err
	}
	entries := audioEntries(files, agentID, r)
	if fileID == "" {
		items := entries[:min(100, len(entries))]
		return v.send(200, obj{"items": items, "has_more": len(entries) > 100, "total": len(entries), "start_date": r.start, "end_date": r.end})
	}
	i := slices.IndexFunc(entries, func(e audioEntry) bool { return e.ID == fileID })
	if i < 0 {
		return fail(404, "ไม่พบบันทึกเสียงใน Agent และช่วงวันที่นี้")
	}
	audio, err := v.logsFetch("/logs/audio?" + formQuery("file_path", entries[i].Path))
	if err != nil {
		return err
	}
	return v.streamWav(audio)
}

func listingJSON(res *http.Response) (any, error) {
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return nil, fail(502, fmt.Sprintf("บริการรายการเสียงตอบกลับ HTTP %d", res.StatusCode))
	}
	return readJSON(res)
}

// recordingPath picks the audio file linked to a call; ambiguous matches return "".
func recordingPath(files []string, call any) string {
	var paths []string
	for _, p := range files {
		if audioPathRe.MatchString(p) {
			paths = append(paths, p)
		}
	}
	explicit := get(call, "recording_file_path")
	if !truthy(explicit) {
		explicit = get(call, "audio_file_path")
	}
	if s, ok := explicit.(string); ok && slices.Contains(paths, s) {
		return s
	}
	callID := jsString(get(call, "call_id"))
	var exact []string
	for _, p := range paths {
		if pathHasPart(p, callID) {
			exact = append(exact, p)
		}
	}
	if len(exact) == 1 {
		return exact[0]
	}
	logPath := matchingLogPath(toAny(files), call)
	if logPath == "" {
		return ""
	}
	stem := extensionRe.ReplaceAllString(logPath, "")
	var paired []string
	for _, p := range paths {
		if extensionRe.ReplaceAllString(p, "") == stem {
			paired = append(paired, p)
		}
	}
	switch {
	case len(paired) == 1:
		return paired[0]
	case len(paired) == 0 && txtSuffixRe.MatchString(logPath):
		return wavPath(logPath)
	}
	return ""
}

func (v *voiceRequest) handleRecording(id string, binary bool, campaignID string, hasCampaign bool) error {
	record, err := v.db.MaybeSingle("voice_call_requests", "id,call_id,agent_id,metadata,response,created_at", eq("id", id), eq("owner_id", v.user["id"]))
	if err != nil || record == nil {
		return fail(404, "ไม่พบคำขอโทรในบัญชีนี้")
	}
	if hasCampaign && (!uuidRe.MatchString(campaignID) || get(record, "metadata", "campaign_id") != campaignID) {
		return fail(404, "ไม่พบสายนี้ในแคมเปญที่เลือก")
	}
	accountID := strOr(v.conn["account_id"])
	if get(record, "metadata", "voice_account_id") != accountID {
		return fail(403, "ต้องเชื่อมบัญชี Voice Bot เดิมเพื่อฟังเสียงสายนี้")
	}
	if !truthy(record["call_id"]) {
		return v.send(200, obj{"state": "not_available", "message": "ยังไม่มี Call ID จึงตรวจไฟล์เสียงไม่ได้"})
	}
	if _, err := v.me("บัญชี Voice Bot ไม่ตรงกับสายนี้"); err != nil {
		return err
	}
	if err := v.ownsAgent(record["agent_id"], "Agent ของสายนี้ไม่อยู่ในบัญชีที่เชื่อม"); err != nil {
		return err
	}
	callID := jsString(record["call_id"])
	call, err := v.get(tenantCallPath(accountID, callID))
	if err != nil {
		return err
	}
	if !jsSame(get(call, "call_id"), record["call_id"]) {
		return fail(502, "Call ID จากบริการไม่ตรงกับคำขอ")
	}
	if !terminalCall(get(call, "status")) {
		return v.send(200, obj{"state": "pending", "message": "สายยังไม่จบ กดตรวจเสียงอีกครั้งหลังจบสาย"})
	}
	created := get(call, "created_at")
	if !truthy(created) {
		created = record["created_at"]
	}
	date, ok := jsDateParse(created)
	if !ok {
		return fail(502, "บริการไม่ระบุวันที่ของสายนี้")
	}
	agentID := jsString(record["agent_id"])
	r := dateRange{jsISO(date - 86400000)[:10], jsISO(date + 86400000)[:10]}
	listing, err := v.logsFetch(logFileListPath(agentID, r))
	if err != nil {
		return err
	}
	files, err := listingJSON(listing)
	if err != nil {
		return err
	}
	entries := audioEntries(files, agentID, r)
	var owned []string
	for _, e := range entries {
		owned = append(owned, e.Path)
	}
	all := slices.Clone(owned)
	if names, ok := stringItems(files); ok {
		for _, p := range names {
			if slices.Contains(owned, wavPath(p)) {
				all = append(all, p)
			}
		}
	}
	link := get(record, "response", "audio_link")
	providerLink := get(link, "source") == "provider_callback" && jsSame(get(link, "request_id"), record["id"]) &&
		jsSame(get(link, "call_id"), record["call_id"]) && jsSame(get(link, "campaign_id"), get(record, "metadata", "campaign_id"))
	var linked *audioEntry
	if (providerLink || get(link, "source") == "manual") && get(link, "account_id") == accountID && jsSame(get(link, "agent_id"), record["agent_id"]) {
		if i := slices.IndexFunc(entries, func(e audioEntry) bool { return get(link, "recording_id") == e.ID }); i >= 0 {
			linked = &entries[i]
		}
	}
	path := recordingPath(all, call)
	if linked != nil {
		path = linked.Path
	}
	if path == "" {
		// The call history API exposes the recording session that the provisioning
		// response omits. Accept only the provider's exact link for this same call.
		detail, err := v.get("/calls/" + escapeComponent(callID))
		if err != nil {
			return err
		}
		if !jsSame(get(detail, "id"), record["call_id"]) {
			return fail(502, "Call ID ของประวัติจากบริการไม่ตรงกับคำขอ")
		}
		conversation := get(detail, "conversation")
		if key, ok := get(conversation, "key").(string); ok && get(conversation, "linked_by") == "exact" && jsSame(get(conversation, "agent_id"), record["agent_id"]) {
			if slices.Contains(owned, wavPath(key)) {
				path = wavPath(key)
			}
		}
	}
	if path == "" {
		if binary {
			return fail(404, "ยังไม่ได้เชื่อมไฟล์เสียงกับสายนี้")
		}
		return v.send(200, obj{"state": "not_available", "message": "ยังไม่มีไฟล์เสียงที่ยืนยันว่าเชื่อมกับสายนี้ในแคมเปญ บริการยังไม่ส่งรหัสเชื่อมไฟล์กับ Call ID"})
	}
	if binary {
		audio, err := v.logsFetch("/logs/audio?" + formQuery("file_path", path))
		if err != nil {
			return err
		}
		return v.streamWav(audio)
	}
	playback := "/workspace/calls/" + id + "/recording-audio"
	if campaignID != "" {
		playback += "?" + formQuery("campaign_id", campaignID)
	}
	source := any("provider")
	if linked != nil {
		source = get(link, "source")
	}
	return v.send(200, obj{"state": "available", "playback_path": playback, "source": source, "linked_at": get(link, "updated_at")})
}

// escapeComponent is encodeURIComponent.
func escapeComponent(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.IndexByte("-_.!~*'()", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func tenantCallPath(accountID, callID string) string {
	return "/v1/provisioning/tenants/" + escapeComponent(accountID) + "/calls/" + escapeComponent(callID)
}

var recordingFields = []string{"request_id", "call_id", "agent_id", "file_path"}

func validRecordingBody(body obj) bool {
	if len(body) != len(recordingFields) || !onlyKeys(body, recordingFields...) {
		return false
	}
	id, ok1 := body["request_id"].(string)
	call, ok2 := body["call_id"].(string)
	agent, ok3 := body["agent_id"].(string)
	path, ok4 := body["file_path"].(string)
	return ok1 && uuidRe.MatchString(id) && ok2 && providerID.MatchString(call) && ok3 && agentRecordingRe.MatchString(agent) && ok4 && jsLen(path) <= 400
}

var agentRecordingRe = regexp.MustCompile(`^agt_[a-zA-Z0-9_-]{1,100}$`)

// handleRecordingCallback joins one provider recording file to the app request and call.
// It cannot create calls, choose another owner/campaign or supply a download URL.
func (a *App) handleRecordingCallback(w http.ResponseWriter, r *http.Request) {
	setJSONHeaders(w)
	if r.Method != "POST" {
		w.Header().Set("Allow", "POST")
		send(w, 405, obj{"error": "POST required"})
		return
	}
	if a.cfg.SupabaseURL == "" || a.cfg.ServiceRoleKey == "" || jsLen(a.cfg.CallbackSecret) < 32 {
		send(w, 503, obj{"error": "Recording receiver is not configured"})
		return
	}
	authorization := r.Header.Get("Authorization")
	supplied, ok := strings.CutPrefix(authorization, "Bearer ")
	if !ok || !accountSecretRe.MatchString(supplied) {
		send(w, 401, obj{"error": "Invalid recording callback credentials"})
		return
	}
	if !jsonContentType.MatchString(r.Header.Get("Content-Type")) {
		send(w, 415, obj{"error": "JSON required"})
		return
	}
	raw, over, err := readLimited(r, 4096)
	if err != nil || over {
		send(w, 413, obj{"error": "Payload too large"})
		return
	}
	parsed, err := decodeJSON(raw)
	if err != nil {
		send(w, 400, obj{"error": "Invalid JSON"})
		return
	}
	body, _ := parsed.(obj)
	if body == nil || !validRecordingBody(body) {
		send(w, 400, obj{"error": "Send request_id, call_id, agent_id and file_path only"})
		return
	}
	store := a.serviceDB(r.Context())
	record, err := store.MaybeSingle("voice_call_requests", "id,owner_id,agent_id,call_id,metadata,response,created_at", eq("id", body["request_id"]))
	if err != nil {
		send(w, 503, obj{"error": "Storage unavailable; retry later"})
		return
	}
	accountID, _ := get(record, "metadata", "voice_account_id").(string)
	expected, secretErr := accountRecordingSecret(accountID, a.cfg.CallbackSecret)
	if accountID == "" || secretErr != nil || !sameSecret(supplied, expected) {
		send(w, 401, obj{"error": "Invalid recording callback credentials"})
		return
	}
	connection, err := store.MaybeSingle("voice_bot_connections", "account_id", eq("owner_id", record["owner_id"]))
	if err != nil {
		send(w, 503, obj{"error": "Connection storage unavailable; retry later"})
		return
	}
	if get(connection, "account_id") != accountID {
		send(w, 401, obj{"error": "Original Voice Bot account is no longer connected"})
		return
	}
	campaignID, ok := get(record, "metadata", "campaign_id").(string)
	if !jsSame(record["agent_id"], body["agent_id"]) || !ok || !uuidRe.MatchString(campaignID) {
		send(w, 404, obj{"error": "Unknown campaign call reference"})
		return
	}
	if !truthy(record["call_id"]) {
		send(w, 409, obj{"error": "Call not yet persisted; retry later"})
		return
	}
	if !jsSame(record["call_id"], body["call_id"]) {
		send(w, 409, obj{"error": "Call ID does not match the request"})
		return
	}
	date, ok := jsDateParse(record["created_at"])
	if !ok {
		send(w, 503, obj{"error": "Stored call date is unavailable"})
		return
	}
	window := dateRange{jsISO(date - 86400000)[:10], jsISO(date + 86400000)[:10]}
	entries := audioEntries([]any{body["file_path"]}, jsString(record["agent_id"]), window)
	if len(entries) == 0 {
		send(w, 400, obj{"error": "File must belong to this Agent and call date range"})
		return
	}
	entry := entries[0]
	timestamp := strings.Replace(entry.FileTime, " ", "T", 1) + "Z"
	fileDate, ok := jsDateParse(timestamp)
	if !ok || jsISO(fileDate)[:19] != timestamp[:19] {
		send(w, 400, obj{"error": "Invalid file timestamp"})
		return
	}
	original := record["response"]
	fingerprint := sha256Hex(jsStringify([]any{record["id"], record["call_id"], record["agent_id"], entry.ID}))
	if previous := get(original, "audio_link"); truthy(previous) {
		if get(previous, "recording_id") == entry.ID {
			send(w, 200, obj{"received": true, "duplicate": true})
		} else {
			send(w, 409, obj{"error": "A different recording is already linked; existing history was preserved"})
		}
		return
	}
	response := objOr(original)
	response["audio_link"] = obj{"recording_id": entry.ID, "request_id": record["id"], "call_id": record["call_id"], "campaign_id": campaignID,
		"agent_id": record["agent_id"], "account_id": accountID, "source": "provider_callback", "fingerprint": fingerprint, "updated_at": nowISO()}
	filters := []q{eq("id", record["id"]), eq("owner_id", record["owner_id"]), eq("agent_id", record["agent_id"]), eq("call_id", record["call_id"]),
		eq("metadata->>voice_account_id", accountID), eq("metadata->>campaign_id", campaignID), isNull("response->audio_link->>updated_at")}
	saved, err := store.Update("voice_call_requests", obj{"response": response}, "id", guardedUpdate(filters, original, "audio_link")...)
	if err != nil {
		send(w, 503, obj{"error": "Recording reference was not saved; retry later"})
		return
	}
	if len(saved) == 0 {
		send(w, 409, obj{"error": "Concurrent update; retry the same payload"})
		return
	}
	send(w, 200, obj{"received": true})
}
