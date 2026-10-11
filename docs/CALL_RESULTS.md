# Call results (2026-10-11)

Campaign screen now includes persisted call status, per-call outcome/source, provider transcript (when exactly linked), manual review with evidence, filters, summary counts and CSV export.

## Data ownership
- GET/POST /workspace/calls/:requestId/result verifies Supabase session and owner_id before contacting the provider.
- Existing get-call-status route now checks call ownership and persists status; it does not start a call.
- Uses existing voice_call_requests.response.followup and .review. No schema/access expansion or migration.
- Conditional updates compare status, review.updated_at and followup.checked_at to avoid overwriting concurrent reviews/refreshes. Conflicts are reported, never silently accepted.

## Outcome evidence
- A completed phone call does NOT mean acceptance.
- Only explicit call_result/needs_agent fields at result/output/top-level are accepted. CSV metadata inputs and transcript keywords are never interpreted as outcomes.
- Manual review requires a note, records user and timestamp, and stays distinct from provider results.
- Missing needs_agent remains null, not false. Missing result remains UNDETERMINED.
- Conversation file must be an exact Call ID filename/path segment, or an explicit transcript_file_path/log_file_path from the call response that appears in the Agent file listing. No time/name/phone-only matching.
- Provider output and log response shapes remain undocumented (OpenAPI says unknown); optional adapters require confirmation with live evidence before claiming support for another shape.

## Observed provider behavior
Read-only inspection of the previously supplied test Call ID returned completed, answered_at and completed_at. It did not return call_result, needs_agent or transcript linkage. Agent conversation file list was empty. The sole platform log was an earlier preview session and was NOT attached to the outbound call.
Automatic business outcome recovery for this historical call remains blocked by absent provider data. Agent prompt wording alone does not persist structured outputs. Provider must expose saved result variables/transcript and their Call ID linkage, or a separately configured authenticated callback/tool integration is needed.

## UI behavior and limits
- On page entry, refresh up to 25 recent existing requests. Pending call status polls every 15 seconds while page is visible. An explicit refresh button processes all existing calls sequentially; it can be stopped.
- While a call queue runs, its existing poller persists phone status. Results refresh after the queue stops. Post-call information arriving later is fetched via Refresh all calls.
- Summaries/export use the current campaign version. Previous-version calls remain visible in history and are labeled, but never joined to changed CSV rows.
- CSV contains original columns plus prefixed result fields and all current-version attempts. Original leading-zero phone strings are preserved in the file; Excel import should treat phone as text. Formula-like exported text is escaped.
- No background worker, provider webhook, automatic semantic transcript classifier or recording download added.

## Verification
Build and 78 pre-existing checks passed. Added 15 isolated call-result checks for owner isolation, exact linkage, non-inference, persistence, review validation, conflicts, preserved evidence and safe CSV quoting. No live call made and no artificial result recorded on a real contact.
Browser session currently belongs to botnoi.academy@gmail.com, which has no requests. Owner will test a new campaign with this account. Consequently the new UI live save path has not yet been exercised on an actual call in that session.

Provider reference: https://voicebot-stg.botnoigroup.com/docs/get-v1-provisioning-tenants-tenant_id-calls-call_id and /docs/get-logs-list_file and /docs/get-logs-read_log.

## Agent HTTP Tool receiver (2026-10-11)
POST /api/voice-result now supports authenticated, idempotent final results using a server-injected vc_call_reference. Setup and limitations: [VOICE_RESULT_SETUP.md](VOICE_RESULT_SETUP.md). It requires new server-only configuration and a deployed Voice Confirm URL; no Agent is configured automatically. Callback data is stored separately from polled evidence and manual review. Completed calls are also refreshed from storage every 15 seconds while the page is open. No provider Tool delivery has been verified yet.
