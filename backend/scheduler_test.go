package main

// Port of the worker and alarm cases in scripts/test-scheduler.mjs. The Node version stubbed the
// internal /api/voice calls; here they run through the real worker path against fixtures.

import (
	"context"
	"fmt"
	"maps"
	"strconv"
	"strings"
	"testing"
	"time"
)

const (
	schedOwner    = "11111111-1111-4111-8111-111111111111"
	schedCampaign = "33333333-3333-4333-8333-333333333333"
	schedVersion  = "2026-10-17T00:00:00+00:00"
)

var schedEnv = map[string]string{"SUPABASE_URL": "https://db.invalid", "SUPABASE_PUBLISHABLE_KEY": "publishable", "SUPABASE_SERVICE_ROLE_KEY": "service",
	"VOICE_CONNECTION_ENCRYPTION_KEY": fixtureKey, "VOICE_BOT_BASE_URL": "https://voice.invalid", "VOICE_RESULT_CALLBACK_SECRET": "fixture-secret-longer-than-thirty-two-characters"}

type schedFixture struct {
	*fixture
	opt      map[string]any
	attempts []any
	dials    []obj
	update   obj   // last voice_campaign_jobs PATCH
	saved    []obj // voice_call_requests PATCH bodies
	inserted []obj
}

func newSchedFixture(t *testing.T, opt map[string]any) *schedFixture {
	s := &schedFixture{fixture: &fixture{t: t}, opt: opt, attempts: []any{}}
	if list, ok := opt["attempts"].([]any); ok {
		s.attempts = list
	}
	s.serve = s.reply
	return s
}

func schedAttempt(row int, status string, callID any) obj {
	return obj{"id": fmt.Sprintf("44444444-4444-4444-8444-%012d", row), "call_id": callID, "status": status, "created_at": "2026-10-17T00:0" + jsString(float64(row)) + ":00Z",
		"agent_id": "agt_fixture", "metadata": obj{"campaign_id": schedCampaign, "campaign_version": schedVersion, "contact_row": float64(row), "voice_account_id": "account"}}
}

// runAttempt is the n-th ended attempt of a row in the fixture job's run, with saved result fields (retryColumns).
func runAttempt(row, n int, fields obj) obj {
	a := schedAttempt(row, "no-answer", fmt.Sprintf("oc_%d_%d", row, n))
	a["id"], a["created_at"], a["final"] = fmt.Sprintf("55555555-5555-4555-8555-%06d%06d", row, n), fmt.Sprintf("2026-10-17T00:%02d:00Z", row*10+n), "true"
	a["metadata"].(obj)["schedule_job_id"], a["metadata"].(obj)["schedule_run_id"] = "job", "run1"
	maps.Copy(a, fields)
	return a
}

func (s *schedFixture) campaign() obj {
	version := schedVersion
	if truthy(s.opt["changed"]) {
		version = "2027-01-01T00:00:00+00:00"
	}
	rows := []any{[]any{"0812345678"}, []any{"0898765432"}}
	if truthy(s.opt["oneRow"]) {
		rows = rows[:1]
	}
	if truthy(s.opt["foreign"]) {
		return nil
	}
	return obj{"id": schedCampaign, "owner_id": schedOwner, "state": "saved", "updated_at": version,
		"data": obj{"agentId": "agt_fixture", "csv": obj{"headers": []any{"phone"}, "rows": rows}, "mapping": obj{"phone": "phone"}, "variableBindings": obj{}}}
}

