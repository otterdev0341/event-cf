use crate::{
    db,
    error::{Result, bad, conflict, ok},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
pub fn validate(body: &Value) -> Result<()> {
    match body["result"].as_str() {
        Some("confirm" | "decline") if body["reason"].is_null() => Ok(()),
        Some("unknown")
            if body["reason"]
                .as_str()
                .is_some_and(|s| ["no_answer", "noisy_audio", "ai_cannot_infer"].contains(&s)) =>
        {
            Ok(())
        }
        _ => Err(bad(
            "Result must be confirm/decline or unknown with a reason",
        )),
    }
}
pub async fn apply(
    db: &impl ConnectionTrait,
    org: &str,
    event: &str,
    id: &str,
    body: Value,
) -> Result<Value> {
    validate(&body)?;
    let result = json!({"result":body["result"],"reason":body["reason"]});
    let attempt = db::one(
        db,
        "SELECT * FROM attempts WHERE id=$1 AND org_id=$2 AND event_id=$3 FOR UPDATE",
        vec![id.into(), org.into(), event.into()],
    )
    .await?;
    let status: String = db::get(&attempt, "status")?;
    let previous: Option<Value> = db::get(&attempt, "result")?;
    if status == "completed" && previous.as_ref() == Some(&result) {
        return Ok(ok());
    }
    let late = status == "completed"
        && previous.as_ref().is_some_and(|v| v["result"] == "unknown")
        && body["result"] != "unknown";
    if status != "accepted" && !late {
        return Err(conflict());
    }
    let person: String = db::get(&attempt, "participant_id")?;
    let row = db::one(
        db,
        "SELECT data,attempt_count FROM participants WHERE id=$1 FOR UPDATE",
        vec![person.clone().into()],
    )
    .await?;
    let mut data: Value = db::get(&row, "data")?;
    let policy = db::one(
        db,
        "SELECT max_retries,delay_seconds,status FROM queue_policy WHERE event_id=$1 FOR UPDATE",
        vec![event.into()],
    )
    .await?;
    let attempts: i32 = db::get(&row, "attempt_count")?;
    let definitive = data["outcome"]["result"]
        .as_str()
        .is_some_and(|r| ["confirm", "decline"].contains(&r));
    if definitive && body["result"] != "unknown" && data["outcome"]["result"] != body["result"] {
        return Err(conflict());
    }
    let unknown = body["result"] == "unknown" && !definitive;
    let retry = unknown
        && attempts <= db::get::<i32>(&policy, "max_retries")?
        && db::get::<String>(&policy, "status")? != "cancelled";
    if !definitive {
        data["outcome"] = result.clone();
    }
    if body["reason"] == "no_answer" && !late {
        data["noAnswerCount"] = json!(data["noAnswerCount"].as_i64().unwrap_or(0) + 1);
    }
    db::exec(
        db,
        "UPDATE attempts SET status='completed',result=$2 WHERE id=$1",
        vec![id.into(), result.into()],
    )
    .await?;
    let pending=db::rows(db,"SELECT id FROM attempts WHERE participant_id=$1 AND id<>$2 AND status IN ('reserved','uncertain','accepted')",vec![person.clone().into(),id.into()]).await?;
    let state = if !pending.is_empty() {
        "awaiting_result"
    } else if retry {
        "delayed"
    } else {
        "stopped"
    };
    db::exec(db,"UPDATE participants SET data=$1,lane=$2,state=$3,eligible_at=now()+make_interval(secs=>$4) WHERE id=$5",
  vec![data.into(),(if unknown{"fail"}else{"done"}).into(),state.into(),
  (db::get::<i32>(&policy,"delay_seconds")? as f64).into(),person.into()]).await?;
    if let Some(ticket) = body.get("ticket") {
        crate::tickets::handle(db, org, event, None, "POST", ticket.clone()).await?;
    }
    Ok(ok())
}
