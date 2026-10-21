# Event Confirm backend

Rust 1.97.0, ntex 4.3.0/Tokio, SeaORM 1.1.20/PostgreSQL.
Read docs/plans/PHASE_6_9_EXECUTION.md before deployment; this is not a completed cutover.

## Local acceptance

Use a disposable PostgreSQL instance. Set DATABASE_URL, COOKIE_SECURE=false,
PUBLIC_ORIGIN=http://127.0.0.1:18446, and optionally SEED_ADMIN_EMAIL/PASSWORD for a new
test database. The seed never changes an existing password and should be removed after bootstrap.

Run cargo +1.97.0 run --manifest-path backend/Cargo.toml. API listens on 127.0.0.1:18460.
Frontend npm run dev --prefix frontend proxies to this API without mocks.
Backend runs apply checksum-verified additive migrations under a transaction lock.

Set TEST_DATABASE_URL and run cargo test with --test-threads=1 against an isolated DB.
The test fixtures are synthetic; the global one-active-call capacity requires serial scenarios.
Never point this test suite at production.

## Module boundaries

- http/routes: transport, sessions/CSRF and authorization.
- auth: bounded password work, memberships, credential-free token flows and mail outbox.
- events/dto + entity: event input and SeaORM persistence model.
- knowledge: event draft/published aggregate with revision control.
- tickets: independent follow-up workflow.
- credentials: machine identities, hashed secrets, scopes and parent/event bindings.
- calling: row imports, policy, durable reservation, results and provider worker.
- db: parameterized SeaORM queries and transactional migration ledger.

## Adapter contracts

Calling is off by default. Explicit CALLING_ENABLED=true plus PROVIDER_URL/TOKEN
starts the "worker" command. POST /calls receives attempt_id, org_id, event_id,
participant_id, phone and lang_code, and Idempotency-Key=attempt_id. A successful
response must contain provider_id. GET /calls/{attempt_id} must authoritatively
resolve an ambiguous submission without creating a new call. Failed/unknown
responses remain blocked for reconciliation, not automatically redialed.
Results enter the scoped Agent API only after acceptance is journaled. A result
carrying a ticket additionally requires tickets:create on both credentials.

Mail is off by default. The "mailer" command needs MAIL_ENABLED=true and
MAIL_API_URL/TOKEN. POST /messages receives to/message and a stable outbox
Idempotency-Key. The actual mail adapter must deduplicate that key.
Successful delivery clears the sensitive outbox payload; retries are bounded.

These are integration contracts, not claims of Botnoi/SES adapter compatibility.
Do not enable live delivery until provider-specific acceptance passes.

## Known cutover gaps

See execution status for actual provider callbacks, retention, comprehensive security/load
gates, legacy recurring schedules/recordings and migration mapping.
Public integration deployment uses root compose.yaml; check execution status for live revision.
Email provider is intentionally deferred. The simulated provider never places calls.

## Shutdown and capacity acceptance

Worker and mailer handle SIGTERM/SIGINT and finish the current bounded tick before
exiting. No new tick starts after shutdown is observed. Compose allows 45 seconds
before SIGKILL; API keeps its separate 15-second graceful shutdown setting.
`scripts/ci/worker-shutdown.sh` verifies actual process SIGTERM exits against the
disposable test database. Rust tests separately prove an in-flight tick is drained.

Capacity tests occupy all five production-configured DB slots, verify a bounded
503 after acquisition timeout, and verify recovery after release. Hashing overload
returns 429 without queuing unbounded CPU work. These are focused overload tests,
not a benchmark or proof of full production load capacity.

## Integration handoff

See `contracts/README.md` for current headers, routes and scopes. Attempt history now
includes an ID for Agent result submission. DEFAULT_RETRY_DELAY_SECONDS defaults to
900; HTTP CI uses 0 to exercise weighted retries without wall-clock waits. It is an
instance bootstrap setting for newly created events, not a way to restart exhausted calls.

Schedule APIs persist once/daily/weekly rules in Asia/Bangkok. Explicit redial starts
a new attempt budget and preserves old attempt numbers/results. No legacy import is
implicit. Recordings still use the preserved legacy implementation until its adapter
and owner/event mapping are verified; schedule UI is not yet ported.