func (s *schedFixture) reply(c call) reply {
	if c.Host == "db.invalid" {
		table := strings.TrimPrefix(c.Path, "/rest/v1/")
		switch {
		case strings.HasPrefix(c.Path, "/auth/v1/admin/users/"):
			return ok(obj{"id": schedOwner, "email": "owner@example.invalid", "email_confirmed_at": "2026-01-01"})
		case table == "voice_bot_connections":
			sealed, _ := sealToken("worker-token", schedOwner, fixtureKey)
			var expires any
			if truthy(s.opt["expired"]) {
				expires = "2000-01-01T00:00:00Z"
			}
			return ok(obj{"owner_id": schedOwner, "account_id": "account", "token_ciphertext": sealed, "expires_at": expires})
		case table == "voice_campaigns":
			check(s.t, c.Query.Get("owner_id") == "eq."+schedOwner, "campaign query not owner scoped")
			return ok(s.campaign())
		case table == "voice_scheduler_health":
			tick := nowISO()
			if truthy(s.opt["stale"]) {
				tick = "2000-01-01"
			}
			return ok(obj{"last_tick": tick})
		case table == "voice_campaign_jobs" && c.Method == "GET":
			if c.Query.Get("id") != "" {
				return ok(s.opt["existing"])
			}
			if truthy(s.opt["active"]) {
				return ok([]any{obj{"id": "active", "status": "scheduled"}})
			}
			return ok([]any{})
		case table == "voice_campaign_jobs" && c.Method == "POST":
			row := c.Body.(obj)
			s.inserted = append(s.inserted, row)
			return status(201, []any{row})
		case table == "voice_campaign_jobs" && c.Method == "PATCH":
			check(s.t, c.Query.Get("lease_id") == "eq.lease" && c.Query.Get("status") == "eq.running", "job update not lease guarded")
			s.update = c.Body.(obj)
			return status(204, nil)
		case table == "voice_call_requests" && c.Method == "GET":
			if id := strings.TrimPrefix(c.Query.Get("id"), "eq."); id != "" {
				for _, a := range s.attempts {
					if get(a, "id") == id {
						return ok(a)
					}
				}
				return ok(nil)
			}
			if id := strings.TrimPrefix(c.Query.Get("call_id"), "eq."); id != "" {
				for _, a := range s.attempts {
					if get(a, "call_id") == id {
						return ok(a)
					}
				}
				return ok(nil)
			}
			if c.Query.Has("offset") {
				return ok(s.attempts)
			}
			if c.Query.Has("or") {
				if truthy(s.opt["foreignHistory"]) {
					return ok([]any{obj{"id": "old"}})
				}
				return ok([]any{})
			}
			if row := c.Query.Get("metadata->>contact_row"); row != "" {
				n, _ := strconv.Atoi(strings.TrimPrefix(row, "eq."))
				if latest := latestAttempt(objects(s.attempts), n); latest != nil {
					return ok(latest)
				}
				return ok(nil)
			}
		case table == "voice_call_requests" && c.Method == "PATCH":
			s.saved = append(s.saved, c.Body.(obj))
			return ok([]any{obj{"id": strings.TrimPrefix(c.Query.Get("id"), "eq.")}})
		case table == "rpc/reserve_scheduled_voice_call":
			check(s.t, get(c.Body, "p_lease_id") == "lease", "reservation not leased")
			return ok(nil)
		}
	}
	if c.Host == "voice.invalid" {
		check(s.t, c.Header.Get("Authorization") == "Bearer worker-token", "worker used another token")
		switch {
		case c.Path == "/me":
			account, _ := s.opt["account"].(string)
			if account == "" {
				account = "account"
			}
			return ok(obj{"_id": account})
		case c.Path == "/agents":
			return ok([]any{obj{"agent_id": "agt_fixture"}})
		case c.Path == "/agents/agt_fixture":
			return ok(obj{"agent_id": "agt_fixture", "bot_name": "Fixture", "agent_data": obj{"greeting_text": "Hello"}})
		case strings.HasSuffix(c.Path, "/overview"):
			return ok(obj{"sections": obj{"tenant": obj{"ok": true, "data": obj{"outbound": obj{"enabled": true}, "readiness": obj{"pbx": obj{"ready": true}}}},
				"trunk_status": obj{"ok": true, "data": obj{"mode": "ip"}}}})
		case c.Path == "/v1/provisioning/tenants/account/calls" && c.Method == "POST":
			s.dials = append(s.dials, c.Body.(obj))
			if truthy(s.opt["timeout"]) {
				return networkFailure
			}
			return ok(obj{"call_id": "oc_new", "status": "queued"})
		case strings.HasPrefix(c.Path, "/v1/provisioning/tenants/account/calls/"):
			st, _ := s.opt["status"].(string)
			if st == "" {
				st = "ringing"
			}
			return ok(obj{"status": st, "call_id": strings.TrimPrefix(c.Path, "/v1/provisioning/tenants/account/calls/")})
		case strings.HasPrefix(c.Path, "/calls/"), strings.HasPrefix(c.Path, "/logs/list_file/"):
			return ok([]any{})
		case strings.HasPrefix(c.Path, "/analytics/"):
			return ok(obj{"enabled": false})
		}
	}
	s.t.Fatalf("unexpected call %s %s%s?%s", c.Method, c.Host, c.Path, c.Query.Encode())
	return reply{}
}

