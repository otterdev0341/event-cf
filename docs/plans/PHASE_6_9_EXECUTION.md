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
| P6 | ntex/SeaORM backend, checksum migrations, Argon2 bounded hashing, session cookies, org/event permissions, event/FAQ CRUD and publish, invitation/reset tokens, mail outbox; real browser login/settings/category test | Focused pool/shutdown/security tests passed; sustained-load and full feature UI acceptance remain. Email provider deferred by owner |
| P7 | Four ticket stages, multi-member assignment, version conflicts; paired hashed credentials, rotation/revocation; scoped Agent event/categories/published FAQ/participants/queue/result/ticket routes; transactional idempotency | Provider-specific callback authentication and full scope matrix; API/worker operational hardening |
| P7a | Validated row import/commit with lang_code, durable X:Y dispatch, max retry/cooldown, uncertain-call reconciliation, late final result handling, active capacity bound | Actual provider adapter and signed callback mapping; rejection/reconciliation operator workflow; provider acceptance with authorized test number |
| P7b | Pinned Gradle wrapper + Groovy/Spock HTTP acceptance, PostgreSQL Rust integration, real frontend/backend browser test, Jenkins blocking stage and report-before-cleanup ordering; expanded local HTTP/browser acceptance passed; Jenkins #15 in progress | Extend suite to every remaining production gate |
| P8 | Persistent integration compose/API/nginx, simulated provider, runtime secrets provisioned, non-root images, resource budgets, rollback tags; Jenkins deployment in progress | Public acceptance evidence; real-provider/production load, off-host restore, monitoring and rollback rehearsal remain separate |
| P9 | Rust schedule backend ported with Bangkok time/explicit redial/history tests; legacy scheduler/recording code preserved; 50 legacy fixture checks passed | Schedule UI, recording adapter/parity, legacy source/export and owner→org/event mapping; migration before retiring old paths |

**P6–P9 production gates are not declared complete.** Integration deployment is in
progress on the existing Otter host, with simulated calling and email delivery disabled.
No real call, real email, AWS resource creation or legacy data deletion has occurred.

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

## Historical local evidence before this iteration

- 21 frontend unit checks, 6 demo browser cases and 1 real API/browser flow passed.
- 6 PostgreSQL integration scenarios and 5 Groovy HTTP workflows passed.
- Local dump/restore rehearsal restored 21 synthetic events and 37 completed attempts;
  all 21 restored queue policies were paused. Off-host AWS restore is not yet verified.
- 50 legacy fixture checks passed without live provider calls.

## Historical Jenkins #14 deployment evidence

- Jenkins event-confirm #14 succeeded for commit `55e2295`: 45 published JUnit
  checks passed, zero failures/skips; PostgreSQL Rust scenarios also passed and
  their log was archived. Build-owned test containers/network were cleaned up.
- CI uses a dedicated configurable `/28` subnet because the shared host's Docker
  default address pools are exhausted; no unrelated networks were removed.
- Public demo smoke and browser checks passed for Settings ratio/retry controls,
  event category tabs and Swagger UI. This deployed the demo frontend, not a
  production backend or enabled calling worker.

## Remaining production cutover checklist

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

## Earlier hardening acceptance (2026-10-21)

- Rust suite now passes 12 scenarios locally, including role/event authorization,
  membership removal, five-slot pool exhaustion/recovery, bounded hashing,
  mail transport replay with stable identity, and in-flight shutdown draining.
- Actual worker and mailer processes exit successfully on SIGTERM. Docker gives
  them 45 seconds to drain; they stop claiming new work after shutdown is observed.
- Groovy suite now passes 8 HTTP scenarios locally, including CSRF/origin rejection,
  anonymous access denial, cookie flags/path, and captured-session replay after logout.
- HTTP acceptance explicitly uses HTTP/1.1, matching the intended nginx upstream.
  A raw Java h2c-upgrade request timed out against the direct API; h2c is not a
  validated upstream protocol and must not be enabled for cutover without resolution.
- Agent result replay rechecks ticket creation scope when the payload contains a
  ticket. Agent transactions now have the same bounded lock wait as browser writes.
- Full sustained-load acceptance, real provider/mail integration, full UI acceptance,
  production cutover and legacy migration remain open. These focused tests do not
  declare P6–P9 complete.

## Current owner-directed integration delivery (2026-10-21)

- Owner authorized continuing P2–P5/P7/P7a/P7b/P8/P9 and updating P0–P1 documents.
  Email provider is explicitly deferred; do not treat it as an integration deployment blocker.
- Root compose now describes a persistent real-API integration workspace with project
  PostgreSQL, Rust API/worker and a durable simulated provider journal. No mailer is started.
  This is separate from a production Lightsail/provider cutover.
- Agent Access examples now match runtime headers/routes; Swagger executes same-origin
  requests without saving credentials. Agent event/categories/queue-state reads and attempt
  IDs are available. Full history pagination/search remains outstanding.
- Browser acceptance expanded to CSV import without dispatch, ticket persistence/stages/
  comments and issuing/revoking a real credential pair.
- Groovy adds worker→provider acceptance→Agent confirmation/ticket/replay and weighted
  2:1/5:1 HTTP flows, using zero cooldown only in the isolated CI environment.
- P9 scheduler backend now supports once/daily/weekly Bangkok rules, selected participants,
  explicit redial, durable occurrence identity, cancellation, permission/version checks and
  retained attempt history. New scheduler UI and recording adapter remain outstanding.
- Legacy source/export and owner→org/event mapping are still required before data migration.
  Existing legacy files are retained. No existing production records are modified.

### Regression evidence during implementation

- A repeated scheduler tick before dispatch exposed an incorrect event-ID parameter in the
  selected-participant query. Corrected to schedule ID; the regression now proves a round
  remains running before acceptance and only selected participants dispatch.
- Weighted dispatch now snapshots the selected lane in the attempt. An empty fail lane
  leaves its pending turn saturated instead of wrapping after more new calls. Acceptance
  replay finalizes the turn once; the database test exercises late fail eligibility.
- Initial browser/Groovy failures were test harness issues (ambiguous parent-label selector
  and assignments inside Spock polling); fixed before evaluating product behavior.

Deployment revision, final suite totals and public smoke evidence will be recorded after CI.

- FIFO regression added: tied import timestamps previously fell back to UUID sorting.
  Migration 005 adds a durable enqueue sequence, used by dispatch and participant listing.
  The test forces opposite ID order and verifies original row order through completed attempts.
- Owner authorized removal of Tandem Docker resources to unblock shared disk guard.
  Removed six stopped Tandem containers and three Tandem images; retained named volumes.
  Root free space rose from approximately 45 to 55 GiB before Jenkins #15 started.
