pub mod dispatch;
pub mod imports;
pub mod policy;
pub mod results;
pub mod worker;
use crate::{
    db,
    error::{Result, missing},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
pub async fn handle(
    db: &impl ConnectionTrait,
    org: &str,
    event: &str,
    tail: &[&str],
    method: &str,
    body: Value,
) -> Result<Value> {
    match (tail[0], method) {
        ("queue-state", "GET") => policy::state(db, org, event).await,
        ("queue-policy", "PATCH") => policy::update(db, org, event, body).await,
        ("runs", "POST") => policy::run(db, org, event, body).await,
        ("imports", "POST") if tail.len() == 1 => imports::preview(db, org, event, body).await,
        ("imports", "POST") if tail.len() == 3 && tail[2] == "commit" => {
            imports::commit(db, org, event, tail[1]).await
        }
        ("participants", "GET") => {
            let rows=db::rows(db,"SELECT data,lane,state,id FROM participants WHERE org_id=$1 AND event_id=$2 ORDER BY id",vec![org.into(),event.into()]).await?;
            let mut values = Vec::new();
            for row in rows {
                let mut value: Value = db::get(&row, "data")?;
                value["lane"] = json!(db::get::<String>(&row, "lane")?);
                value["state"] = json!(db::get::<String>(&row, "state")?);
                let attempts=db::rows(db,"SELECT id,number,status,result,created_at FROM attempts WHERE participant_id=$1 ORDER BY number",vec![db::get::<String>(&row,"id")?.into()]).await?;
                value["attempts"]=Value::Array(attempts.iter().map(|a|Ok(json!({"id":db::get::<String>(a,"id")?,"number":db::get::<i32>(a,"number")?,"transport":db::get::<String>(a,"status")?,
     "outcome":db::get::<Option<Value>>(a,"result")?.unwrap_or(json!({"result":null,"reason":null})),
     "at":db::get::<chrono::DateTime<chrono::Utc>>(a,"created_at")?.to_rfc3339()}))).collect::<Result<_>>()?);
                values.push(value);
            }
            Ok(Value::Array(values))
        }
        _ => Err(missing()),
    }
}