func (s *schedFixture) runJob(job obj) error {
	full := obj{"id": "job", "owner_id": schedOwner, "campaign_id": schedCampaign, "campaign_version": schedVersion, "account_id": "account",
		"lease_id": "lease", "run_id": "run1", "run_at": "2026-10-17T00:00:00Z"}
	for k, v := range job {
		full[k] = v
	}
	a := newApp(s.fixture, schedEnv)
	return a.processCampaignJob(context.Background(), a.serviceDB(context.Background()), full)
}

func (s *schedFixture) dialRow(i int) any { return get(s.dials[i], "metadata", "contact_row") }

func TestCampaignWorker(t *testing.T) {
	run := func(name string, opt map[string]any, job obj, fn func(t *testing.T, s *schedFixture)) {
		t.Run(name, func(t *testing.T) {
			s := newSchedFixture(t, opt)
			check(t, s.runJob(job) == nil, "worker returned an error")
			fn(t, s)
		})
	}
	run("A worker tick submits only one row", map[string]any{}, nil, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 1 && s.dialRow(0) == float64(0) && s.update["status"] == "running", "dials %v update %v", s.dials, s.update)
	})
	run("A running call is polled without dialing again", map[string]any{"attempts": []any{schedAttempt(0, "ringing", "oc_old")}}, nil, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 0 && s.update["status"] == "running", "dials %v update %v", s.dials, s.update)
	})
	run("After a call ends the next row is dialed", map[string]any{"attempts": []any{schedAttempt(0, "ringing", "oc_old")}, "status": "completed"}, nil, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 1 && s.dialRow(0) == float64(1), "dials %v update %v", s.dials, s.update)
	})
	run("An uncertain reservation stops the job without redial", map[string]any{"attempts": []any{schedAttempt(0, "unknown", nil)}}, nil, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 0 && s.update["status"] == "failed", "dials %v update %v", s.dials, s.update)
	})
	for _, opt := range []map[string]any{{"changed": true}, {"account": "foreign"}} {
		run("Changed campaign or account stops before dialing", opt, nil, func(t *testing.T, s *schedFixture) {
			check(t, len(s.dials) == 0 && s.update["status"] == "failed", "dials %v update %v", s.dials, s.update)
		})
	}
	completed := []any{schedAttempt(0, "completed", "a"), schedAttempt(1, "completed", "b")}
	run("All completed rows finish the job without redial", map[string]any{"attempts": completed}, nil, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 0 && s.update["status"] == "completed" && s.update["completed_runs"] == float64(1), "dials %v update %v", s.dials, s.update)
	})
	run("A completed repeating run waits for the next alarm instead of redialing immediately", map[string]any{"attempts": completed},
		obj{"recurrence": "daily", "local_time": "09:00", "weekdays": []any{}}, func(t *testing.T, s *schedFixture) {
			next, _ := jsDateParse(s.update["next_run_at"])
			check(t, len(s.dials) == 0 && s.update["status"] == "scheduled" && next > time.Now().UnixMilli() && s.update["run_id"] != "run1", "update %v", s.update)
		})
	run("Redial is explicit and every run uses its previous terminal call ID", map[string]any{"attempts": []any{schedAttempt(0, "completed", "a")}}, obj{"redial": true}, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 1 && get(s.dials[0], "metadata", "campaign_redial_of") == "44444444-4444-4444-8444-000000000000", "dials %v", s.dials)
	})
	prior := schedAttempt(0, "completed", "a")
	prior["metadata"].(obj)["schedule_job_id"], prior["metadata"].(obj)["schedule_run_id"] = "job", "run1"
	run("A row already dispatched in this alarm occurrence is not sent twice", map[string]any{"attempts": []any{prior}}, obj{"redial": true}, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 1 && s.dialRow(0) == float64(1), "dials %v update %v", s.dials, s.update)
	})
	run("An alarm only dispatches its selected contact rows", map[string]any{}, obj{"contact_rows": []any{float64(1)}}, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 1 && s.dialRow(0) == float64(1), "dials %v update %v", s.dials, s.update)
	})
	run("An uncertain dial stops the job", map[string]any{"timeout": true}, nil, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 1 && s.update["status"] == "failed", "dials %v update %v", s.dials, s.update)
	})
	retries := obj{"max_attempts": float64(3)}
	run("A finished unanswered call is saved with its result before the next row", map[string]any{"attempts": []any{schedAttempt(0, "ringing", "oc_old")}, "status": "no-answer"}, retries,
		func(t *testing.T, s *schedFixture) {
			check(t, len(s.saved) == 2 && s.saved[0]["status"] == "no-answer" && get(s.saved[0], "response", "followup", "outcome", "call_result") == "NO_ANSWER", "saved %v", s.saved)
			check(t, len(s.dials) == 1 && s.dialRow(0) == float64(1), "dials %v", s.dials)
		})
	noAnswer := runAttempt(0, 1, nil)
	run("An unanswered row is called again as a retry of its last attempt", map[string]any{"attempts": []any{noAnswer}}, retries, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 1 && s.dialRow(0) == float64(0) && get(s.dials[0], "metadata", "campaign_redial_of") == noAnswer["id"], "dials %v", s.dials)
	})
	for _, result := range []obj{{"followup": "CONFIRMED"}, {"callback": "DECLINED", "followup": "NO_ANSWER"}, {"review": "WRONG_PERSON"}, {"followup": "REQUEST_AGENT"}} {
		run("A final result is never called again", map[string]any{"oneRow": true, "attempts": []any{runAttempt(0, 1, maps.Clone(result))}}, retries, func(t *testing.T, s *schedFixture) {
			check(t, len(s.dials) == 0 && s.update["status"] == "completed", "%v: dials %v update %v", result, s.dials, s.update)
		})
	}
	run("A row stops after max_attempts", map[string]any{"oneRow": true, "attempts": []any{runAttempt(0, 1, nil), runAttempt(0, 2, nil), runAttempt(0, 3, nil)}}, retries, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 0 && s.update["status"] == "completed", "dials %v update %v", s.dials, s.update)
	})
	ended := time.Now().Add(-time.Minute).UnixMilli()
	run("A retry that is not due yet waits without dialing", map[string]any{"oneRow": true, "attempts": []any{runAttempt(0, 1, obj{"completed_at": jsISO(ended)})}}, retries, func(t *testing.T, s *schedFixture) {
		check(t, len(s.dials) == 0 && s.update["status"] == "running" && s.update["next_run_at"] == jsISO(callingHours(ended+10*60000)), "update %v", s.update)
	})
	unreachable := obj{"status": "failed", "reason": "unreachable"}
	run("Three unreachable calls in a row pause the queue", map[string]any{"attempts": []any{runAttempt(0, 1, unreachable), runAttempt(1, 1, unreachable), runAttempt(0, 2, unreachable)}}, retries,
		func(t *testing.T, s *schedFixture) {
			check(t, len(s.dials) == 0 && s.update["status"] == "failed" && strings.Contains(jsString(s.update["last_error"]), "3 สาย"), "update %v", s.update)
		})
	run("An answered call without a result is checked again, then retried", map[string]any{"oneRow": true, "status": "completed", "attempts": []any{runAttempt(0, 1, obj{"status": "completed", "final": nil})}}, retries,
		func(t *testing.T, s *schedFixture) {
			check(t, len(s.saved) == 2 && s.saved[0]["status"] == "completed", "result not refreshed: %v", s.saved)
			check(t, len(s.dials) == 1 && s.dialRow(0) == float64(0), "dials %v update %v", s.dials, s.update)
		})
	run("An answered call without a result is retried only once", map[string]any{"oneRow": true, "attempts": []any{runAttempt(0, 1, obj{"status": "completed"}), runAttempt(0, 2, obj{"status": "completed"})}}, retries,
		func(t *testing.T, s *schedFixture) {
			check(t, len(s.dials) == 0 && s.update["status"] == "completed", "dials %v update %v", s.dials, s.update)
		})
}

