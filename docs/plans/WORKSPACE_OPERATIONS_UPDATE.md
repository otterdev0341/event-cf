# Workspace operations update — 2026-10-21

This update supersedes the original P2–P5 role names, ticket assignment, three-column
board and queue-policy UI. These features are browser-local public UI demo behavior;
P6+ persistence, auth, worker and Agent integrations remain unimplemented.

## Navigation and Settings

- Topbar: searchable organization combobox, keyboard arrows/Enter/Escape and empty results.
- Sidebar: searchable event list restricted to selected org, matching name and code;
  selecting an event navigates to its canonical event URL and dashboard.
- Event workspace: Dashboard, Knowledge & FAQ, Participants, Call queues, Follow-up.
- Organization management and Agent access move into Settings; no separate organization
  or Agent-access item in the main navbar. Settings includes team management and
  Light/Dark/System theme, saved locally without storing credentials.
- Org switches cancel tenant requests, clear tenant cache and event selection.
- Knowledge, category master, templates and FAQ imports belong to ONE event, never global.

## Role policy

| Role | Scope | Allowed |
|---|---|---|
| Root | Platform, separately provisioned | Cross-org administration with audit; never granted by org invite/edit |
| Org admin | One organization | Members, roles/event grants, all events, org/event agent credentials |
| Event admin | Explicit event grants in org | Event/FAQ/participant/import/calling/follow-up edits for granted events |
| Team member | Org membership + explicit event grants | Read organization events; create/assign/move/comment follow-up for granted events |

The UI demo uses an Org admin in Otter Studio and a Team member in Community Lab.
Root is represented in the policy, not a public root login. No org admin may grant Root.
Protect the last active org admin and prevent self-demotion/removal in this UI. New
members remain invited until accepted. Backend must independently enforce all policies,
revocation, tenant membership and event ownership on every route. P6 requires negative
policy tests, real PostgreSQL and auditable privileged operations.

## Follow-up

- Four stages: New (`open`), In progress (`in_progress`), Waiting (`waiting`), Done (`resolved`).
- Board drag/drop plus accessible stage selector; real table view uses the same data.
- Multiple assignees by membership IDs (`assigneeIds`); only active members of the same org.
- Invitations are not valid assignees. Reject duplicates and cross-org member IDs.
- Remove membership assignments on member removal; bump affected ticket versions.
- Preserve optimistic move rollback, expectedVersion conflicts, comments and due dates.
- Attendance result remains independent: confirmed attendance may have open tickets.
- Backend migration: ticket_assignees join table with unique ticket/member constraint,
  composite tenant constraints, transactionally checked membership and audit history.

## Event dashboard

Use Chart.js with accessible data-table alternatives, real zero/empty/error states,
and event-scoped source data. Public demo aggregates its in-memory data only.

- Calls chart: last 7 calendar days or 8 calendar weeks (Monday start), Asia/Bangkok.
  Count outbound attempts once, including redials; exclude technical HTTP retries.
- KPI: attempts made, open tickets, actionable people remaining, confirmed attendees.
- Per-member chart: open vs closed ticket assignments. A multi-assigned ticket counts
  for each assignee; totals must not be presented as unique ticket totals.
- Show unassigned open tickets, NEW/retry waiting, in-flight and retry-exhausted counts.
- Recently updated FAQ: question, category and updatedAt, with event-scoped link.
- P6/P7: implement authorized aggregate endpoint, date-range/period/timezone params,
  indexed attempt timestamps, stable updatedAt and SQL aggregates (not client pagination totals).

## Calling policy and graphic queue

- Compact colored tiles show NEW, retry and completed people; click opens attempt history.
- Dispatch strip illustrates X:1 when both lanes are eligible; it is not a guaranteed
  chronological list and must not pretend to be actual worker execution.
- Policy includes ratio and `maxRetries` (0–10). **Total maxAttempts = maxRetries + 1**.
  Example: maxRetries=2 means one initial call and at most two redials.
- Change only when paused/idle with no pending turn; keep optimistic version check.
- On no-answer exhaustion, stop further calls, retain unknown/no_answer + noAnswerCount
  and history. Never erase the participant or change attendance to decline.
