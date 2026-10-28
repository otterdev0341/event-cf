# Campaign scheduler

Campaign creation only saves the campaign. It never starts calls or creates an
alarm. The campaign call page has an optional clock button. Users can set one
alarm, repeat daily, or choose weekdays, all in Thailand time. They explicitly
confirm the selected contacts and whether completed contacts may be redialed.
Without an alarm, the existing manual start button remains available.

The server worker polls an active call before submitting the next CSV row and
submits at most one new call per tick. Recurring alarms advance to the next future
occurrence after completing a run; missed occurrences are skipped. A fresh run ID
prevents the same contact being dispatched twice in one occurrence. Previously
completed contacts are only redialed when the saved alarm explicitly allows it.

## Install

1. Apply `supabase/migrations/202610170001_campaign_jobs.sql` and then
   `supabase/migrations/202610170002_optional_recurring_schedules.sql` as project owner.
2. Deploy `/event-confirm/api/voice-scheduler` with the existing connection encryption,
   service role, and callback secret environment variables.
3. Enable Supabase `pg_cron` and `pg_net`. Store the scheduler token in Vault as
   `voice_campaign_scheduler_token`. The token is the hex HMAC-SHA256 of the text
   `voice-campaign-scheduler-v1` keyed with `VOICE_RESULT_CALLBACK_SECRET`
   (`schedulerSecret` in `backend/scheduler.go`), for example
   `printf %s voice-campaign-scheduler-v1 | openssl dgst -sha256 -hmac "$VOICE_RESULT_CALLBACK_SECRET" -r | cut -d' ' -f1`.
   Recompute it whenever the callback secret changes.
4. Schedule the SQL below every minute. It includes only a Vault reference, never
   a credential literal. Keep credential-bearing pg_net request tables inaccessible
   to public, anon, and authenticated roles.

```sql
select cron.schedule('voice-confirm-campaign-worker', '* * * * *', $$
  select net.http_post(
    url := 'https://otterdev.xyz/event-confirm/api/voice-scheduler',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
        where name = 'voice_campaign_scheduler_token')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$$);
```

5. Confirm `voice_scheduler_health.last_tick` advances on its own. New job
   confirmation refuses to proceed if the heartbeat is older than three minutes.
   Existing campaigns are never scheduled retroactively.

## Recovery and cancellation

Jobs pin the campaign version and Voice Bot account. Changes to either stop the
job. Expired/revoked provider sessions stop the job with a visible error. Missing
Call IDs and ambiguous provider outcomes stop instead of redialing. Once reviewed,
the existing manual campaign queue can continue uncompleted rows. Cancellation
blocks later reservations; an already dispatched call can still complete.

An SQL lease serializes workers. The call reservation checks the live lease,
cancellation state, campaign version, account, and rate limit transactionally.
The existing deterministic request ID and unique database key prevent duplicate
dispatch after a crash. Editing/deleting a campaign invalidates/cascades its job.

Validation: `node scripts/test-scheduler.mjs`, `go test` in `backend/`
(`TestCampaignWorker`, `TestCampaignAlarm`, `TestSchedulerEndpoint`), and `npm run build`. Tests use fixtures and a disposable PostgreSQL engine.

References: https://supabase.com/docs/guides/functions/schedule-functions
and https://supabase.com/docs/guides/database/extensions/pg_net
