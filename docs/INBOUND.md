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

## Event knowledge and caller matching

- Saved campaigns can opt into inbound knowledge through `data.inboundInfo`: account ID, enabled flag, public location and factual details. An authenticated, owner-scoped server endpoint saves only that subdocument with an optimistic timestamp check, preserving the campaign's CSV, mapping and outbound settings.
- `/workspace/inbound/lookup` accepts a real inbound Call ID from an authenticated workspace user. It reads `/calls/{call_id}` with that user's connected token, uses the provider's canonical `number`, and matches only the mapped phone column in opted-in saved campaigns for the same owner and Voice Bot account.
- Thai national numbers and +66 numbers match. Hidden/absent numbers produce `caller_unavailable`; no match produces `no_match`; multiple events produce `choose_event`.
- Responses contain only event ID, title, date, time, location and deliberately published details. They never contain contact names, CSV fields, previous call outcomes or other contact rows.
- This operator lookup can inspect historical calls. It is NOT exposed as a public Tool endpoint and cannot establish current-call identity for a live bot.

## Remaining provider dependency

The published ToolExecution / ParamMapEntry schemas do not document a runtime context source for current Call ID or caller number. Stored Agents inspected read-only did not establish that mechanism either. `automatic_lookup_ready` therefore remains false, no caller placeholder is invented, and no Tool is attached to production Agents.

To complete automatic inbound matching, Botnoi must confirm how an HTTP Tool obtains the current call ID from trusted SIP runtime context (preferably as a signed/opaque call context, not an LLM-generated phone number). The integration must verify account, inbound direction, receiving Agent and current session before revealing matched event details. Never choose the newest/only recent call to a DID as a substitute for the current caller.

Request for the provider: “How can an inbound HTTP Tool receive the current Call ID/caller number from the SIP runtime without asking the caller? Please provide the supported context field/header, authentication/signature and one request example with credentials redacted. `/calls` after the call is not sufficient to identify the current Tool invocation.”
