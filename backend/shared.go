package main

// Server-side ports of shared/*.mjs. The browser keeps the JavaScript versions;
// campaignRequestID in particular must give the same ID on both sides.

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

// jsString is String(v) for the values used in prompt and CSV text.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return jsStringify(x)
	case []any:
		parts := make([]string, len(x))
		for i, item := range x {
			if item != nil {
				parts[i] = jsString(item)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// orEmpty is `value || ”` followed by string conversion.
func orEmpty(v any) string {
	if !truthy(v) {
		return ""
	}
	return jsString(v)
}

// ---- call-results.mjs

// outcomeOrder is Object.keys(outcomeLabels) in the Node source order.
var outcomeOrder = []string{"CONFIRMED", "DECLINED", "CALLBACK_REQUESTED", "REQUEST_AGENT", "WRONG_PERSON", "NO_ANSWER", "UNDETERMINED"}

var outcomeLabels = map[string]string{
	"CONFIRMED": "ตอบตกลง", "DECLINED": "ปฏิเสธ", "CALLBACK_REQUESTED": "ขอให้โทรกลับ",
	"REQUEST_AGENT": "ขอคุยเจ้าหน้าที่", "WRONG_PERSON": "ผิดคน", "NO_ANSWER": "ไม่รับสาย", "UNDETERMINED": "รอตรวจสอบ",
}

func isOutcome(v any) bool {
	s, ok := v.(string)
	_, known := outcomeLabels[s]
	return ok && known
}

// providerOutcome accepts only explicit provider output fields.
func providerOutcome(call, log any) obj {
	for _, source := range []any{get(log, "outputs"), get(log, "result"), log, get(call, "outputs"), get(call, "result"), call} {
		if !isObject(source) {
			continue
		}
		result := ""
		if s, ok := get(source, "call_result").(string); ok {
			result = strings.ToUpper(jsTrim(s))
		}
		needs, isBool := get(source, "needs_agent").(bool)
		if isOutcome(result) || isBool {
			if !isOutcome(result) {
				result = "UNDETERMINED"
			}
			var needsValue any
			if isBool {
				needsValue = needs
			}
			return obj{"call_result": result, "needs_agent": needsValue, "source": "provider"}
		}
	}
	return obj{"call_result": "UNDETERMINED", "needs_agent": nil, "source": "unavailable"}
}

func transcriptText(log any) string {
	value := get(log, "text")
	if value == nil {
		value = get(log, "transcript")
	}
	if value == nil {
		value = get(log, "messages")
	}
	switch x := value.(type) {
	case string:
		return jsSlice(x, 100000)
	case []any:
		lines := make([]string, len(x))
		for i, m := range x {
			if s, ok := m.(string); ok {
				lines[i] = s
				continue
			}
			text := get(m, "text")
			if !truthy(text) {
				text = get(m, "content")
			}
			lines[i] = orEmpty(get(m, "role")) + ": " + orEmpty(text)
		}
		return jsSlice(strings.Join(lines, "\n"), 100000)
	}
	return ""
}

var pathSeparators = regexp.MustCompile(`[/.]`)
var safeID = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func stringItems(files any) ([]string, bool) {
	list, ok := files.([]any)
	if !ok {
		return nil, false
	}
	var out []string
	for _, f := range list {
		if s, ok := f.(string); ok {
			out = append(out, s)
		}
	}
	return out, true
}

func pathHasPart(path, part string) bool {
	return slices.Contains(pathSeparators.Split(path, -1), part)
}

func matchingLogPath(files any, call any) string {
	paths, ok := stringItems(files)
	if !ok {
		return ""
	}
	explicit := get(call, "transcript_file_path")
	if !truthy(explicit) {
		explicit = get(call, "log_file_path")
	}
	if s, ok := explicit.(string); ok && slices.Contains(paths, s) {
		return s
	}
	callID, ok := get(call, "call_id").(string)
	if !ok || !safeID.MatchString(callID) {
		return ""
	}
	var matches []string
	for _, p := range paths {
		if pathHasPart(p, callID) {
			matches = append(matches, p)
		}
	}
	if len(matches) == 1 {
		return matches[0]
	}
	return ""
}

// ---- campaign-inputs.mjs

// Agents write placeholders as {{name}} or, in Botnoi llm_agent prompts, <<name>>.
var promptVariablePattern = regexp.MustCompile(`\{\{([a-zA-Z0-9_-]+)\}\}|<<([a-zA-Z0-9_-]+)>>`)

func promptVariables(agent any) []string {
	text := orEmpty(get(agent, "agent_data", "greeting_text")) + " " + orEmpty(currentPrompt(agent))
	seen := map[string]bool{}
	out := []string{}
	for _, m := range promptVariablePattern.FindAllStringSubmatch(text, -1) {
		name := m[1] + m[2]
		if seen[name] || name == "vc_call_reference" || name == "vc_record_conversation" {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

func csvHeaders(campaign any) []string {
	headers, _ := stringItems(get(campaign, "csv", "headers"))
	return headers
}

func indexOf(list []string, v string) int {
	for i, item := range list {
		if item == v {
			return i
		}
	}
	return -1
}

func campaignBindings(campaign any, variables []string) map[string]any {
	headers := csvHeaders(campaign)
	mapping := get(campaign, "mapping")
	phone := ""
	for _, h := range headers {
		if get(mapping, h) == "phone" {
			phone = h
			break
		}
	}
	out := map[string]any{}
	for _, variable := range variables {
		if saved := get(campaign, "variableBindings", variable); truthy(saved) {
			out[variable] = saved
			continue
		}
		column := ""
		for _, h := range headers {
			if get(mapping, h) == variable {
				column = h
				break
			}
		}
		if column == "" && (variable == "phone_number" || variable == "phone" || variable == "destination") {
			column = phone
		}
		if column == "" {
			for _, h := range headers {
				if strings.ToLower(jsTrim(h)) == strings.ToLower(variable) {
					column = h
					break
				}
			}
		}
		out[variable] = obj{"source": "csv", "column": column}
	}
	return out
}

type preparedRow struct {
	Index       int
	Destination string
	Variables   obj
	Errors      []string
}

type preparedRows struct {
	Rows   []preparedRow
	Errors []string
}

var (
	variableName = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_-]*$`)
	thaiLocal    = regexp.MustCompile(`^0\d{8,9}$`)
	e164         = regexp.MustCompile(`^\+[1-9]\d{7,14}$`)
	reservedKeys = []string{"__proto__", "constructor", "prototype"}
)

// prepareCampaignRows builds an independent payload per recipient; no global value fills a missing cell.
func prepareCampaignRows(campaign any, variables []string) preparedRows {
	bindings := campaignBindings(campaign, variables)
	headers := csvHeaders(campaign)
	phoneIndex := -1
	for i, h := range headers {
		if get(campaign, "mapping", h) == "phone" {
			phoneIndex = i
			break
		}
	}
	errs := []string{}
	if phoneIndex < 0 {
		errs = append(errs, "ยังไม่ได้เลือกคอลัมน์เบอร์โทร")
	}
	if len(variables) > 50 {
		errs = append(errs, "รองรับตัวแปรไม่เกิน 50 ตัว")
	}
	csvColumn := func(variable string) (int, bool) {
		b := bindings[variable]
		if get(b, "source") != "csv" {
			return 0, false
		}
		column, ok := get(b, "column").(string)
		i := indexOf(headers, column)
		return i, ok && i >= 0
	}
	for _, variable := range variables {
		if !variableName.MatchString(variable) || slices.Contains(reservedKeys, variable) {
			errs = append(errs, "ชื่อตัวแปรไม่รองรับ: "+variable)
		}
		if _, ok := csvColumn(variable); get(bindings[variable], "source") != "output" && !ok {
			errs = append(errs, "เลือกคอลัมน์ CSV สำหรับ "+variable)
		}
	}
	if saved, ok := get(campaign, "variableBindings").(obj); ok {
		for _, old := range sortedKeys(saved) {
			if !slices.Contains(variables, old) {
				errs = append(errs, "Agent เปลี่ยนตัวแปรแล้ว กรุณาจับคู่ใหม่: "+old)
			}
		}
	}
	csvRows, _ := get(campaign, "csv", "rows").([]any)
	out := preparedRows{Rows: []preparedRow{}}
	for index, raw := range csvRows {
		row, _ := raw.([]any)
		cell := func(i int) string {
			if i < 0 || i >= len(row) {
				return ""
			}
			return orEmpty(row[i])
		}
		destination := removeChars(cell(phoneIndex), "().-")
		normalized := destination
		if thaiLocal.MatchString(destination) {
			normalized = "+66" + destination[1:]
		}
		r := preparedRow{Index: index, Destination: destination, Variables: obj{}, Errors: []string{}}
		if !e164.MatchString(normalized) {
			r.Errors = append(r.Errors, "เบอร์โทรไม่ถูกต้อง")
		}
		var values ordered
		for _, variable := range variables {
			i, ok := csvColumn(variable)
			if !ok {
				continue
			}
			value := cell(i)
			switch {
			case jsTrim(value) == "":
				r.Errors = append(r.Errors, variable+" ว่าง")
			case jsLen(value) > 2000:
				r.Errors = append(r.Errors, variable+" ยาวเกิน 2,000 ตัวอักษร")
			default:
				r.Variables[variable] = value
				values = append(values, kv{variable, value})
			}
		}
		if len(jsStringify(values)) > 16000 {
			r.Errors = append(r.Errors, "ข้อมูลของรายชื่อนี้ใหญ่เกินไป")
		}
		out.Rows = append(out.Rows, r)
	}
	if len(out.Rows) == 0 {
		errs = append(errs, "ไม่มีรายชื่อใน CSV")
	}
	out.Errors = errs
	return out
}

// sortedKeys returns object keys in a stable order.
// ponytail: decoded JSON loses insertion order, so error lists use sorted keys instead of JS order.
func sortedKeys(m obj) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// ---- campaign-queue.mjs

var terminalStatuses = []string{"completed", "failed", "busy", "no-answer", "cancelled", "canceled"}

func terminalCall(status any) bool {
	s, ok := status.(string)
	return ok && slices.Contains(terminalStatuses, s)
}

// newerFirst orders attempts like the JS comparator: created_at descending, then id descending.
func newerFirst(a, b obj) bool {
	ta, okA := jsDateParse(a["created_at"])
	tb, okB := jsDateParse(b["created_at"])
	if okA && okB && ta != tb {
		return ta > tb
	}
	return jsString(a["id"]) > jsString(b["id"])
}

func contactRow(attempt obj) (int, bool) { return jsInt(get(attempt, "metadata", "contact_row")) }

func latestAttempt(attempts []obj, index int) obj {
	var latest obj
	for _, a := range attempts {
		if row, ok := contactRow(a); ok && row == index && (latest == nil || newerFirst(a, latest)) {
			latest = a
		}
	}
	return latest
}

func campaignRequestID(campaignID, version string, row int, redialOf string) string {
	source := fmt.Sprintf("voice-campaign-v1:%s:%s:%d", campaignID, version, row)
	if redialOf != "" {
		source = fmt.Sprintf("voice-campaign-redial-v1:%s:%s:%d:%s", campaignID, version, row, redialOf)
	}
	sum := sha256.Sum256([]byte(source))
	b := sum[:16]
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

// ---- campaign-schedule.mjs (campaign times are Thailand time, UTC+7)

var (
	datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	timePattern = regexp.MustCompile(`^\d{2}:\d{2}$`)
	bangkok     = time.FixedZone("ICT", 7*3600)
)

// scheduledTime returns the ISO instant for a Thailand date and time, or "" if invalid.
func scheduledTime(date, clock string) string {
	if !datePattern.MatchString(date) || !timePattern.MatchString(clock) {
		return ""
	}
	t, err := time.ParseInLocation("2006-01-02T15:04", date+"T"+clock, bangkok)
	if err != nil || t.In(bangkok).Format("2006-01-02T15:04") != date+"T"+clock {
		return ""
	}
	return jsISO(t.UnixMilli())
}

func validWeekdays(v any) ([]int, bool) {
	list, ok := v.([]any)
	if !ok {
		return nil, false
	}
	out := make([]int, 0, len(list))
	for _, d := range list {
		n, ok := jsInt(d)
		if !ok || n < 0 || n > 6 {
			return nil, false
		}
		out = append(out, n)
	}
	return out, true
}

func nextScheduleTime(after int64, recurrence, clock string, weekdays any) string {
	if recurrence != "daily" && recurrence != "weekly" {
		return ""
	}
	days, ok := validWeekdays(weekdays)
	if recurrence == "weekly" && (!ok || len(days) == 0) {
		return ""
	}
	local := time.UnixMilli(after + 7*3600000).UTC()
	for offset := 0; offset <= 7; offset++ {
		day := time.Date(local.Year(), local.Month(), local.Day()+offset, 0, 0, 0, 0, time.UTC)
		if recurrence == "weekly" && !slices.Contains(days, int(day.Weekday())) {
			continue
		}
		candidate := scheduledTime(day.Format("2006-01-02"), clock)
		if ms, ok := jsDateParse(candidate); ok && ms > after {
			return candidate
		}
	}
	return ""
}

func firstScheduleTime(rule any, now int64) string {
	initial := scheduledTime(strOr(get(rule, "date")), strOr(get(rule, "time")))
	recurrence := strOr(get(rule, "recurrence"))
	if initial == "" || (recurrence != "once" && recurrence != "daily" && recurrence != "weekly") {
		return ""
	}
	start, _ := jsDateParse(initial)
	if recurrence == "once" {
		if start > now {
			return initial
		}
		return ""
	}
	weekdays := get(rule, "weekdays")
	if !has(rule, "weekdays") {
		weekdays = []any{}
	}
	return nextScheduleTime(max(now, start-1), recurrence, strOr(get(rule, "time")), weekdays)
}
