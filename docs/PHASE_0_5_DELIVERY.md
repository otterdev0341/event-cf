# Phase 0–5 delivery

Branch: `refactor/phase-0-5`. Scope: dependency/runtime proof + working development
frontend; not a production backend or cutover. The existing readiness deployment,
GitHub visibility and remote remain unchanged.

## Delivered by phase

| Phase | Implementation | Verification |
|---|---|---|
| P0 | Versioned JSON Schema/OpenAPI 3.1, tenant/role/outcome contracts, legacy/private-repo inventory, pinned ntex runtime spike | Rust 1.97 + ntex 4.3.0/Tokio + SeaORM 1.1.20 real PostgreSQL + delayed fake HTTP concurrently passed |
| P1 | Separate frontend/, Vite base path, Tailwind design tokens, reusable controls/dialog/gallery, HTTP/DTO/service/query layers, Zustand UI store, routing/error boundaries | Typecheck/build, formatting, feature boundary and full-tree <=300-line gates; no mock fixture in production bundle |
| P2 | Email/password preview, request/reset password and invalid tokens, organizations create/select/invite, members roles/invite/remove, read-only viewer | Browser auth/org/token/deep-link/permission tests; org switch cancels old requests and clears tenant query cache |
| P3 | Event create/edit/publish/archive, date/location/description, filters, category/FAQ draft editor/delete and published Agent preview | Draft remains invisible until explicit publish; canonical org/event route validation |
| P3a | CSV/XLSX templates, bounded worker parsing, preview/errors/atomic commit UX, participants pagination; new/fail queues, 2:1/5:1/custom ratio, run controls/history | Duplicate/event/date/formula/text-phone tests; import never starts calling; start/pause/policy browser journey |
| P4 | Kanban/list, filters, drag + keyboard move, assignment/due-date/comments/activity, optimistic rollback/409 handling | Create/move/comment browser test and stale-version rollback test |
| P5 | Org/event keys, opt-in scopes/expiry/parent, show once/copy, pair validation, rotate/revoke cascade, Agent request examples | Pair success/mismatch and cascading revoke; no secret retained in query cache or localStorage |

Preview uses fictional identities and memory-only state. No real calls, SMTP or
external Agent integrations occur. Real implementation of queue dispatch counters,
leases, retry timing, provider callbacks and durable idempotency remains P7a.

## Run and review

```bash
npm ci --prefix frontend
npm run dev:mock --prefix frontend
```

Open `http://127.0.0.1:18446/event-confirm/`.
Sign in with `admin@otterheaven.com` / `passwordpassword` (development fixtures only).

- [Frontend setup and journeys](../frontend/README.md)
- [OpenAPI entry](../contracts/openapi.json) and [contract decisions](../contracts/README.md)
- [Runtime spike](../spikes/ntex-runtime/README.md)
- [Phase sequence and remaining gates](plans/IMPLEMENTATION_PHASES.md)

`npm run dev --prefix frontend` uses the real API without any fallback.
`npm run build --prefix frontend` excludes fixtures; `build --mode mock` is rejected.
Canonical org/event URLs are supported alongside convenient workspace tab URLs.

## Validation evidence

- 12 unit/contract tests: outcome reason validation, import identity/date/duplicates,
  CSV/XLSX file constraints and formula rejection, tenant authorization, FAQ snapshot,
  import commit idempotency, stale ticket writes and cancellation.
- 12 Playwright journeys: events/knowledge, imports/queue policy, Kanban, credential
  pairs, reset/invite, invalid import, conflict rollback, keyboard dialog/discard,
  direct routes, organization creation/invitation and mobile layout.
- Frontend TypeScript check, production build and mock-exclusion check passed.
- Original root application production build passed after CSS extraction.
- Legacy CSS extraction preserved parsed rule/declaration order; files now split by
  component/responsive scope. Supabase config values were preserved while removing
  template comments to satisfy the full-tree line limit.
- Source-line and feature-boundary checks pass. Dependency install audit reported
  zero vulnerabilities after upgrading Vitest and overriding the affected uuid dependency.
- Jenkins Declarative validator passed. Pipeline changes are in source only; no live
  Jenkins build/deployment was triggered for this branch.
- Cleanup fixtures passed for disposable nested outputs, tracked dependencies, symlink
  escape, runtime mount and another project's files. No host-wide cleanup executed.

## CI ownership and limits

Frontend runner: matching Playwright package/image 1.64.1, one browser worker,
1 CPU, 1536 MiB memory/swap, 256 PIDs, Node heap 768 MiB; shares the existing host
build lock. It mounts only this job's workspace, not Jenkins home or Docker socket.
Registry manifest confirmed amd64/arm64 image availability.

JUnit XML in frontend/reports/ is published before cleanup; browser diagnostics in
frontend/test-results/ are archived. Failure/missing reports block later pipeline
stages; abort preserves aborted state. Cleanup adds only exact frontend generated
paths and preserves live mounts, tracked files, deployed/rollback images and volumes.
The runner container has not yet been exercised by a live Jenkins job; local checks
and Declarative validation are evidence, not a claim of deployed CI success.

## Explicit next-phase requirements

- P6: real ntex HTTP handlers, auth/password/session/CSRF, email delivery, memberships,
  PostgreSQL schema/migrations and backend tenant isolation; test async responsiveness.
- P7/P7a: real credentials, Agent APIs, durable imports/calling, provider verification,
  atomic weighted scheduler, cooldown/calling windows and callback/reconciliation logic.
- P7b: Groovy/Spock HTTP acceptance suite against the real backend and provider stub.
- P8: migration/restore/rollback rehearsal, production resource evidence and cutover.
- Preview defaults still require approval before calls: event-scoped ratio 2:1,
  3 attempts including first, 15-minute retry delay, one phone per event and required surname.
- Backend pagination must replace bounded preview array collections before large-scale
  use. XLSX library is lazy-loaded and parsing uses a cancellable Web Worker; the
  production bundler reports a large XLSX chunk, which is not part of initial import.
- License/fork-detachment/private visibility decisions remain separate owner actions.
