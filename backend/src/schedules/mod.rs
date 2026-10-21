pub mod time;
pub mod worker;
use crate::{
    auth::User,
    db,
    error::{Result, bad, conflict, missing},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
pub async fn handle(
    db: &impl ConnectionTrait,
    user: &User,
    org: &str,
    event: &str,
    id: Option<&str>,
    method: &str,
    body: Value,
) -> Result<Value> {
    if method == "GET" {
        let rows = db::rows(
            db,
            "SELECT * FROM schedules WHERE org_id=$1 AND event_id=$2 ORDER BY next_at,id",
            vec![org.into(), event.into()],
        )
        .await?;
        return Ok(Value::Array(rows.iter().map(view).collect::<Result<_>>()?));
    }
    if method == "PATCH" {
        let id = id.ok_or_else(missing)?;
        if body["action"] != "cancel" {
            return Err(bad("Only cancellation is supported"));
        }
        let changed = db::exec(db, "UPDATE schedules SET status='cancelled',version=version+1 WHERE org_id=$1 AND event_id=$2 AND id=$3 AND version=$4 AND status IN ('scheduled','running','failed')",
            vec![org.into(),event.into(),id.into(),body["expectedVersion"].as_i64().ok_or_else(||bad("Version required"))?.into()]).await?;
        if changed != 1 {
            return Err(conflict());
        }
        db::exec(db,"UPDATE queue_policy SET status='paused',version=version+1 WHERE event_id=$1 AND status='running'",vec![event.into()]).await?;
        return Ok(json!({"ok":true}));
    }
    if method != "POST" || id.is_some() {
        return Err(missing());
    }
    let rule: time::Rule = serde_json::from_value(body.clone())?;
    let next = rule.next(chrono::Utc::now())?;
    let row = db::one(
        db,
        "SELECT version,data FROM events WHERE org_id=$1 AND id=$2",
        vec![org.into(), event.into()],
    )
    .await?;
    if db::get::<i32>(&row, "version")? != rule.expected_event_version
        || db::get::<Value>(&row, "data")?["status"] == "archived"
    {
        return Err(conflict());
    }
    db::one(
        db,
        "SELECT event_id FROM queue_policy WHERE event_id=$1 FOR UPDATE",
        vec![event.into()],
    )
    .await?;
    let state = crate::calling::policy::state(db, org, event).await?;
    if state["status"] == "running" || state["pendingTurn"] == true {
        return Err(conflict());
    }
    for person in &rule.participant_ids {
        db::one(
            db,
            "SELECT id FROM participants WHERE org_id=$1 AND event_id=$2 AND id=$3",
            vec![org.into(), event.into(), person.clone().into()],
        )
        .await?;
    }
    let id = uuid::Uuid::new_v4().to_string();
    db::exec(db,"INSERT INTO schedules(id,org_id,event_id,user_id,event_version,data,next_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
        vec![id.clone().into(),org.into(),event.into(),user.id.clone().into(),rule.expected_event_version.into(),body.into(),next.into()]).await?;
    view(&db::one(db, "SELECT * FROM schedules WHERE id=$1", vec![id.into()]).await?)
}
fn view(row: &sea_orm::QueryResult) -> Result<Value> {
    Ok(
        json!({"id":db::get::<String>(row,"id")?,"rule":db::get::<Value>(row,"data")?,
        "status":db::get::<String>(row,"status")?,"version":db::get::<i32>(row,"version")?,
        "nextAt":db::get::<chrono::DateTime<chrono::Utc>>(row,"next_at")?.to_rfc3339(),
        "completedRuns":db::get::<i32>(row,"completed_runs")?}),
    )
}
