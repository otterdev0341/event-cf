# Phase 0 contract baseline

Version 0.1.0; proposed HTTP surface for P6+. Phase 1–5 implements a development-only
transport with these request/response shapes. Production never falls back to it.

`schemas/*.json` are generated from the Zod wire DTOs in `frontend/src/shared/contracts`.
Run `node frontend/scripts/contracts.mjs --write` after reviewed changes; without
`--write`, it fails on drift. All source/schema files obey the 300-line gate.

Machine-readable browser API: [OpenAPI 3.1](openapi.json), split path items under `paths/`.
Run `node frontend/scripts/openapi.mjs` to verify path drift.

## HTTP conventions

- Browser base `/event-confirm/api/v1`; session cookie HttpOnly/Secure/SameSite,
  same-origin credentials, Origin/CSRF validation required in P6. Frontend sends
  `X-Requested-With: EventConfirm`; this header alone is not authentication.
- Agent base `/event-confirm/api/agent/v1`; BOTH Authorization Bearer org key and
  X-Event-Credential required, with matching org/event and intersecting scopes.
- JSON errors `{ "message": "...", "code": "..." }`; 401 unauthenticated,
  403 permission/pair mismatch, 404 tenant-scoped missing, 409 version/conflict,
  422 validation, 429 bounded admission, 503 unavailable. No HTML success fallback.
- Collection responses in this frontend slice are arrays. Backend must cap result
  sets and introduce versioned cursor DTOs before serving large datasets (P6/P7).
- PATCH requires `expectedVersion`; stale writes return 409 and reload current data.
- Import commit/run start/result writes use Idempotency-Key. Persist request hash and
  reject same key with different body in P7; never derive a second call from retry.
- `attendance_result` is the domain name; wire DTO uses nested `outcome.result`:
  confirm/decline/unknown, with `outcome.reason` required only for unknown.
  Pending is null; provider ambiguity is processing state, never inferred unknown.

## Browser endpoints

| Method / relative path | Input | Output |
|---|---|---|
| POST /auth/reset/complete | token, password | ok/message; expired token error |
| POST /organizations | name | updated sessionSchema |
| POST /invitations/accept | token | updated sessionSchema |
| PATCH /orgs/{org}/members/{member} | role | ok; owner transfer separate |
| DELETE /orgs/{org}/members/{member} | admin membership | ok; owner protected |
| GET /auth/session | session cookie | sessionSchema |
| POST /auth/login | email, password | sessionSchema |
| POST /auth/logout | — | ok |
| POST /auth/reset | email | ok/message; never disclose account existence |
| GET /orgs/{org}/members | admin membership | memberSchema[] |
| POST /orgs/{org}/members | email, role (admin/editor/viewer) | ok; invitation |
| GET /orgs/{org}/events | membership | eventSchema[] |
| POST /orgs/{org}/events | eventInputSchema | eventSchema |
| GET /orgs/{org}/events/{event} | membership | eventSchema |
| PATCH /orgs/{org}/events/{event} | eventInputSchema or status + expectedVersion | eventSchema |
| GET /orgs/{org}/events/{event}/knowledge | membership | knowledgeSchema |
| POST /orgs/{org}/events/{event}/categories | name | ok |
| POST /orgs/{org}/events/{event}/faqs | faqInputSchema | ok |
| PATCH /orgs/{org}/events/{event}/faqs/{faq} | faqInputSchema + expectedVersion | ok |
| DELETE /orgs/{org}/events/{event}/faqs/{faq} | editor membership | ok; draft only |
| POST /orgs/{org}/events/{event}/publish | editor membership | ok; atomic knowledge snapshot |
| GET /orgs/{org}/events/{event}/participants | membership | participantSchema[] |
| POST /orgs/{org}/events/{event}/imports | rows: importRowSchema[] | importPreviewSchema |
| POST /orgs/{org}/events/{event}/imports/{id}/commit | idempotency key | ok; no calls |
| GET /orgs/{org}/events/{event}/queue-state | membership | queueSchema |
| PATCH /orgs/{org}/events/{event}/queue-policy | ratio + expectedVersion | queueSchema |
| POST /orgs/{org}/events/{event}/runs | action: start/pause/resume/cancel + idempotency | queueSchema |
| GET /orgs/{org}/events/{event}/tickets | membership | ticketSchema[] |
| POST /orgs/{org}/events/{event}/tickets | ticketInputSchema + idempotency | ticketSchema |
| PATCH /orgs/{org}/events/{event}/tickets/{id} | expectedVersion + status/assignee/dueDate/comment | ticketSchema |
| GET /orgs/{org}/credentials | owner/admin | credentialSchema[]; no secrets |
| POST /orgs/{org}/credentials | credentialInputSchema | issuedSchema; show once |
| POST /orgs/{org}/credentials/{id}/rotate | owner/admin | issuedSchema; revoke old & children |
| POST /orgs/{org}/credentials/{id}/revoke | owner/admin | ok; revoke children |
| POST /orgs/{org}/check-pair | orgKeyId,eventKeyId,eventId | ok/message; metadata validation only |

## Agent endpoints (P7, not implemented by frontend preview)

GET /events/{event}/faqs: published snapshot only, knowledge:read.
POST /events/{event}/tickets: tickets:create, event-scoped ticket input + source reference.
POST /events/{event}/call-attempts/{attempt}/results: calls:result, outcome/revision +
ticket intent, idempotency. Provider transport evidence is accepted only through
separately authenticated provider callbacks, never from Agent business result DTO.

## Defaults and decisions

Accepted: ntex/Tokio + SeaORM, two logical queue lanes, X:1 ratio counts accepted
provider dispatch, confirm may coexist with ticket, decline stops automatic retry.
Proposed preview defaults: per-event ratio 2:1; 3 attempts including initial; 15-minute
delay; one phone per event; required last name. These must be reviewed before outbound
P7a/P8, not silently treated as production policy. Event timezone: Asia/Bangkok initially.
No-answer count is per authoritative attempt, not duplicate callback count.

## Migration and repository inventory

Legacy React/Vite/Supabase entry remains at root. New frontend is under `frontend/`;
root build/dev behavior remains available until cutover. Existing scheduler, voice
connection encryption, inbound, recordings, recurring campaigns and SQL history are
preserved. New org/membership/event IDs need explicit mapping from legacy user/campaign
ownership; no automatic ownership merge, password transfer or production migration in P0–5.
GitHub public-fork/private conversion is a separate owner operation: see refactor plan.
No repository visibility, remote, existing data, or live routing changes in this phase.
