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
Results enter the scoped Agent API only after acceptance is journaled.

Mail is off by default. The "mailer" command needs MAIL_ENABLED=true and
MAIL_API_URL/TOKEN. POST /messages receives to/message and a stable outbox
Idempotency-Key. The actual mail adapter must deduplicate that key.
Successful delivery clears the sensitive outbox payload; retries are bounded.

These are integration contracts, not claims of Botnoi/SES adapter compatibility.
Do not enable live delivery until provider-specific acceptance passes.

## Known cutover gaps

See execution status for actual provider callbacks, retention, comprehensive security/load
gates, legacy recurring schedules/recordings and migration mapping.
The public frontend deployment remains demo mode independently of backend CI success.
