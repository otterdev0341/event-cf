use super::{User, password};
use crate::{
    config::App,
    db,
    error::{Result, bad, denied, ok},
};
use sea_orm::{ConnectionTrait, TransactionTrait};
use serde_json::{Value, json};
pub async fn issue(
    db: &impl ConnectionTrait,
    origin: &str,
    kind: &str,
    email: &str,
    data: Value,
) -> Result<()> {
    let token = password::secret();
    db::exec(db,"UPDATE auth_tokens SET consumed=true WHERE kind=$1 AND email=$2 AND data->>'orgId' IS NOT DISTINCT FROM $3",
  vec![kind.into(),email.into(),data["orgId"].as_str().map(String::from).into()]).await?;
    db::exec(
        db,
        "INSERT INTO auth_tokens(digest,kind,email,data) VALUES($1,$2,$3,$4)",
        vec![
            password::digest(&token).into(),
            kind.into(),
            email.into(),
            data.clone().into(),
        ],
    )
    .await?;
    let url = if kind == "reset" || data["signup"] == true {
        format!("{origin}/event-confirm/reset-password?token={token}")
    } else {
        format!("{origin}/event-confirm/organizations?invite={token}")
    };
    let payload = json!({"template":kind,"url":url});
    db::exec(
        db,
        "INSERT INTO mail_outbox(id,recipient,payload) VALUES($1,$2,$3)",
        vec![
            uuid::Uuid::new_v4().to_string().into(),
            email.into(),
            payload.into(),
        ],
    )
    .await?;
    Ok(())
}
pub async fn reset(app: &App, body: Value) -> Result<Value> {
    let email = body["email"]
        .as_str()
        .filter(|s| s.len() <= 254 && s.contains('@'))
        .ok_or_else(|| bad("Invalid email"))?
        .trim()
        .to_lowercase();
    let tx = app.db.begin().await?;
    let found = db::rows(
        &tx,
        "SELECT id FROM users WHERE email=$1",
        vec![email.clone().into()],
    )
    .await?;
    if let Some(row) = found.first() {
        issue(
            &tx,
            &app.origin,
            "reset",
            &email,
            json!({"userId":db::get::<String>(row,"id")?}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(json!({"ok":true,"message":"If the account exists, a reset request has been queued."}))
}
pub async fn complete(app: &App, body: Value) -> Result<Value> {
    let token = body["token"]
        .as_str()
        .filter(|s| s.len() == 64)
        .ok_or_else(|| bad("Invalid reset token"))?;
    // Hash before acquiring a transaction; bounded CPU work never holds database locks.
    let input = body["password"]
        .as_str()
        .ok_or_else(|| bad("Password required"))?;
    let hash = password::password(app, input.into(), None).await?;
    let tx = app.db.begin().await?;
    let row=db::one(&tx,"SELECT data,kind FROM auth_tokens WHERE digest=$1 AND kind IN ('reset','invite') AND NOT consumed AND expires_at>now() FOR UPDATE",vec![password::digest(token).into()]).await?;
    let data: Value = db::get(&row, "data")?;
    let id = data["userId"]
        .as_str()
        .ok_or_else(|| bad("Invalid token"))?;
    if db::get::<String>(&row, "kind")? == "invite" {
        let current = db::one(
            &tx,
            "SELECT password_hash FROM users WHERE id=$1 FOR UPDATE",
            vec![id.into()],
        )
        .await?;
        if data["signup"] != true || db::get::<String>(&current, "password_hash")? != "!" {
            return Err(bad("Existing accounts must sign in to accept invitations"));
        }
        db::exec(
            &tx,
            "INSERT INTO memberships(org_id,user_id,role,event_ids) VALUES($1,$2,$3,$4)",
            vec![
                data["orgId"].as_str().unwrap().into(),
                id.into(),
                data["role"].as_str().unwrap().into(),
                data["eventIds"].clone().into(),
            ],
        )
        .await?;
    }
    db::exec(
        &tx,
        "UPDATE users SET password_hash=$1 WHERE id=$2",
        vec![hash.into(), id.into()],
    )
    .await?;
    db::exec(
        &tx,
        "DELETE FROM sessions WHERE user_id=$1",
        vec![id.into()],
    )
    .await?;
    db::exec(
        &tx,
        "UPDATE auth_tokens SET consumed=true WHERE digest=$1",
        vec![password::digest(token).into()],
    )
    .await?;
    tx.commit().await?;
    Ok(ok())
}
pub async fn accept(db: &impl ConnectionTrait, user: &User, body: Value) -> Result<Value> {
    let token = body["token"]
        .as_str()
        .ok_or_else(|| bad("Token required"))?;
    let row=db::one(db,"SELECT email,data FROM auth_tokens WHERE digest=$1 AND kind='invite' AND NOT consumed AND expires_at>now() FOR UPDATE",vec![password::digest(token).into()]).await?;
    let person = db::one(
        db,
        "SELECT email FROM users WHERE id=$1",
        vec![user.id.clone().into()],
    )
    .await?;
    if db::get::<String>(&row, "email")? != db::get::<String>(&person, "email")? {
        return Err(denied());
    }
    let data: Value = db::get(&row, "data")?;
    db::exec(db,"INSERT INTO memberships(org_id,user_id,role,event_ids) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,user_id) DO NOTHING",
  vec![data["orgId"].as_str().unwrap().into(),user.id.clone().into(),data["role"].as_str().unwrap().into(),data["eventIds"].clone().into()]).await?;
    db::exec(
        db,
        "UPDATE auth_tokens SET consumed=true WHERE digest=$1",
        vec![password::digest(token).into()],
    )
    .await?;
    super::profile(db, user).await
}
