# Backend queue, persistence and cutover boundary

Date: 2026-10-21. Status: implementation under acceptance testing.

- ntex 4.3.0 uses the Tokio backend; SeaORM 1.1.20 uses PostgreSQL and runtime-tokio-rustls.
  Cargo.lock and Rust 1.97.0 are pinned. CPU-heavy hashing/JSON parsing use bounded,
  awaited blocking pools; database pools have five connections and bounded acquisition.
- PostgreSQL is the only durable queue. No Redis or broker is needed for current usage.
  Queue policy, participant eligibility and attempt journal are separate relational tables.
  Composite tenant/event foreign keys constrain event-owned data.
- Low usage starts with **one active call globally**, one pending attempt per event,
  one polling worker. Transaction advisory locking and row locks protect competing workers.
  API reads remain independent of provider HTTP. Raising capacity needs load evidence.
- Ratio is now X:Y, not just X:1. The saved turn advances once after provider acceptance.
  If the preferred lane has no eligible rows, the other lane can use that turn.
  Cooldown, final attendance and the retry cap still apply.
- maxRetries excludes the initial call. maxRetries=0 permits one initial call only.
  Stopped rows are never reopened by increasing the setting.
- A submitted request that times out stays uncertain. Reconciliation uses its original
  attempt/idempotency ID. There is no automatic redial on HTTP timeout or missing result.
  A late confirm/decline may correct unknown, stops future retries, and cannot be overwritten
  by a later unknown result. Existing in-flight work must still finish/reconcile.
- Knowledge is a versioned event aggregate containing draft FAQ/category data and a
  published snapshot. It is stored as JSONB in a tenant-constrained knowledge table;
  category revision and FAQ version checks occur in short transactions.
  This is an aggregate implementation, not separate normalized category/FAQ entities.
  Split those into relational entities before adding large-scale search/reporting.
- Browser cookies and paired Agent credentials are separate. Secret tokens are hashed
  at rest; one-time invitation/reset tokens enter a mail outbox until delivery.
  Revocation and authorization are checked again on idempotency replay.
- Provider and mail clients currently target explicit adapter contracts. They are NOT
  production Botnoi/SES integrations. Real credentials, provider callbacks, signature
  validation and controlled acceptance must be supplied/verified before enabling delivery.
- Keep the public website in explicit demo mode until backend cutover gates pass.
  A successful frontend deployment is not proof that P8 or P9 is complete.
