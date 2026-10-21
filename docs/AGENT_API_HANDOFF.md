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

Real provider authentication/callback mapping, recording adapter and legacy data migration
are not enabled. Schedule backend is available through the browser API/Swagger, but its
frontend UI has not yet been ported. Historical run pagination and FAQ search are not exposed.
Production load, off-host restore and real provider acceptance remain separate release gates.
