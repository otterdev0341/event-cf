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
- No provider webhook, automatic semantic transcript classifier or recording download added. A background refresh was added later; see below.

## Verification
Build and 78 pre-existing checks passed. Added 15 isolated call-result checks for owner isolation, exact linkage, non-inference, persistence, review validation, conflicts, preserved evidence and safe CSV quoting. No live call made and no artificial result recorded on a real contact.
Browser session currently belongs to botnoi.academy@gmail.com, which has no requests. Owner will test a new campaign with this account. Consequently the new UI live save path has not yet been exercised on an actual call in that session.

Provider reference: https://voicebot-stg.botnoigroup.com/docs/get-v1-provisioning-tenants-tenant_id-calls-call_id and /docs/get-logs-list_file and /docs/get-logs-read_log.

## Agent HTTP Tool receiver (2026-10-11)
POST /event-confirm/api/voice-result now supports authenticated, idempotent final results using a server-injected vc_call_reference. Setup and limitations: [VOICE_RESULT_SETUP.md](VOICE_RESULT_SETUP.md). It requires new server-only configuration and a deployed Voice Confirm URL; no Agent is configured automatically. Callback data is stored separately from polled evidence and manual review. Completed calls are also refreshed from storage every 15 seconds while the page is open. No provider Tool delivery has been verified yet.

## Background result refresh (2026-10-28)
Each scheduler tick (`/api/voice-scheduler`, called by pg_cron every minute) refreshes up to 5 random calls from the last 48 hours that are not yet final, as the call's owner and through the same `/workspace/calls/:requestId/result` path the page uses. Results, call status and NO_ANSWER therefore appear even when nobody keeps the campaign page open. Without pg_cron this refresh does not run.

- A call is final (`response.followup.final = true`) once its status is terminal and nothing more can arrive: a provider or Agent Tool result exists, the call was never answered, or 30 minutes have passed since it ended (the wait for Botnoi post-call analysis).
- NO_ANSWER is recorded only for recipient-side signals: status `no-answer` or `busy`, or `failed` with reason `no-answer`, `busy` or `rejected`, and no `answered_at`. Trunk and system failures such as `unreachable` or `cancelled` stay UNDETERMINED with their `failure_reason`.
- Unanswered calls skip log and analysis reads, because they have no conversation.
- The analysis fallback needs Botnoi analysis enabled on the Agent, with a `call_result` field whose option IDs are the outcome IDs, plus `needs_agent` and `evidence`.
- An answered call that stays ambiguous or ends in a hang-up remains UNDETERMINED. Nothing infers a result from transcript text.

## Automatic retries in scheduled runs (2026-10-28)
Apply `supabase/migrations/202610280001_campaign_retries.sql` in Supabase first. It adds `voice_campaign_jobs.max_attempts` (default 3, existing jobs included) and lets a run reserve up to that many attempts per contact row. Until it is applied, the worker sees no `max_attempts` and dials each row once per run, as before.

Each scheduled run decides per row from the row's last attempt in that run. A manual review wins over the Agent Tool result, which wins over the provider or analysis result; UNDETERMINED counts as no result.

| Last attempt | Next attempt |
| --- | --- |
| CONFIRMED, DECLINED, WRONG_PERSON, REQUEST_AGENT | none |
| NO_ANSWER, or not answered with a no-answer/busy/rejected signal | after 10 minutes |
| CALLBACK_REQUESTED | after 2 hours |
| Answered but ended without a result (hang-up) | after 10 minutes, once per run |
| Any other unanswered failure (`unreachable`, `cancelled`, ...) | after 60 minutes |

- A row gets at most `max_attempts` attempts per run, counting the first dial.
- A retry that falls outside 09:00-20:00 Thailand time moves to the next 09:00. First dials still start at the user's chosen time. Campaign calling hours are not used yet, because the editor never saves them.
- The worker saves each call's status and result through `/workspace/calls/:requestId/result` when the call ends. Before a retry of a call whose result is not final, it reads the result once more, so a result that arrived by then stops the retry. Botnoi analysis can take up to 30 minutes, but a hang-up is retried after 10, so an analysis result that arrives later does not stop that retry.
- If the three most recent attempts of the run were all unreachable-type failures, the job stops as `failed` with a message to check the trunk.
- While retries wait, the job stays `running` with `next_run_at` set to the earliest due retry. Manual calls for that campaign stay blocked until the job finishes or is cancelled.