- Demo policy changes mark exhausted eligible retry rows stopped; they never dial.
- Raising limits does not automatically restart exhausted rows. Future explicit requeue
  needs authorization, audit and policy checks.
- P7a worker must enforce the cap at atomic claim AND dispatch/reconciliation, including
  restart/concurrent callbacks. Confirm/decline never auto-retry; unknown transport
  needs reconciliation rather than speculative redial. Lowered policy must not cancel
  in-flight calls or synthesize outcomes. Other unknown reasons consume the same attempt cap.

## Participant language

CSV/XLSX columns: phone, first_name, last_name, nickname, event_code, event_date, **lang_code**.
The new column is required; template defaults to `th`. Preview and participant/call UI show it.
Demo-supported codes: th, en, ja, zh, ko, vi, id, ms, fr, de, es, ar. Unknown/blank codes
are rejected; do not silently guess language from names or telephone prefixes.

P6 migration backfills existing participants to an explicitly chosen event default
and stores language per participant. P7a snapshots `lang_code` into every outbound
attempt and provider/Agent payload, preserving it across retries. Provider adapter
must verify its own supported languages before scheduling; demo code support does
not imply a configured voice provider supports those languages.

## Event Knowledge/category templates

- Tabs: Draft workspace, Agent published preview, หมวดหมู่, Template / Import.
- หมวดหมู่ tab owns category table, search, create/rename/delete. Names are unique
  ignoring case. Delete fails while referenced by draft/published FAQ.
- Renaming updates draft FAQ and updatedAt/version; published snapshot is immutable
  until explicit Publish. Category master has a monotonically increasing revision.
- XLSX: FAQ(event_code/category/question/answer), Categories(current names),
  Event(event_code/category_revision). Fetch latest master before download.
- Upload in bounded Web Worker: 5 MiB compressed / 25 MiB expanded / 1,000 FAQ;
  reject formulas, object cells, macros/external links and malformed headers.
- Preview must match event code, current master revision and category names; reject
  duplicate questions within the file or existing draft. No automatic new categories.
- Explicit atomic draft import, with idempotency key and server-side revalidation of
  revision/membership/event/category. Import never publishes or starts calling.
- P6: stable category UUIDs, event FK, unique normalized name, revision concurrency,
  migration from prototype string references and transactional import. Template metadata
  is validation input, never authorization. Validate all uploads again server-side.

## Swagger and machine-readable contracts

- Swagger UI: `/event-confirm/swagger-ui` redirects to `/event-confirm/swagger-ui/`.
- OpenAPI JSON: `/event-confirm/swagger-ui/openapi.json` (OpenAPI 3.1).
- Local pinned swagger-ui-dist assets, no runtime CDN dependency; external validator off.
- Browser/session API schemas live in contracts/schemas and contracts/paths, generated
  from Zod/contracts script. Missing documentation assets return 404, never SPA HTML.
- Documentation explicitly identifies the backend as pending; Try it out is disabled
  during public mock deployment. This is documentation, not a functioning API server.
- P6/P7: generate/verify routes against ntex handlers, add Agent dual-credential and
  provider callback contracts, enable authorized execution only on implemented endpoints.
- Machine-readable implementation plan: WORKSPACE_OPERATIONS_UPDATE.json.

## Phase implementation gates

1. P2–P5 extension (current): UI, demo policy/contracts, Chart.js, mock CRUD/import,
   searchable selectors, themes, Swagger static serving and regression tests.
2. P6: real session/RBAC, membership/event grants, event categories/FAQ import, language
   persistence, dashboard aggregates, Swagger/ntex parity; Groovy suite starts here.
3. P7: ticket assignment join table, four stages and version conflicts, secure Agent keys.
4. P7a: durable weighted worker, retry caps and language snapshots, provider/reconciliation.
5. P7b: complete Groovy/Spock API acceptance and CI gates.
6. P8: production cutover, no mock adapter, backups/restore/resource evidence.
7. P9: legacy parity/disposition as previously planned.
