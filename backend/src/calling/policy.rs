use crate::{
    db,
    error::{Result, bad, conflict},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    ratio: i32,
    retry_ratio: i32,
    max_retries: i32,
    expected_version: i32,
}
pub async fn state(db: &impl ConnectionTrait, org: &str, event: &str) -> Result<Value> {
    let r=db::one(db,"SELECT q.*,EXISTS(SELECT 1 FROM attempts a WHERE a.event_id=q.event_id AND a.status IN ('reserved','uncertain','accepted')) AS pending FROM queue_policy q WHERE org_id=$1 AND event_id=$2",vec![org.into(),event.into()]).await?;
    Ok(
        json!({"ratio":db::get::<i32>(&r,"new_weight")?,"retryRatio":db::get::<i32>(&r,"retry_weight")?,
  "maxAttempts":db::get::<i32>(&r,"max_retries")?+1,"newSinceFail":db::get::<i32>(&r,"turn")?.min(db::get::<i32>(&r,"new_weight")?),"dispatchPosition":db::get::<i32>(&r,"turn")?,
  "delayMinutes":db::get::<i32>(&r,"delay_seconds")?/60,"version":db::get::<i32>(&r,"version")?,
  "status":db::get::<String>(&r,"status")?,"pendingTurn":db::get::<bool>(&r,"pending")?}),
    )
}
pub async fn update(
    db: &impl ConnectionTrait,
    org: &str,
    event: &str,
    body: Value,
) -> Result<Value> {
    let input: Policy = serde_json::from_value(body)?;
    if !(1..=100).contains(&input.ratio)
        || !(1..=100).contains(&input.retry_ratio)
        || !(0..=10).contains(&input.max_retries)
    {
        return Err(bad("Invalid ratio or retry limit"));
    }
    db::one(
        db,
        "SELECT event_id FROM queue_policy WHERE org_id=$1 AND event_id=$2 FOR UPDATE",
        vec![org.into(), event.into()],
    )
    .await?;
    let current = state(db, org, event).await?;
    if current["version"] != input.expected_version
        || current["pendingTurn"] == true
        || current["status"] == "running"
    {
        return Err(conflict());
    }
    db::exec(db,"UPDATE queue_policy SET new_weight=$1,retry_weight=$2,max_retries=$3,turn=0,version=version+1 WHERE org_id=$4 AND event_id=$5",vec![input.ratio.into(),input.retry_ratio.into(),input.max_retries.into(),org.into(),event.into()]).await?;
    db::exec(db,"UPDATE participants SET state='stopped' WHERE org_id=$1 AND event_id=$2 AND lane='fail' AND state IN ('ready','delayed') AND attempt_count >= $3",vec![org.into(),event.into(),(input.max_retries+1).into()]).await?;
    state(db, org, event).await
}
pub async fn run(db: &impl ConnectionTrait, org: &str, event: &str, body: Value) -> Result<Value> {
    db::one(
        db,
        "SELECT event_id FROM queue_policy WHERE org_id=$1 AND event_id=$2 FOR UPDATE",
        vec![org.into(), event.into()],
    )
    .await?;
    let current = state(db, org, event).await?;
    let action = body["action"]
        .as_str()
        .ok_or_else(|| bad("Action required"))?;
    let target = match (action, current["status"].as_str().unwrap()) {
        ("start", "idle") | ("resume", "paused") => "running",
        ("pause", "running") => "paused",
        ("cancel", "running" | "paused") => "cancelled",
        _ => return Err(conflict()),
    };
    let event_row = db::one(
        db,
        "SELECT data FROM events WHERE org_id=$1 AND id=$2",
        vec![org.into(), event.into()],
    )
    .await?;
    if target == "running" && db::get::<Value>(&event_row, "data")?["status"] == "archived" {
        return Err(conflict());
    }
    db::exec(
        db,
        "UPDATE queue_policy SET status=$1,version=version+1 WHERE org_id=$2 AND event_id=$3",
        vec![target.into(), org.into(), event.into()],
    )
    .await?;
    state(db, org, event).await
}
