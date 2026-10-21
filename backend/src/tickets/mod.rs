use crate::{
    db,
    error::{Result, bad, conflict},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    title: String,
    description: String,
    #[serde(rename = "type")]
    kind: String,
    assignee_ids: Vec<String>,
    due_date: String,
}
async fn assignees(db: &impl ConnectionTrait, org: &str, ids: &Value) -> Result<()> {
    let ids: Vec<String> = serde_json::from_value(ids.clone())?;
    if ids.len() > 50 {
        return Err(bad("Too many assignees"));
    }
    let mut seen = Vec::new();
    for id in ids {
        if seen.contains(&id) {
            return Err(bad("Duplicate assignee"));
        }
        db::one(
            db,
            "SELECT user_id FROM memberships WHERE org_id=$1 AND user_id=$2",
            vec![org.into(), id.clone().into()],
        )
        .await?;
        seen.push(id);
    }
    Ok(())
}
fn due_date(value: &Value) -> Result<()> {
    let value = value.as_str().ok_or_else(|| bad("Invalid date"))?;
    if !value.is_empty() && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err() {
        return Err(bad("Invalid date"));
    }
    Ok(())
}
pub async fn handle(
    db: &impl ConnectionTrait,
    org: &str,
    event: &str,
    id: Option<&str>,
    method: &str,
    body: Value,
) -> Result<Value> {
    if method == "GET" {
        let rows = db::rows(
            db,
            "SELECT data FROM tickets WHERE org_id=$1 AND event_id=$2 ORDER BY id",
            vec![org.into(), event.into()],
        )
        .await?;
        return Ok(Value::Array(
            rows.iter()
                .map(|r| db::get(r, "data"))
                .collect::<Result<_>>()?,
        ));
    }
    if method == "POST" {
        let input: Input = serde_json::from_value(body)?;
        if input.title.trim().is_empty()
            || input.title.len() > 180
            || input.description.trim().is_empty()
            || input.description.len() > 4000
            || !["unanswered", "callback"].contains(&input.kind.as_str())
        {
            return Err(bad("Invalid ticket"));
        }
        let mut data = serde_json::to_value(input)?;
        assignees(db, org, &data["assigneeIds"]).await?;
        due_date(&data["dueDate"])?;
        let id = uuid::Uuid::new_v4().to_string();
        data.as_object_mut().unwrap().extend(json!({"id":id,"eventId":event,"status":"open","version":1,"comments":[],"activity":["Created"]}).as_object().unwrap().clone());
        db::exec(
            db,
            "INSERT INTO tickets(id,org_id,event_id,data) VALUES($1,$2,$3,$4)",
            vec![id.into(), org.into(), event.into(), data.clone().into()],
        )
        .await?;
        return Ok(data);
    }
    let id = id.ok_or_else(|| bad("Ticket ID required"))?;
    let row = db::one(
        db,
        "SELECT data FROM tickets WHERE org_id=$1 AND event_id=$2 AND id=$3 FOR UPDATE",
        vec![org.into(), event.into(), id.into()],
    )
    .await?;
    let mut data: Value = db::get(&row, "data")?;
    if method != "PATCH" || body["expectedVersion"] != data["version"] {
        return Err(conflict());
    }
    if let Some(status) = body.get("status") {
        if !status
            .as_str()
            .is_some_and(|s| ["open", "in_progress", "waiting", "resolved"].contains(&s))
        {
            return Err(bad("Invalid stage"));
        }
        data["status"] = status.clone();
    }
    if let Some(ids) = body.get("assigneeIds") {
        assignees(db, org, ids).await?;
        data["assigneeIds"] = ids.clone();
    }
    if let Some(date) = body.get("dueDate") {
        due_date(date)?;
        data["dueDate"] = date.clone();
    }
    if let Some(comment) = body.get("comment") {
        let text = comment
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.len() <= 4000)
            .ok_or_else(|| bad("Invalid comment"))?;
        data["comments"].as_array_mut().unwrap().push(json!({"id":uuid::Uuid::new_v4().to_string(),"text":text,"at":chrono::Utc::now().to_rfc3339()}));
    }
    data["version"] = json!(data["version"].as_i64().unwrap() + 1);
    data["activity"].as_array_mut().unwrap().push(json!(format!(
        "Updated {}",
        chrono::Utc::now().to_rfc3339()
    )));
    db::exec(
        db,
        "UPDATE tickets SET data=$1 WHERE org_id=$2 AND event_id=$3 AND id=$4",
        vec![data.clone().into(), org.into(), event.into(), id.into()],
    )
    .await?;
    Ok(data)
}
