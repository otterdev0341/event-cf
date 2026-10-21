use crate::{
    db,
    error::{Result, bad, denied, ok},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
pub async fn invite(db: &impl ConnectionTrait, org: &str, body: Value) -> Result<Value> {
    let email = body["email"]
        .as_str()
        .filter(|s| s.len() <= 254 && s.contains('@'))
        .ok_or_else(|| bad("Invalid email"))?
        .trim()
        .to_lowercase();
    let role = body["role"]
        .as_str()
        .filter(|s| ["org_admin", "event_admin", "team_member"].contains(s))
        .ok_or_else(denied)?;
    let ids: Vec<String> = serde_json::from_value(body["eventIds"].clone())?;
    if ids.len() > 1000 || (role == "event_admin" && ids.is_empty()) {
        return Err(bad("Invalid event grants"));
    }
    for event in &ids {
        db::one(
            db,
            "SELECT id FROM events WHERE org_id=$1 AND id=$2",
            vec![org.into(), event.clone().into()],
        )
        .await?;
    }
    let existing = db::rows(
        db,
        "SELECT id,password_hash FROM users WHERE email=$1 FOR UPDATE",
        vec![email.clone().into()],
    )
    .await?;
    let (id, signup) = if let Some(row) = existing.first() {
        (
            db::get::<String>(row, "id")?,
            db::get::<String>(row, "password_hash")? == "!",
        )
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        db::exec(
            db,
            "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$2,'!')",
            vec![id.clone().into(), email.clone().into()],
        )
        .await?;
        (id, true)
    };
    let member = db::rows(
        db,
        "SELECT user_id FROM memberships WHERE org_id=$1 AND user_id=$2",
        vec![org.into(), id.clone().into()],
    )
    .await?;
    if !member.is_empty() {
        return Err(bad("Already an organization member"));
    }
    let origin = std::env::var("PUBLIC_ORIGIN").unwrap_or("http://127.0.0.1:18460".into());
    super::tokens::issue(
        db,
        &origin,
        "invite",
        &email,
        json!({"userId":id,"orgId":org,"role":role,"eventIds":ids,"signup":signup}),
    )
    .await?;
    Ok(json!({"ok":true,"message":"Invitation queued for delivery"}))
}
pub async fn pending(db: &impl ConnectionTrait, org: &str) -> Result<Vec<Value>> {
    let rows=db::rows(db,"SELECT digest,email,data FROM auth_tokens WHERE kind='invite' AND NOT consumed AND expires_at>now() AND data->>'orgId'=$1",vec![org.into()]).await?;
    rows.iter().map(|r|{
  let data:Value=db::get(r,"data")?;
  Ok(json!({"id":format!("invite:{}",db::get::<String>(r,"digest")?),"email":db::get::<String>(r,"email")?,
   "role":data["role"],"eventIds":data["eventIds"],"status":"invited"}))
 }).collect()
}
pub async fn cancel(db: &impl ConnectionTrait, org: &str, id: &str) -> Result<Value> {
    db::exec(db,"UPDATE auth_tokens SET consumed=true WHERE kind='invite' AND data->>'orgId'=$1 AND digest=$2",vec![org.into(),id.into()]).await?;
    Ok(ok())
}
