package main

import (
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

// testdata/node_golden.json holds outputs of the Node reference implementation (server/, shared/)
// for the same inputs. Each case has input, and either value or status+error.
type goldenCase struct {
	Input  []any  `json:"input"`
	Value  any    `json:"value"`
	Status int    `json:"status"`
	Error  string `json:"error"`
}

// canon renders any Go value as decoded JSON with sorted keys, so structs, maps and typed
// slices compare equal to the decoded Node output.
func canon(v any) string {
	data, err := json.Marshal(v)
	if err != nil {
		return "marshal error: " + err.Error()
	}
	decoded, _ := decodeJSON(data)
	return jsStringify(decoded)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func objects(v any) []obj {
	list, _ := v.([]any)
	out := make([]obj, len(list))
	for i, item := range list {
		out[i], _ = item.(obj)
	}
	return out
}

func strings_(v any) []string {
	list, _ := v.([]any)
	out := make([]string, len(list))
	for i, item := range list {
		out[i], _ = item.(string)
	}
	return out
}

func receptionOf(v any) reception {
	return reception{strOr(get(v, "company_name")), strOr(get(v, "support_phone")), strOr(get(v, "company_details"))}
}

func rangeOf(v any) dateRange { return dateRange{strOr(get(v, "start")), strOr(get(v, "end"))} }

func entriesJSON(entries []audioEntry) []obj {
	out := []obj{}
	for _, e := range entries {
		out = append(out, obj{"id": e.ID, "file_time": e.FileTime, "part": e.Part, "path": e.Path})
	}
	return out
}

func rowsJSON(p preparedRows) obj {
	rows := []any{}
	for _, r := range p.Rows {
		errs := append([]string{}, r.Errors...)
		rows = append(rows, obj{"index": r.Index, "destination": r.Destination, "variables": objOr(r.Variables), "errors": errs})
	}
	return obj{"rows": rows, "errors": append([]string{}, p.Errors...)}
}

func num(v any) int64 { f, _ := v.(float64); return int64(f) }

// goldenFuncs maps each Node function to its Go port; a nil error means a value result.
var goldenFuncs = map[string]func(in []any) (any, error){
	"transcriptToolPayload": func(in []any) (any, error) {
		return transcriptToolPayload(strOr(in[0]), strOr(in[1]), strOr(in[2]), strOr(in[3])), nil
	},
	"withTranscriptPrompt": func(in []any) (any, error) { return withTranscriptPrompt(in[0], strOr(in[1])) },
	"generalToolPayload": func(in []any) (any, error) {
		return generalToolPayload(strOr(in[0]), strOr(in[1]), strOr(in[2]), strOr(in[3]), strOr(in[4]))
	},
	"withGeneralPrompt":       func(in []any) (any, error) { return withGeneralPrompt(in[0], strOr(in[1]), receptionOf(in[2])) },
	"generalReceptionProfile": func(in []any) (any, error) { return generalReceptionProfile(in[0]).obj(), nil },
	"validateGeneralReception": func(in []any) (any, error) {
		r, err := validateGeneralReception(in[0])
		return r.obj(), err
	},
	"generalGreeting":   func(in []any) (any, error) { return generalGreeting(receptionOf(in[0])), nil },
	"generalCredential": func(in []any) (any, error) { return generalCredential(strOr(in[0]), strOr(in[1]), strOr(in[2])) },
	"generalEndpoint": func(in []any) (any, error) {
		return nullIfEmpty(generalEndpoint(Config{CallbackURL: strOr(in[0])})), nil
	},
	"searchGeneralEvents": func(in []any) (any, error) {
		return searchGeneralEvents(objects(in[0]), strOr(in[1]), strOr(in[2]), strOr(in[3])), nil
	},
	"normalizeCaller": func(in []any) (any, error) { return nullIfEmpty(normalizeCaller(in[0])), nil },
	"lookupEvents":    func(in []any) (any, error) { return lookupEvents(objects(in[0]), strOr(in[1]), in[2]), nil },
	"eventProjection": func(in []any) (any, error) { return eventProjection(in[0], strOr(in[1])), nil },
	"setupRevision":   func(in []any) (any, error) { return setupRevision(in[0]), nil },
	"schedulerSecret": func(in []any) (any, error) { return schedulerSecret(strOr(in[0])) },
	"accountCallbackSecret": func(in []any) (any, error) {
		return accountCallbackSecret(strOr(in[0]), strOr(in[1]))
	},
	"accountRecordingSecret": func(in []any) (any, error) {
		return accountRecordingSecret(strOr(in[0]), strOr(in[1]))
	},
	"campaignRequestId": func(in []any) (any, error) {
		return campaignRequestID(strOr(in[0]), strOr(in[1]), int(num(in[2])), strOr(in[3])), nil
	},
	"campaignBindings": func(in []any) (any, error) { return campaignBindings(in[0], strings_(in[1])), nil },
	"prepareCampaignRows": func(in []any) (any, error) {
		return rowsJSON(prepareCampaignRows(in[0], strings_(in[1]))), nil
	},
	"promptVariables": func(in []any) (any, error) { return append([]string{}, promptVariables(in[0])...), nil },
	"scheduledTime":   func(in []any) (any, error) { return nullIfEmpty(scheduledTime(strOr(in[0]), strOr(in[1]))), nil },
	"firstScheduleTime": func(in []any) (any, error) {
		return nullIfEmpty(firstScheduleTime(in[0], num(in[1]))), nil
	},
	"nextScheduleTime": func(in []any) (any, error) {
		return nullIfEmpty(nextScheduleTime(num(in[0]), strOr(in[1]), strOr(in[2]), in[3])), nil
	},
	"providerOutcome": func(in []any) (any, error) { return providerOutcome(in[0], in[1]), nil },
	"transcriptText":  func(in []any) (any, error) { return transcriptText(in[0]), nil },
	"matchingLogPath": func(in []any) (any, error) { return nullIfEmpty(matchingLogPath(in[0], in[1])), nil },
	"recordingPath":   func(in []any) (any, error) { return nullIfEmpty(recordingPath(strings_(in[0]), in[1])), nil },
	"audioEntries": func(in []any) (any, error) {
		return entriesJSON(audioEntries(in[0], strOr(in[1]), rangeOf(in[2]))), nil
	},
	"audioDateRange": func(in []any) (any, error) {
		r, err := audioDateRange(parseQuery(strOr(in[0])))
		return obj{"start": r.start, "end": r.end}, err
	},
	"logFileListPath": func(in []any) (any, error) { return logFileListPath(strOr(in[0]), rangeOf(in[1])), nil },
	"tokenExpiry": func(in []any) (any, error) {
		s, err := tokenExpiry(in[0])
		return nullIfEmpty(s), err
	},
	"validTranscriptPayload": func(in []any) (any, error) {
		b, _ := in[0].(obj)
		return validTranscriptPayload(b), nil
	},
	"latestAttempt": func(in []any) (any, error) {
		latest := latestAttempt(objects(in[0]), int(num(in[1])))
		if latest == nil {
			return nil, nil
		}
		return latest, nil
	},
}

// Node error messages that come from the JS runtime rather than the handlers; only the failure matters.
var runtimeErrors = map[string]bool{"tokenExpiry": true, "schedulerSecret": true, "generalCredential": true}

// knownDivergences are Node quirks the Go port deliberately does not copy.
var knownDivergences = map[string]string{
	// Node reads Object.prototype.constructor as a saved binding; the variable is rejected either way.
	"campaignBindings[10]": "prototype lookup", "campaignBindings[14]": "prototype lookup",
	// Records without data or updated_at never come from the database (both columns are selected and required).
	"eventProjection[3]": "missing updated_at", "eventProjection[4]": "missing data",
}

func TestNodeGolden(t *testing.T) {
	raw, err := os.ReadFile("testdata/node_golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden map[string][]goldenCase
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	for name, cases := range golden {
		fn := goldenFuncs[name]
		if fn == nil {
			t.Errorf("no Go function mapped for %s", name)
			continue
		}
		for i, c := range cases {
			if knownDivergences[fmt.Sprintf("%s[%d]", name, i)] != "" {
				continue
			}
			// Re-decode inputs so objects are obj, as decodeJSON would produce them.
			data, _ := json.Marshal(c.Input)
			decoded, _ := decodeJSON(data)
			value, err := fn(decoded.([]any))
			failed := c.Error != ""
			switch {
			case failed && err == nil:
				t.Errorf("%s[%d]: want error %q, got value %.200s", name, i, c.Error, canon(value))
			case !failed && err != nil:
				t.Errorf("%s[%d]: unexpected error %v", name, i, err)
			case failed && !runtimeErrors[name]:
				he, ok := asHTTPError(err)
				if !ok || he.status != c.Status || he.msg != c.Error {
					t.Errorf("%s[%d]: want %d %q, got %v", name, i, c.Status, c.Error, err)
				}
			case !failed:
				if got, want := canon(value), canon(c.Value); got != want {
					at := 0
					for at < len(got) && at < len(want) && got[at] == want[at] {
						at++
					}
					from := max(0, at-80)
					t.Errorf("%s[%d] differs at byte %d:\n got …%.300s\nwant …%.300s", name, i, at, got[from:], want[from:])
				}
			}
		}
	}
}
