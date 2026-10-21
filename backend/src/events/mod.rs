pub mod dto;
pub mod entity;
use crate::{
    db,
    error::{Result, bad, conflict},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
pub async fn handle(
    db: &impl ConnectionTrait,
    org: &str,
    id: Option<&str>,
    method: &str,
    body: Value,
) -> Result<Value> {
    if method == "GET" {
        if let Some(id) = id {
            return Ok(db::get(
                &db::one(
                    db,
                    "SELECT data FROM events WHERE org_id=$1 AND id=$2",
                    vec![org.into(), id.into()],
                )
                .await?,
                "data",
            )?);
        }
        let records = db::rows(
            db,
            "SELECT data FROM events WHERE org_id=$1 ORDER BY code",
            vec![org.into()],
        )
        .await?;
        return Ok(Value::Array(
            records
                .iter()
                .map(|r| db::get(r, "data"))
                .collect::<Result<_>>()?,
        ));
    }
    if method == "POST" && id.is_none() {
        let input: dto::EventInput = serde_json::from_value(body)?;
        input.validate()?;
        let id = uuid::Uuid::new_v4().to_string();
        let mut data = serde_json::to_value(&input)?;
        data.as_object_mut().unwrap().extend(
            json!({"id":id,"orgId":org,"status":"draft","version":1,"participantCount":0})
                .as_object()
                .unwrap()
                .clone(),
        );
        db::exec(
            db,
            "INSERT INTO events(id,org_id,code,data) VALUES($1,$2,$3,$4)",
            vec![
                id.clone().into(),
                org.into(),
                input.code.into(),
                data.clone().into(),
            ],
        )
        .await?;
        db::exec(
            db,
            "INSERT INTO knowledge(org_id,event_id) VALUES($1,$2)",
            vec![org.into(), id.clone().into()],
        )
        .await?;
        db::exec(
            db,
            "INSERT INTO queue_policy(org_id,event_id) VALUES($1,$2)",
            vec![org.into(), id.into()],
        )
        .await?;
        return Ok(data);
    }
    if method == "PATCH" {
        let id = id.ok_or_else(|| bad("Missing event"))?;
        let row = db::one(
            db,
            "SELECT data,version FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE",
            vec![org.into(), id.into()],
        )
        .await?;
        let version: i32 = db::get(&row, "version")?;
        if body["expectedVersion"].as_i64() != Some(version as i64) {
            return Err(conflict());
        }
        let mut data: Value = db::get(&row, "data")?;
        if let Some(status) = body["status"].as_str() {
            if !["draft", "published", "archived"].contains(&status) {
                return Err(bad("Invalid status"));
            }
            data["status"] = json!(status);
        } else {
            let input: dto::EventInput = serde_json::from_value(body)?;
            input.validate()?;
            data.as_object_mut()
                .unwrap()
                .extend(serde_json::to_value(input)?.as_object().unwrap().clone());
        }
        data["version"] = json!(version + 1);
        db::exec(
            db,
            "UPDATE events SET code=$1,data=$2,version=version+1 WHERE org_id=$3 AND id=$4",
            vec![
                data["code"].as_str().unwrap().into(),
                data.clone().into(),
                org.into(),
                id.into(),
            ],
        )
        .await?;
        return Ok(data);
    }
    Err(bad("Unsupported event operation"))
}
