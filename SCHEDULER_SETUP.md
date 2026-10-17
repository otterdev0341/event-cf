# Campaign scheduler

The final campaign confirmation creates one durable job for the saved campaign
version. `scheduled` uses an explicit Thailand date/time; `immediate` joins the
next worker tick. The worker checks each active call before submitting the next
CSV row. It submits at most one new call per invocation. No browser needs to stay
open. Dispatch can be later than the chosen minute if other jobs are waiting or
the provider is unavailable.

## Install

1. Apply `supabase/migrations/202610170001_campaign_jobs.sql` as project owner.
2. Deploy `/api/voice-scheduler` with the existing connection encryption,
   service role, and callback secret environment variables.
3. Enable Supabase `pg_cron` and `pg_net`. Store `schedulerSecret(env)` from
   `server/scheduler.mjs` in Vault as `voice_campaign_scheduler_token`.
4. Schedule the SQL below every minute. It includes only a Vault reference, never
   a credential literal. Keep credential-bearing pg_net request tables inaccessible
   to public, anon, and authenticated roles.

```sql
select cron.schedule('voice-confirm-campaign-worker', '* * * * *', $$
  select net.http_post(
    url := 'https://voice-confirm-two.vercel.app/api/voice-scheduler',
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

Validation: `node scripts/test-scheduler.mjs`, `node scripts/test-backend.mjs`,
and `npm run build`. Tests use fixtures and a disposable PostgreSQL engine.

References: https://supabase.com/docs/guides/functions/schedule-functions
and https://supabase.com/docs/guides/database/extensions/pg_net
