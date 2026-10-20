# Event Confirm workspace — Phase 0–5

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
Public routes serve the frontend; API requests return JSON 503 until the P6+ backend
is deployed. Development credentials do not authenticate against that public API.

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

## Remaining production dependencies

P6–P8 supply real auth/session/CSRF, persistence, SMTP, credential hashing, async
worker/provider callbacks, backend import validation, rate limits, pagination and
Groovy API acceptance tests. Frontend permissions/validation are UX, not backend
security. Preview defaults (2:1, 3 attempts, 15 minutes) need product confirmation
before real outbound dispatch. See docs/plans/IMPLEMENTATION_PHASES.md.
