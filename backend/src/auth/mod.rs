use ntex::http::HttpMessage;
pub mod password;
use crate::{
    config::App,
    db,
    error::{Error, Result, denied},
};
use ntex::web::HttpRequest;
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
#[derive(Clone)]
pub struct User {
    pub id: String,
    pub root: bool,
}
pub async fn user(app: &App, req: &HttpRequest) -> Result<User> {
    let token = req
        .cookie("event_confirm_session")
        .ok_or(Error(401, "Login required".into()))?;
    let row = db::one(&app.db, "SELECT u.id,u.root FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.digest=$1 AND s.expires_at>now()",
        vec![password::digest(token.value()).into()]).await.map_err(|_| Error(401,"Session expired".into()))?;
    Ok(User {
        id: db::get(&row, "id")?,
        root: db::get(&row, "root")?,
    })
}
pub async fn scope(
    db: &impl ConnectionTrait,
    user: &User,
    org: &str,
    event: Option<&str>,
    write: bool,
    admin: bool,
) -> Result<()> {
    if user.root {
        return Ok(());
    }
    let row = db::one(
        db,
        "SELECT role,event_ids FROM memberships WHERE org_id=$1 AND user_id=$2",
        vec![org.into(), user.id.clone().into()],
    )
    .await
    .map_err(|_| denied())?;
    let role: String = db::get(&row, "role")?;
    let grants: Value = db::get(&row, "event_ids")?;
    if role == "org_admin" {
        return Ok(());
    }
    if admin || (write && role != "event_admin") {
        return Err(denied());
    }
    if let Some(event) = event {
        if !grants
            .as_array()
            .is_some_and(|ids| ids.iter().any(|id| id == event))
        {
            return Err(denied());
        }
    } else if write {
        return Err(denied());
    }
    Ok(())
}
pub async fn profile(db: &impl ConnectionTrait, user: &User) -> Result<Value> {
    let row = db::one(
        db,
        "SELECT name,email FROM users WHERE id=$1",
        vec![user.id.clone().into()],
    )
    .await?;
    let orgs = db::rows(db,"SELECT o.id,o.name,m.role,m.event_ids FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=$1",vec![user.id.clone().into()]).await?;
    let orgs: Result<Vec<Value>> = orgs
        .iter()
        .map(|r| {
            Ok(json!({
                "id":db::get::<String>(r,"id")?, "name":db::get::<String>(r,"name")?,
                "role":db::get::<String>(r,"role")?, "eventIds":db::get::<Value>(r,"event_ids")?
            }))
        })
        .collect();
    Ok(
        json!({"user":{"id":user.id,"name":db::get::<String>(&row,"name")?,
        "email":db::get::<String>(&row,"email")?,"platformRole":if user.root { Some("root") } else { None }},
        "organizations":orgs?}),
    )
}
pub async fn login(app: &App, body: Value) -> Result<(Value, String)> {
    #[derive(serde::Deserialize)]
    struct Login {
        email: String,
        password: String,
    }
    let input: Login = serde_json::from_value(body)?;
    let email = input.email.trim().to_lowercase();
    let limit = db::one(&app.db, "INSERT INTO auth_limits(key,count) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN auth_limits.started_at<now()-interval '15 minutes' THEN 1 ELSE auth_limits.count+1 END, started_at=CASE WHEN auth_limits.started_at<now()-interval '15 minutes' THEN now() ELSE auth_limits.started_at END RETURNING count", vec![password::digest(&email).into()]).await?;
    if db::get::<i32>(&limit, "count")? > 20 {
        return Err(Error(429, "Try again later".into()));
    }
    let record = db::rows(
        &app.db,
        "SELECT id,password_hash,root FROM users WHERE email=$1",
        vec![email.into()],
    )
    .await?;
    let Some(row) = record.first() else {
        // Run the same bounded work even for an unknown account.
        password::password(app, input.password, None).await?;
        return Err(Error(401, "Invalid credentials".into()));
    };
    password::password(app, input.password, Some(db::get(row, "password_hash")?)).await?;
    let user = User {
        id: db::get(row, "id")?,
        root: db::get(row, "root")?,
    };
    let token = password::secret();
    db::exec(
        &app.db,
        "INSERT INTO sessions(digest,user_id) VALUES($1,$2)",
        vec![password::digest(&token).into(), user.id.clone().into()],
    )
    .await?;
    Ok((profile(&app.db, &user).await?, token))
}
pub async fn seed(app: &App) -> Result<()> {
    let (Ok(email), Ok(pass)) = (
        std::env::var("SEED_ADMIN_EMAIL"),
        std::env::var("SEED_ADMIN_PASSWORD"),
    ) else {
        return Ok(());
    };
    let hash = password::password(app, pass, None).await?;
    db::exec(&app.db,"INSERT INTO users(id,email,name,password_hash,root) VALUES($1,$2,'Administrator',$3,true) ON CONFLICT(email) DO NOTHING",
        vec![uuid::Uuid::new_v4().to_string().into(),email.to_lowercase().into(),hash.into()]).await?;
    Ok(())
}

pub mod invitations;
pub mod mailer;
pub mod tokens;
