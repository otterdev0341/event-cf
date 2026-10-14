# Inbound workspace

`/inbound` reads the connected Voice Bot account's existing DID numbers and inbound readiness, lets the connection owner bind an owned Agent to an owned DID, and shows the latest 50 actual inbound Call rows.

## Server boundaries

- `GET /workspace/inbound`: `/me` ownership check, then the provisioning overview with `include=tenant,trunk_status`; returns a restricted projection without trunk credentials.
- `POST /workspace/inbound/bind`: confirmed account + DID + Agent + binding revision. Rechecks the current account, DID membership and Agent membership before `PUT .../dids/{did}`. Reads the binding back before reporting success. An uncertain write requires a refresh before another attempt.
- `GET /workspace/inbound/history`: `/calls?direction=inbound&limit=50`, projected from the published CallRow schema. This is a bounded recent list, not a total. The statistics link selects inbound and retains the existing fully paginated aggregation.
- No trunk creation, credential changes, pause/resume, number allocation or deletion is performed by this page.
- The revision check detects stale state before a write. The provider does not document an atomic conditional write, so concurrent changes outside this app cannot be fully serialized.

## Prerequisites and limits

The account needs a provisioned phone number and working PBX/SIP routing in Voice Bot. Existing settings are read; an absent setup directs the user to the provider console. Saved binding and provider readiness do not prove end-to-end calling; a real inbound test is required separately.

Inbound callers do not carry a campaign CSV row or `vc_call_reference`. The page warns about prompt variables and does not attach the outbound campaign result/transcript tools. Agent prompt and provider-side runtime data must be suitable for inbound calls.

Reference: https://voicebot-stg.botnoigroup.com/docs/getting-started and https://voicebot-stg.botnoigroup.com/api/openapi.json (retrieved 2026-10-14).
