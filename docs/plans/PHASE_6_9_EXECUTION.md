# P6–P9 execution status

Updated: 2026-10-21. User authorized implementation of P6–P9.
This document distinguishes implemented/tested code from production readiness.

## Settings requirement delivered in code

Settings is now event-scoped, including its URL. Users set new-call weight X,
retry-call weight Y, and maxRetries n. n excludes the initial call: n=0 disables
redial; n=2 permits at most three total attempts. Limits are enforced by the
PostgreSQL dispatcher and final-result processing, not only by the demo.
Changing policy requires pause/no pending attempt and a matching version.
A higher limit does not silently restart stopped participants.

## Phase status and remaining gates

| Phase | Implemented in this checkout | Still required for completion |
|---|---|---|
| P6 | ntex/SeaORM backend, checksum migrations, Argon2 bounded hashing, session cookies, org/event permissions, event/FAQ CRUD and publish, invitation/reset tokens, mail outbox; real browser login/settings/category test | Complete security/load/pool exhaustion/shutdown acceptance; configure and test actual mail adapter; full feature UI acceptance |
| P7 | Four ticket stages, multi-member assignment, version conflicts; paired hashed credentials, rotation/revocation; scoped Agent published FAQ/participants/run/result/ticket routes; transactional idempotency | Provider-specific callback authentication and full scope matrix; API/worker operational hardening |
| P7a | Validated row import/commit with lang_code, durable X:Y dispatch, max retry/cooldown, uncertain-call reconciliation, late final result handling, active capacity bound | Actual provider adapter and signed callback mapping; rejection/reconciliation operator workflow; provider acceptance with authorized test number |
| P7b | Pinned Gradle wrapper + Groovy/Spock HTTP acceptance, PostgreSQL Rust integration, real frontend/backend browser test, Jenkins blocking stage and report-before-cleanup ordering; Jenkins #14 passed | Extend suite to every remaining production gate |
| P8 | Backend/DB/worker/mailer compose budgets, non-root runtime Dockerfile, off-host backup script, isolated restore-rehearsal script | Lightsail host/region, secrets and mail/provider choice, off-host restore evidence, production image/load/monitoring/rollback rehearsal, actual cutover |
| P9 | Legacy scheduler/recording code preserved; 31 scheduler + 8 audio repair + 11 callback fixture checks passed | Confirm legacy source/export and owner→org mapping; port recurring-run/recording journeys and test parity; migrate/reconcile data before retiring old paths |

**P6–P9 are not declared complete.** The public website is still the authorized
mock-data demo. No production database migration, real call, real email, AWS resource
creation or legacy data deletion has occurred.

## Validation commands

- Frontend: npm run typecheck/test/build:demo/test:demo --prefix frontend.
- Real UI: set TEST_ADMIN_EMAIL/PASSWORD, API on 18460 with
  PUBLIC_ORIGIN=http://127.0.0.1:18446; npm run test:backend --prefix frontend.
- Backend: TEST_DATABASE_URL pointing at an isolated PostgreSQL instance,
  CARGO_BUILD_JOBS=1 cargo +1.97.0 test --manifest-path backend/Cargo.toml -- --test-threads=1.
- API: set TEST_ADMIN_EMAIL/PASSWORD; tests/api/gradlew -p tests/api test --no-daemon --max-workers=1.
- Legacy fixture tests: scripts/test-scheduler.mjs, test-recording-repair.mjs,
  test-recording-callback.mjs. Do not run run-all-tests.mjs: it can place live calls.
- CI: scripts/ci/backend-container.sh creates named build-owned disposable containers,
  runs Rust, Groovy and real-browser acceptance, and removes only its own test resources.

## Local evidence

- 21 frontend unit checks, 6 demo browser cases and 1 real API/browser flow passed.
- 6 PostgreSQL integration scenarios and 5 Groovy HTTP workflows passed.
- Local dump/restore rehearsal restored 21 synthetic events and 37 completed attempts;
  all 21 restored queue policies were paused. Off-host AWS restore is not yet verified.
- 50 legacy fixture checks passed without live provider calls.

## Jenkins and deployment evidence

- Jenkins event-confirm #14 succeeded for commit `55e2295`: 45 published JUnit
  checks passed, zero failures/skips; PostgreSQL Rust scenarios also passed and
  their log was archived. Build-owned test containers/network were cleaned up.
- CI uses a dedicated configurable `/28` subnet because the shared host's Docker
  default address pools are exhausted; no unrelated networks were removed.
- Public demo smoke and browser checks passed for Settings ratio/retry controls,
  event category tabs and Swagger UI. This deployed the demo frontend, not a
  production backend or enabled calling worker.

## Cutover checklist

1. Obtain target Lightsail host/region and approved secret store.
2. Select actual provider and mail adapters; verify their idempotency/reconciliation
   contracts and callback signatures. Keep CALLING_ENABLED and MAIL_ENABLED false.
3. Provision PostgreSQL, rehearse schema migration and off-host encrypted backup/restore.
   Restored queues must be paused and old unresolved attempts reconciled before dispatch.
4. Freeze legacy dispatch; map owner IDs to org IDs explicitly; validate import counts,
   call/provider IDs and recording ownership. Never infer organizations from email domains.
5. Pass acceptance/load/shutdown gates. Build frontend with default real API mode.
6. Configure project nginx API upstream and verify /event-confirm/ deep links and Swagger.
   Shared edge path ownership stays with the separate edge service.
7. Perform controlled authorized provider acceptance, then enable workers gradually.
8. Keep previous immutable web/API image and backward-compatible DB schema for rollback.
   Rolling back an image is not rolling back a database migration.

## Legacy disposition

Recurring schedules (once/daily/weekly in Asia/Bangkok), explicit per-occurrence redial,
recording playback/download/repair and provider recording association remain required
until the owner explicitly decides otherwise. Existing fixture tests establish a baseline;
they do not prove those journeys have been ported to the Rust backend.
