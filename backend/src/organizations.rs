use crate::{
    auth::{self, User},
    db,
    error::{Result, bad, conflict, denied, ok},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
pub async fn create(db: &impl ConnectionTrait, user: &User, body: Value) -> Result<Value> {
    let name = body["name"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 100)
        .ok_or_else(|| bad("Invalid organization name"))?;
    let id = uuid::Uuid::new_v4().to_string();
    db::exec(
        db,
        "INSERT INTO organizations(id,name) VALUES($1,$2)",
        vec![id.clone().into(), name.trim().into()],
    )
    .await?;
    db::exec(
        db,
        "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'org_admin')",
        vec![id.into(), user.id.clone().into()],
    )
    .await?;
    auth::profile(db, user).await
}
pub async fn members(
    db: &impl ConnectionTrait,
    user: &User,
    org: &str,
    id: Option<&str>,
    method: &str,
    body: Value,
) -> Result<Value> {
    if method == "GET" {
        let rows=db::rows(db,"SELECT m.user_id,m.role,m.event_ids,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1",vec![org.into()]).await?;
        let mut members:Vec<Value> = rows.iter().map(|r|Ok(json!({"id":db::get::<String>(r,"user_id")?,"email":db::get::<String>(r,"email")?,
   "role":db::get::<String>(r,"role")?,"eventIds":db::get::<Value>(r,"event_ids")?,"status":"active"}))).collect::<Result<_>>()?;
        members.extend(auth::invitations::pending(db, org).await?);
        return Ok(Value::Array(members));
    }
    auth::scope(db, user, org, None, true, true).await?;
    if method == "POST" && id.is_none() {
        return auth::invitations::invite(db, org, body).await;
    }
    let id = id.ok_or_else(|| bad("Member required"))?;
    if let Some(digest) = id.strip_prefix("invite:") {
        return if method == "DELETE" {
            auth::invitations::cancel(db, org, digest).await
        } else {
            Err(bad("Cancel and reissue invitation to change policy"))
        };
    }
    if id == user.id {
        return Err(denied());
    }
    let account = db::one(db, "SELECT root FROM users WHERE id=$1", vec![id.into()]).await?;
    if db::get::<bool>(&account, "root")? {
        return Err(denied());
    }
    let current = db::one(
        db,
        "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2 FOR UPDATE",
        vec![org.into(), id.into()],
    )
    .await?;
    if db::get::<String>(&current, "role")? == "org_admin" {
        let count = db::one(
            db,
            "SELECT count(*) AS count FROM memberships WHERE org_id=$1 AND role='org_admin'",
            vec![org.into()],
        )
        .await?;
        if db::get::<i64>(&count, "count")? <= 1 {
            return Err(conflict());
        }
    }
    if method == "DELETE" {
        db::exec(
            db,
            "DELETE FROM memberships WHERE org_id=$1 AND user_id=$2",
            vec![org.into(), id.into()],
        )
        .await?;
        db::exec(db,"UPDATE tickets SET data=jsonb_set(jsonb_set(data,'{assigneeIds}',(data->'assigneeIds')-$2),'{version}',to_jsonb((data->>'version')::int+1)) WHERE org_id=$1 AND data->'assigneeIds' ? $2",vec![org.into(),id.into()]).await?;
    } else if method == "PATCH" {
        let role = body["role"]
            .as_str()
            .filter(|s| ["org_admin", "event_admin", "team_member"].contains(s))
            .ok_or_else(denied)?;
        let ids = body["eventIds"]
            .as_array()
            .ok_or_else(|| bad("Event grants required"))?;
        if role == "event_admin" && ids.is_empty() {
            return Err(bad("Event admin requires event grants"));
        }
        for event in ids {
            db::one(
                db,
                "SELECT id FROM events WHERE org_id=$1 AND id=$2",
                vec![
                    org.into(),
                    event
                        .as_str()
                        .ok_or_else(|| bad("Invalid event grant"))?
                        .into(),
                ],
            )
            .await?;
        }
        db::exec(
            db,
            "UPDATE memberships SET role=$1,event_ids=$2 WHERE org_id=$3 AND user_id=$4",
            vec![
                role.into(),
                body["eventIds"].clone().into(),
                org.into(),
                id.into(),
            ],
        )
        .await?;
    } else {
        return Err(bad("Unsupported member operation"));
    }
    Ok(ok())
}