func TestCallingHours(t *testing.T) {
	at := func(s string) int64 {
		v, _ := time.ParseInLocation("2006-01-02 15:04", s, bangkok)
		return v.UnixMilli()
	}
	for in, want := range map[string]string{"2026-10-20 08:59": "2026-10-20 09:00", "2026-10-20 12:30": "2026-10-20 12:30",
		"2026-10-20 19:59": "2026-10-20 19:59", "2026-10-20 20:00": "2026-10-21 09:00", "2026-10-20 23:50": "2026-10-21 09:00"} {
		check(t, callingHours(at(in)) == at(want), "%s moved to %s", in, time.UnixMilli(callingHours(at(in))).In(bangkok))
	}
}

func schedRequest(s *schedFixture, body obj) response {
	a := newApp(s.fixture, schedEnv)
	var expires any
	if truthy(s.opt["expired"]) {
		expires = "2000-01-01"
	}
	return direct(s.fixture, a, "POST", obj{"id": schedOwner, "email": "owner@example.invalid", "email_confirmed_at": "2026-01-01"}, obj{"account_id": "account", "owner_id": schedOwner, "expires_at": expires},
		func(v *voiceRequest) error { return v.handleSchedule(body, schedCampaign) })
}

func alarm(changes obj) obj {
	future := time.Now().Add(24 * time.Hour).In(bangkok).Format("2006-01-02")
	body := obj{"action": "configure", "request_id": "55555555-5555-4555-8555-555555555555", "consent": true, "campaign_version": schedVersion,
		"schedule": obj{"date": future, "time": "12:00", "recurrence": "once", "weekdays": []any{}, "redial": false}}
	for k, v := range changes {
		body[k] = v
	}
	return roundJSON(body).(obj)
}

