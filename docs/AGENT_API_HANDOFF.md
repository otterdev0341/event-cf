# AI Agent integration handoff

Target: `https://otterdev.xyz/event-confirm/`.
Check [execution status](plans/PHASE_6_9_EXECUTION.md) for the deployed commit and smoke result.
This environment persists data in PostgreSQL. Telephone dispatch is simulated; no email
provider is connected. It is not a production calling deployment.

Swagger: `/event-confirm/swagger-ui/`; bundled OpenAPI: `/event-confirm/swagger-ui/openapi.json`.
Current source contract: [contracts/README.md](../contracts/README.md).

## Credentials and context

Obtain org ID, event ID, org credential and event credential from the owner. Secrets are
issued once and delivered separately, never committed in this repository. Browser login
uses a session cookie; an Agent uses both credential headers, without a browser session.

```bash
export BASE=https://otterdev.xyz/event-confirm/api/v1
# Set ORG, EVENT, ORG_KEY and EVENT_KEY from the private handoff.
curl --fail-with-body "$BASE/agent/orgs/$ORG/events/$EVENT/knowledge" \
  -H "X-Org-Credential: $ORG_KEY" -H "X-Event-Credential: $EVENT_KEY"
```

Scopes: events:read, knowledge:read, calls:read, calls:create, calls:result, tickets:create.
Only grant those needed for the test. Both keys must include the scope. Child scope/expiry
cannot exceed the parent. Rotating/revoking a parent invalidates its children.

## End-to-end test

1. In the real frontend, create an event, add a category/FAQ and publish knowledge.
2. Import CSV/XLSX with phone as a string and required lang_code. Preview and commit do
   not start calls. Event code/date must match. The API receives JSON rows, not file bytes.
3. Issue a matching credential pair in Settings → Agent access. GET knowledge returns
   published FAQ only; GET categories returns categories represented in that snapshot.
4. GET participants must show no attempt before start. POST `/runs` with
   `{ "action": "start" }` and a fresh Idempotency-Key starts the queue. For a paused queue,
   use resume. GET `/runs` returns current queue state, not historical run IDs.
5. Poll GET participants until an attempt has `transport: "accepted"`. Read its `id`.
   The fake provider never calls the phone number. Global active capacity is one; another
   attempt cannot dispatch until the accepted attempt receives a final result.
6. POST `/calls/{attempt}/result` with a fresh Idempotency-Key:

```json
{
  "result": "confirm",
  "reason": null,
  "ticket": {
    "title": "Need transport information",
    "description": "Question requiring a human answer",
    "type": "unanswered",
    "assigneeIds": [],
    "dueDate": ""
  }
}
```

7. Repeat the same request/key. Expect one final result and one ticket. A changed payload
   with the same key returns 409. Confirm plus an open ticket must not schedule a retry.
8. Reload the frontend: participant is confirmed, ticket is visible and saved. Pause the
   queue when finishing a test. Complete any accepted synthetic attempt before leaving.

For unknown, use reason no_answer/noisy_audio/ai_cannot_infer. Unknown can retry after
cooldown up to maxRetries (excluding the initial attempt). Runtime defaults to 15 minutes;
CI alone uses zero delay. Decline stops retries. Missing result/uncertain dispatch does not
mean unknown: reconciliation is required and speculative redial is forbidden.

## Negative acceptance

- Missing either credential: 401; mismatched org/event/parent, expired/revoked key or
  insufficient scope: 403. Confirm with ticket also requires tickets:create.
- POST without Idempotency-Key: 422. Unknown without a supported reason: 422.
- Unknown/nonaccepted attempt: 404/409. Stale version or changed idempotent payload: 409.
- Validate org/event isolation with a second event/pair. Never rely on a frontend permission
  state as authorization evidence.

## Remaining scope

Real provider authentication/callback mapping and legacy data migration are not enabled.
Jenkins #18 deployed Schedules UI and a recording adapter verified publicly against
synthetic audio. Legacy provider recording
bridge and manual repair parity remain pending. Historical run pagination and FAQ search are not exposed.
Production load, off-host restore and real provider acceptance remain separate release gates.

## Provisioned team test workspace

Provisioned in Jenkins #17; reverified with Schedules and recording on Jenkins #18 (`e387b49`).
Org: `33429690-7f4d-47f1-b10a-0bb7dfe37bb5`.
Event: `c20c2048-0b86-471d-9d3f-13b8b00e6e5d`.
The queue is paused, with one completed smoke participant and one ready synthetic
participant. Use action `resume`, poll for an accepted attempt, submit its final result,
then pause. The private credential pair expires on 2027-01-31; it is not in Git.
Use an explicit application User-Agent for scripted requests through the public edge.

## Recording reads (P9 continuation)

With the same paired headers and calls:read scope, GET
`/agent/orgs/{org}/events/{event}/calls/{attempt}/recording` returns pending,
not_available, or available with playbackPath and simulated. Finalize the accepted
attempt before checking audio. Repeat GET to refresh the exact provider association.
GET the returned same-origin playbackPath using both headers to download audio bytes.
Browser users can open Call queues → participant history → ตรวจไฟล์เสียง.
Integration WAV is one second of silence and is explicitly labeled synthetic.
No Idempotency-Key is required for these GET requests. Missing keys return 401,
invalid scope/pair returns 403, unavailable audio returns 404; provider identity errors
return 502. Audio is bounded to 8 MiB, two concurrent requests and 15 seconds total.

Schedules UI: `/event-confirm/orgs/33429690-7f4d-47f1-b10a-0bb7dfe37bb5/events/c20c2048-0b86-471d-9d3f-13b8b00e6e5d/schedules`.
Public P9 acceptance left one cancelled future schedule; queue remains paused and
team credentials are unchanged. Provider bridge details: [adapter contract](../contracts/README.md#recording-provider-adapter-p9-integration).
