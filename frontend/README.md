# Event Confirm workspace

React + TypeScript + Vite + Tailwind + Zustand. UI state in Zustand; server state in
TanStack Query; feature services parse DTOs with Zod. Features expose public index.ts.

```bash
npm ci
npm run dev:mock
```

Open http://127.0.0.1:18446/event-confirm/ . Preview sign-in:
`admin@otterheaven.com` / `passwordpassword` (development-only seeded account). Mock data is memory-only;
reload resets it. No actual email, call or external Agent request is made.
`preview-reset` and `preview-invite` exercise successful token states; other values
exercise expired/invalid states. These strings are omitted from production bundles.

`npm run dev` uses real HTTP endpoints with no fallback. `npm run build` emits a
production build that expects the P6+ API. `vite build --mode mock` is rejected.
Jenkins packages the checked production build into the project nginx image.
Integration deployment proxies API requests to Rust through the project nginx.
Development mock credentials do not authenticate against the real API.

## Checks

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
# From repository root:
node scripts/checks/source-lines.mjs
node scripts/checks/frontend-boundaries.mjs
node frontend/scripts/contracts.mjs
node frontend/scripts/openapi.mjs
node scripts/checks/production-bundle.mjs
```

Playwright uses its installed Chromium; set PLAYWRIGHT_CHROMIUM_EXECUTABLE when using
an existing compatible browser. CI pins a matching Playwright image/package and runs
one browser worker. JUnit reports live in reports/; screenshots/traces in test-results/.
Use `npx playwright install chromium` on a developer machine if no browser is installed.

## Journeys

- Login, request/reset password, token errors, org selection/create/invitation.
- Org members invite/change-role/remove; owner protected from accidental removal.
- Event create/edit/status/archive, search and scoped event routes.
- Categorized FAQ edit/delete draft, atomic publish snapshot and Agent preview.
- CSV/XLSX template download, worker-based upload parsing, all-row preview and explicit
  commit; duplicate phone/event/date/formula/size validation. No upload starts calls.
- New/fail queue UI, start/pause/resume/cancel, X:1 policy, confirm/decline/unknown
  reason/history; dev transport changes run state only, not scheduler behavior.
- Kanban/list, drag or keyboard move, comments/assignee/due-date, optimistic rollback.
- Org/event keys, opt-in scopes, show-once copy, paired validation, rotation/revocation.
- Component gallery at /event-confirm/components in explicit mock mode only.

Canonical routes use /event-confirm/orgs/:orgId/events/:eventId/...; convenience
workspace tabs use /events, /knowledge, /participants, /calling, /tickets, /agent-access.
All canonical routes verify membership/event context before displaying data.

## Current integration status

P6+ Rust backend is implemented and real API browser tests cover settings, categories,
participant CSV preview/commit, tickets and paired credentials. See
`docs/plans/PHASE_6_9_EXECUTION.md` for deployed revision and evidence.

`npm run build:integration` uses the real HTTP service and adds a test-environment notice.
Data persists in PostgreSQL; the configured provider only simulates dispatch acceptance.
Mail delivery is explicitly deferred by the owner. Default `npm run build` remains
mock-free. Demo builds remain available for regression tests, not automatic fallbacks.

## Historical public UI demo

Before backend integration, the owner authorized public mock browsing. `build:demo`
remains an explicit regression/preview mode: its data is browser-local and resets on reload.
The integration deployment now packages `build:integration`, which uses real authentication,
real API calls and persistent PostgreSQL data. The two modes must not be confused.

## Operations UI extension

- Search organizations in the topbar and event names/codes in the sidebar.
- Event Dashboard uses Chart.js (daily/weekly calls, per-member open/closed tickets).
- Settings owns theme selection, organization, team/event grants and Agent access.
- Follow-up supports four columns, drag/drop, table view and multiple active org assignees.
- Knowledge/category master and XLSX templates are event-scoped; imports remain drafts.
- Participant templates require lang_code; Queue settings include maxRetries, excluding the initial call.
- Swagger UI is served at /event-confirm/swagger-ui/ with local OpenAPI JSON. Same-origin API execution is enabled; credentials are not persisted.
- See docs/plans/WORKSPACE_OPERATIONS_UPDATE.md and .json for the remaining backend work.

Libraries follow official integration guides: [Chart.js](https://www.chartjs.org/docs/latest/getting-started/integration)
and [Swagger UI](https://swagger.io/docs/open-source-tools/swagger-ui/usage/installation/).