func TestCampaignAlarm(t *testing.T) {
	t.Run("Alarm configuration uses the owner and requires explicit consent", func(t *testing.T) {
		s := newSchedFixture(t, map[string]any{"oneRow": true})
		check(t, schedRequest(s, alarm(obj{"consent": false})).status == 409 && len(s.inserted) == 0, "consent not required")
		r := schedRequest(s, alarm(nil))
		check(t, r.status == 200 && len(s.inserted) == 1, "= %d %v", r.status, r.data)
		runAt, _ := jsDateParse(s.inserted[0]["run_at"])
		check(t, runAt > time.Now().UnixMilli() && s.inserted[0]["owner_id"] == schedOwner, "inserted %v", s.inserted[0])
	})
	for _, opt := range []map[string]any{{"stale": true}, {"expired": true}, {"foreign": true}, {"foreignHistory": true}, {"active": true}} {
		t.Run("Unhealthy scheduler, expired token, foreign campaign or incompatible history cannot enqueue", func(t *testing.T) {
			opt["oneRow"] = true
			s := newSchedFixture(t, opt)
			check(t, schedRequest(s, alarm(nil)).status != 200 && len(s.inserted) == 0, "enqueued with %v", opt)
		})
	}
	t.Run("A repeated confirmation returns only its own saved alarm without another insert", func(t *testing.T) {
		s := newSchedFixture(t, map[string]any{"oneRow": true, "existing": obj{"id": "55555555-5555-4555-8555-555555555555", "campaign_id": schedCampaign, "campaign_version": "2026-10-17T00:00:00Z", "status": "scheduled"}})
		r := schedRequest(s, alarm(nil))
		check(t, r.status == 200 && len(s.inserted) == 0 && get(r.data, "job", "id") == "55555555-5555-4555-8555-555555555555", "= %d %v", r.status, r.data)
	})
	t.Run("Alarms reject missing weekdays, invalid row selections and forged schedule IDs", func(t *testing.T) {
		for _, patch := range []obj{{"request_id": "invalid"}, {"contact_rows": []any{}}, {"contact_rows": []any{99}}, {"contact_rows": []any{0, 0}},
			{"schedule": obj{"date": "2027-01-01", "time": "09:00", "recurrence": "weekly", "weekdays": []any{}, "redial": false}}} {
			s := newSchedFixture(t, map[string]any{"oneRow": true})
			check(t, schedRequest(s, alarm(patch)).status != 200 && len(s.inserted) == 0, "accepted %v", patch)
		}
	})
	t.Run("An existing campaign can receive a new optional recurring alarm", func(t *testing.T) {
		s := newSchedFixture(t, map[string]any{"oneRow": true})
		body := alarm(nil)
		body["schedule"].(obj)["recurrence"], body["schedule"].(obj)["redial"] = "daily", true
		check(t, schedRequest(s, body).status == 200 && s.inserted[0]["recurrence"] == "daily" && s.inserted[0]["redial"] == true, "inserted %v", s.inserted)
	})
	t.Run("An old automatic-create request no longer starts calls", func(t *testing.T) {
		s := newSchedFixture(t, map[string]any{"oneRow": true})
		check(t, schedRequest(s, alarm(obj{"action": "start"})).status != 200 && len(s.inserted) == 0, "start accepted")
	})
}

