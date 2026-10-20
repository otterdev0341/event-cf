# Repository engineering rules

## Scope and source of truth

- Follow `docs/plans/REFACTOR_IMPLEMENTATION_PLAN.md` for the proposed frontend-first
  sequence and `DESIGN.md` for the supplied visual direction.
- Follow `docs/plans/CALLING_IMPORT_CREDENTIAL_PLAN.md` for participant templates,
  durable calling retries and paired org/event credentials.
- Follow `docs/plans/WEIGHTED_QUEUE_GROOVY_TEST_PLAN.md` for new/fail lane scheduling,
  X:1 ratios, final confirmation results and Groovy API acceptance tests.
- A plan is not proof that its features are implemented. Keep current architecture,
  target architecture, preview behavior and production behavior clearly distinguished.
- Preserve unrelated work. Do not remove legacy behavior or migrate data without an
  explicit feature disposition and verified migration path.

- Follow `docs/plans/CALL_OUTCOME_MODEL.md` for the latest attendance result contract:
  confirm / decline / unknown with required reason. This supersedes not_confirmed.
  Tickets are independent of attendance; confirm with an open ticket never implies retry.

## Maximum source-file size

- Every first-party code file must be **300 physical lines or fewer**, including
  comments and blank lines. This includes tests, generated first-party DTO/entity
  code, CSS, SQL migrations, scripts, Dockerfiles and Jenkinsfiles.
- Split by responsibility and domain. Do not minify, pack multiple statements onto
  lines, create arbitrary numbered fragments, or disable formatting to meet the limit.
- Documentation, dependency lockfiles, third-party dependencies and compiled output
  are outside the source-code limit.
- Existing oversized CSS is migration debt recorded in the refactor plan. Do not add
  to it. Any code file edited during implementation must meet the limit.
- Implement a full-tree line-count check in P1 and make it a CI gate. No permanent
  exemptions for first-party source. Rules in this document do not imply a checker
  has already been installed.

## Frontend boundaries

- Target React + TypeScript + Vite + Tailwind CSS + Zustand.
- Pages compose features; reusable UI components are presentational.
- Hooks orchestrate services and state. Services own HTTP calls and boundary parsing.
- Separate wire DTOs, validation schemas and UI models using explicit mappers.
- Keep server data in the query cache and UI/workflow state in focused Zustand stores.
- All tenant query keys include org identity. Cancel stale requests and clear
  tenant-specific selections on organization switch.
- Do not store passwords, provider credentials or session tokens in persisted UI state.
- Feature modules expose small public interfaces; do not deep-import their internals.
- Preserve `/event-confirm/` in assets, navigation, deep links and API requests.
- Mock adapters are for explicit development/test previews or the owner-authorized public
  UI demo (`vite build --mode demo`); never an automatic production fallback.
  The public demo must disclose simulated data, no real calls/email and reload reset.
  Default production builds still exclude mocks and use the real API.

## Backend boundaries

- Target Rust + ntex + SeaORM + PostgreSQL as a modular monolith.
- Follow `docs/plans/IMPLEMENTATION_PHASES.md` for phase gates and async requirements.
- Use the ntex Tokio backend and compatible SeaORM runtime; pin verified versions.
- All I/O paths must be async end-to-end. Never block an executor thread with sync
  network/filesystem calls, thread sleeps, nested block_on, or CPU-heavy parsing/hashing.
- Run CPU-heavy or unavoidable blocking work in a bounded blocking pool, awaited from
  async code. Small pure DTO/domain transformations may stay synchronous.
- Bound task concurrency, connection pools, deadlines and shutdown draining. Never hold
  database transactions over provider HTTP calls or sleeps; persist durable work first.
- Separate transport/DTO, service/domain, repository and persistence responsibilities.
- Do not serialize SeaORM models directly as API responses.
- Every tenant operation requires validated user membership or agent credential scope
  and event grants. Never trust an org ID from the caller without authorization.
- Keep browser session auth separate from machine-to-machine Agent API credentials.
- External event APIs require both org and event credentials with matching parent,
  tenant, event and effective scopes. Keep provider callback authentication separate.
- Import preview/commit must never start calls. Validate event/date and preserve phone
  numbers as strings; commit validated batches idempotently.
- Retry calls only after a confirmed eligible terminal result and policy checks.
  Unknown provider outcomes require reconciliation, never speculative redial.
- Persist call attempts, leases and reservations server-side. Keep transport retry
  separate from a new call attempt and retain attempt history across worker restarts.
- Schedule new/fail lanes with persisted per-org/event X:1 state and atomic pending turns.
  Count provider-accepted dispatch once; technical retries never consume another turn.
- Keep answered transport separate from final confirmation. Eligible terminal business-unknown calls
  can enter the fail lane; missing results require reconciliation rather than guessed retry.
- Preserve request reservation, idempotency, optimistic concurrency and transaction
  boundaries when changing related behavior.
- Test tenant isolation against real PostgreSQL, including concurrent operations.

## Validation and deployment

- Use focused behavior tests, format/lint, type checks, contract checks and the line
  gate. Publish diagnostics before cleanup.
- Write HTTP API acceptance tests in Groovy/Spock, invoked by Jenkins through a pinned
  Gradle Wrapper; keep assertions out of Jenkinsfile and publish JUnit XML before cleanup.
- Groovy tests/helpers/build scripts also obey the 300-line source-file limit.
- Preserve shared-builder governance, project resource limits and rollback images.
- Never add global Docker prune, volume deletion or shared-cache deletion to this job.
- Keep cross-project public routes in the separate shared-edge service.
- Repository privacy and website access are separate controls. Do not claim privacy
  from `package.json: private=true` or from source-code changes.
- Do not detach/delete a fork or replace its remote as a side effect of routine coding.

## Operations UI contracts (2026-10-21 update)

- Follow docs/plans/WORKSPACE_OPERATIONS_UPDATE.md and its JSON plan for the expanded P2–P5 UI.
- Roles are root, org_admin, event_admin and team_member; Root is a platform privilege, never org-grantable.
- Knowledge/category master/templates are event-scoped. Validate latest category revision on import.
- Tickets have four stages and multiple active org-member assignee IDs; assignments do not grant event privileges.
- maxRetries excludes the initial call; maxAttempts = maxRetries + 1. Never restart exhausted records implicitly.
- Participant import requires lang_code; snapshot language into future Agent dispatches.
- Swagger documents the implementation contract, not evidence of a deployed backend.
