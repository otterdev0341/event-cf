use crate::{
    config::App,
    db,
    error::{Error, Result},
};
use serde_json::{Value, json};
use std::time::Duration;
pub async fn tick(app: &App, client: &reqwest::Client, url: &str, key: &str) -> Result<()> {
    // Claim and commit before HTTP. A crash retries the same provider idempotency key.
    let rows=db::rows(&app.db,"UPDATE mail_outbox SET state='sending',attempts=attempts+1,next_at=now()+interval '60 seconds' WHERE id=(SELECT id FROM mail_outbox WHERE state IN ('pending','sending') AND attempts<5 AND next_at<=now() ORDER BY next_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,recipient,payload",vec![]).await?;
    let Some(row) = rows.first() else {
        return Ok(());
    };
    let id: String = db::get(row, "id")?;
    let sent=client.post(format!("{url}/messages")).bearer_auth(key).header("Idempotency-Key",&id)
  .json(&json!({"to":db::get::<String>(row,"recipient")?,"message":db::get::<Value>(row,"payload")?})).send().await;
    if sent.is_ok_and(|r| r.status().is_success()) {
        db::exec(
            &app.db,
            "UPDATE mail_outbox SET state='sent',payload='{}' WHERE id=$1",
            vec![id.into()],
        )
        .await?;
    } else {
        db::exec(&app.db,"UPDATE mail_outbox SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,next_at=now()+make_interval(secs=>attempts*60) WHERE id=$1",vec![id.into()]).await?;
    }
    Ok(())
}
pub async fn run(app: App) -> Result<()> {
    if std::env::var("MAIL_ENABLED").as_deref() != Ok("true") {
        return Err(Error(503, "Mail delivery is disabled".into()));
    }
    let url = std::env::var("MAIL_API_URL")
        .map_err(|_| Error(503, "Mail adapter URL required".into()))?;
    let key = std::env::var("MAIL_API_TOKEN")
        .map_err(|_| Error(503, "Mail adapter token required".into()))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| Error(503, "Mail client unavailable".into()))?;
    let stop = async {
        if let Err(error) = crate::shutdown::signal().await {
            eprintln!("shutdown listener: {error}");
        }
    };
    crate::shutdown::drain_loop(stop, Duration::from_secs(2), || async {
        if let Err(error) = tick(&app, &client, &url, &key).await {
            eprintln!("mail delivery: {}", error.1);
        }
    })
    .await;
    Ok(())
}
