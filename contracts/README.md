# Event Confirm implementation contract

Updated 2026-10-21. Use [OpenAPI 3.1](openapi.json) and backend routes as the
implementation contract. Earlier design documents describe targets, not deployed APIs.

Browser and Agent APIs both use `/event-confirm/api/v1`.
The browser uses the `event_confirm_session` cookie, scoped to `/event-confirm/`,
HttpOnly/SameSite and Secure on HTTPS. Writes require `X-Requested-With: EventConfirm`;
when supplied, Origin must match PUBLIC_ORIGIN. That header is not authentication.

Agent base: `/event-confirm/api/v1/agent/orgs/{org}/events/{event}`.
Both `X-Org-Credential` and `X-Event-Credential` are mandatory; parent, org, event,
expiry, revocation and scope intersection are checked on each request, including replays.
`Authorization: Bearer` and `/api/agent/v1` in the original proposal are obsolete.

| Agent operation | Scope | Response |
|---|---|---|
| GET /event | events:read | Event DTO |
| GET /knowledge | knowledge:read | Published FAQ array; draft excluded |
| GET /categories | knowledge:read | Sorted categories present in published FAQ |
| GET /participants | calls:read | Participants with attempt IDs and history |
| GET /runs | calls:read | Current event queue state (not historical run list) |
| POST /runs | calls:create | action=start/pause/resume/cancel |
| POST /tickets | tickets:create | Created ticket |
| POST /calls/{attempt}/result | calls:result | `{ "ok": true }` |

All Agent POSTs require `Idempotency-Key`. Browser import commit, run start/actions,
ticket creation, knowledge import and schedule creation also require it. Retry the same
payload with the same key; different payload returns 409. PATCH uses expectedVersion
(or expectedRevision for category master). Idempotency does not grant authorization.

Result input is `{ "result": "confirm", "reason": null }`, optionally with `ticket`.
`decline` also uses null reason; `unknown` requires no_answer/noisy_audio/ai_cannot_infer.
A ticket additionally requires tickets:create on BOTH credentials. Confirm plus ticket
never requests retry. A new result requires an accepted attempt; obtain its ID from
worker dispatch or GET participants, never invent an ID. Old-occurrence results cannot
change attendance after explicit scheduled redial starts a new occurrence.

Collections currently return arrays; pagination/search is not implemented. GET runs
is queue state, not the historical run/attempt cursor API proposed in the original plan.
Errors return `{ "message": "..." }` with 401/403/404/409/422/429/503 as appropriate.

Browser features: auth/session/logout/reset, organizations/members/invitations,
events, categories, FAQs/publish, knowledge import, participant row import/commit,
queue settings/runs, tickets, credentials and schedules. Consult OpenAPI for exact
request schemas. CSV/XLSX is parsed by the frontend worker; backend imports accept
validated JSON rows and independently validate them. Upload/commit never starts calls.

Schedules are browser-authenticated event operations under `/orgs/{org}/events/{event}/schedules`.
They require explicit participant IDs, consent, event version and redial choice. Time is
Asia/Bangkok; weekdays use Sunday=0. Recurrence is once/daily/weekly. Cancellation is
versioned. Scheduler rechecks owner permissions and event version; stale configurations
stop. Explicit redial starts a fresh attempt budget while retaining old attempts.
These endpoints do not migrate legacy data and have no new schedule UI yet.

`schemas/*.json` derive from frontend Zod DTOs. Run `node frontend/scripts/contracts.mjs`
and `node frontend/scripts/openapi.mjs` to check drift; `--write` regenerates artifacts.
These checks detect generator/artifact drift, not proof that every live handler matches.
Groovy HTTP acceptance and browser integration tests supply behavioral evidence.

Deployment target in this iteration: persistent integration workspace, simulated provider,
no real telephone calls and no email provider. Production provider callbacks, pagination,
recording adapter and legacy migration are separate remaining work. See the execution plan.

## Recording provider adapter (P9 integration)

The application accepts a server-configured `RECORDING_PROVIDER_URL` and uses
`PROVIDER_TOKEN` only for outbound provider authentication. If either is absent,
recording state is not_available. The integration compose explicitly selects the
simulated provider. No browser/Agent caller can provide an upstream URL.

The adapter performs `GET {base}/recordings/{attemptId}` with `Authorization: Bearer`.
An unavailable exact association returns 404; a successful response must be bounded
JSON with these fields:

```json
{
  "attempt_id": "application-attempt-id",
  "provider_id": "provider-call-id-persisted-on-this-attempt",
  "recording_id": "exact-provider-recording-identity",
  "content_type": "audio/wav",
  "simulated": false
}
```

Audio is `GET {base}/recordings/{attemptId}/audio`, with the same authorization.
It must return 200 and matching `X-Attempt-Id`, `X-Provider-Id`, `X-Recording-Id` and
`Content-Type` headers. Supported MIME types: audio/wav, audio/mpeg, audio/ogg,
audio/webm, audio/mp4. Audio is limited to 8 MiB; metadata to 16 KiB. No redirects
are followed, requests have a total 15-second deadline and two concurrent read slots.
Browser playback uses an authorized same-origin URL and never receives the provider token.

This is an internal adapter contract, **not the legacy Voice Bot provider contract**.
A real provider bridge must validate the original provider account, agent and exact
call/recording association before implementing these endpoints. Existing legacy
recording callback/manual-repair code remains in place; its migration and signature
mapping require verified provider details. Refresh rereads exact association; it
never guesses an audio file from a timestamp or modifies call attendance.