func TestSchedulerEndpoint(t *testing.T) {
	t.Run("Worker endpoint rejects requests without the dedicated credential", func(t *testing.T) {
		f := &fixture{t: t, serve: func(c call) reply { t.Fatalf("unexpected call"); return reply{} }}
		r := serveHTTP(newApp(f, schedEnv), "POST", "/event-confirm/api/voice-scheduler", map[string]string{"Authorization": "Bearer forged"}, "")
		check(t, r.status == 401, "forged = %d", r.status)
	})
	t.Run("A valid tick records health, claims one job and processes it", func(t *testing.T) {
		s := newSchedFixture(t, map[string]any{})
		inner := s.serve
		s.serve = func(c call) reply {
			switch c.Path {
			case "/rest/v1/voice_scheduler_health":
				check(t, c.Method == "POST" && get(c.Body, "id") == true, "health not upserted")
				return status(201, nil)
			case "/rest/v1/rpc/claim_voice_campaign_job":
				return ok([]any{obj{"id": "job", "owner_id": schedOwner, "campaign_id": schedCampaign, "campaign_version": schedVersion, "account_id": "account",
					"lease_id": "lease", "run_id": "run1", "run_at": "2026-10-17T00:00:00Z"}})
			}
			return inner(c)
		}
		secret, _ := schedulerSecret(schedEnv["VOICE_RESULT_CALLBACK_SECRET"])
		r := serveHTTP(newApp(s.fixture, schedEnv), "POST", "/event-confirm/api/voice-scheduler", map[string]string{"Authorization": "Bearer " + secret}, "{}")
		check(t, r.status == 200 && r.data["processed"] == float64(1) && len(s.dials) == 1 && s.update["status"] == "running", "= %d %v dials %v", r.status, r.data, s.dials)
	})
	t.Run("A tick refreshes an unresolved call as its owner without dialing", func(t *testing.T) {
		const request = "44444444-4444-4444-8444-444444444444"
		s := newSchedFixture(t, map[string]any{"status": "no-answer"})
		inner := s.serve
		var saved obj
		s.serve = func(c call) reply {
			switch {
			case c.Path == "/rest/v1/voice_scheduler_health":
				return status(201, nil)
			case c.Path == "/rest/v1/rpc/claim_voice_campaign_job":
				return ok([]any{})
			case c.Path == "/rest/v1/voice_call_requests" && c.Query.Get("call_id") == "not.is.null":
				check(t, c.Query.Get("response->followup->>final") == "is.null", "final calls not skipped")
				return ok([]any{obj{"id": request, "owner_id": schedOwner}})
			case c.Path == "/rest/v1/voice_call_requests" && c.Query.Get("id") == "eq."+request:
				check(t, c.Query.Get("owner_id") == "eq."+schedOwner, "refresh not owner scoped")
				if c.Method == "PATCH" {
					saved = c.Body.(obj)
					return ok([]any{obj{"id": request}})
				}
				return ok(obj{"id": request, "owner_id": schedOwner, "call_id": "oc_done", "agent_id": "agt_fixture", "status": "ringing",
					"metadata": obj{"voice_account_id": "account"}, "created_at": nowISO()})
			}
			return inner(c)
		}
		secret, _ := schedulerSecret(schedEnv["VOICE_RESULT_CALLBACK_SECRET"])
		r := serveHTTP(newApp(s.fixture, schedEnv), "POST", "/event-confirm/api/voice-scheduler", map[string]string{"Authorization": "Bearer " + secret}, "{}")
		check(t, r.status == 200 && r.data["refreshed"] == float64(1) && len(s.dials) == 0, "= %d %v dials %v", r.status, r.data, s.dials)
		check(t, saved["status"] == "no-answer" && get(saved, "response", "followup", "outcome", "call_result") == "NO_ANSWER", "saved %v", saved)
	})
}
