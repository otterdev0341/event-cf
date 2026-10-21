use crate::{
    auth,
    config::App,
    db,
    error::{Error, Result, bad, missing},
};
use ntex::http::HttpMessage;
use ntex::{
    http::StatusCode,
    web::{HttpRequest, HttpResponse},
};
use sea_orm::TransactionTrait;
use serde_json::{Value, json};
pub async fn health(req: HttpRequest) -> HttpResponse {
    let app = req.app_state::<App>().expect("configured application");
    match app.db.ping().await {
        Ok(()) => HttpResponse::Ok().json(&json!({"ok":true})),
        Err(_) => HttpResponse::ServiceUnavailable().body(""),
    }
}
pub async fn handle(req: HttpRequest, bytes: ntex::util::Bytes) -> HttpResponse {
    let app = req.app_state::<App>().expect("configured application");
    if let Some(result) = crate::recordings::route(&req, app).await {
        return match result {
            Ok(response) => response,
            Err(Error(code, message)) => HttpResponse::builder(
                StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            )
            .json(&json!({"message":message})),
        };
    }
    match dispatch(&req, &bytes, app).await {
        Ok((body, cookie)) => {
            let mut response = HttpResponse::Ok();
            response.header("Cache-Control", "no-store");
            if let Some(cookie) = cookie {
                response.header("Set-Cookie", cookie);
            }
            response.json(&body)
        }
        Err(Error(code, message)) => HttpResponse::builder(
            StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
        )
        .json(&json!({"message":message})),
    }
}
async fn dispatch(req: &HttpRequest, bytes: &[u8], app: &App) -> Result<(Value, Option<String>)> {
    let method = req.method().as_str();
    if !["GET", "POST", "PATCH", "DELETE"].contains(&method) {
        return Err(Error(405, "Method not allowed".into()));
    }
    let path = req
        .path()
        .strip_prefix("/event-confirm/api/v1")
        .ok_or_else(missing)?;
    let agent = path.starts_with("/agent/");
    if method != "GET" && !agent {
        if req
            .headers()
            .get("X-Requested-With")
            .and_then(|v| v.to_str().ok())
            != Some("EventConfirm")
        {
            return Err(Error(403, "CSRF header required".into()));
        }
        if let Some(origin) = req.headers().get("Origin") {
            if origin.to_str().ok() != Some(app.origin.as_str()) {
                return Err(Error(403, "Origin mismatch".into()));
            }
        }
    }
    let body: Value = if bytes.is_empty() {
        json!({})
    } else {
        {
            let permit = app
                .parsing
                .clone()
                .try_acquire_owned()
                .map_err(|_| Error(429, "Parser busy".into()))?;
            let bytes = bytes.to_vec();
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                serde_json::from_slice(&bytes)
            })
            .await
            .map_err(|_| Error(503, "Parser unavailable".into()))??
        }
    };
    let path = req
        .path()
        .strip_prefix("/event-confirm/api/v1")
        .ok_or_else(missing)?;
    if path == "/auth/login" && method == "POST" {
        let (profile, token) = auth::login(app, body).await?;
        return Ok((profile, Some(cookie(app, &token, 43200))));
    }
    if path == "/auth/reset" && method == "POST" {
        return Ok((auth::tokens::reset(app, body).await?, None));
    }
    if path == "/auth/reset/complete" && method == "POST" {
        return Ok((auth::tokens::complete(app, body).await?, None));
    }
    if agent {
        return agent_dispatch(req, app, path, method, body).await;
    }
    let user = auth::user(app, req).await?;
    if path == "/auth/session" && method == "GET" {
        return Ok((auth::profile(&app.db, &user).await?, None));
    }
    if path == "/auth/logout" && method == "POST" {
        if let Some(c) = req.cookie("event_confirm_session") {
            db::exec(
                &app.db,
                "DELETE FROM sessions WHERE digest=$1",
                vec![auth::password::digest(c.value()).into()],
            )
            .await?;
        }
        return Ok((json!({"ok":true}), Some(cookie(app, "", 0))));
    }
    let tx = app.db.begin().await?;
    db::exec(&tx, "SET LOCAL statement_timeout='5s'", vec![]).await?;
    db::exec(&tx, "SET LOCAL lock_timeout='3s'", vec![]).await?;
    let scope = format!("{}:{}:{}", user.id, method, path);
    let key = req
        .headers()
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok());
    let needs_key = method == "POST"
        && (path.ends_with("/commit")
            || path.ends_with("/runs")
            || path.ends_with("/tickets")
            || path.ends_with("/schedules")
            || path.ends_with("/knowledge-import"));
    if needs_key && key.is_none() {
        return Err(bad("Idempotency-Key required"));
    }
    if let Some(key) = key {
        if let Some(saved) = crate::idempotency::lookup(&tx, &scope, key, &body).await? {
            // Revalidate membership on every replay, including after revocation.
            let owned = crate::routes::segments(path)?;
            let parts: Vec<&str> = owned.iter().map(String::as_str).collect();
            if parts.first() == Some(&"orgs") {
                auth::scope(
                    &tx,
                    &user,
                    parts[1],
                    if parts.get(2) == Some(&"events") {
                        parts.get(3).copied()
                    } else {
                        None
                    },
                    false,
                    false,
                )
                .await?;
            }
            tx.commit().await?;
            return Ok((saved, None));
        }
    }
    let result = crate::routes::browser(&tx, &user, path, method, body.clone()).await?;
    if let Some(key) = key {
        crate::idempotency::save(&tx, &scope, key, &body, &result).await?;
    }
    tx.commit().await?;
    Ok((result, None))
}
fn cookie(app: &App, token: &str, age: i32) -> String {
    format!(
        "event_confirm_session={token}; Path=/event-confirm/; HttpOnly; SameSite=Lax; Max-Age={age}{}",
        if app.secure_cookie { "; Secure" } else { "" }
    )
}

async fn agent_dispatch(
    req: &HttpRequest,
    app: &App,
    path: &str,
    method: &str,
    body: Value,
) -> Result<(Value, Option<String>)> {
    let header = |name: &str| {
        req.headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .ok_or(Error(401, "Agent credential pair required".into()))
    };
    let org_key = header("X-Org-Credential")?;
    let event_key = header("X-Event-Credential")?;
    let tx = app.db.begin().await?;
    db::exec(&tx, "SET LOCAL statement_timeout='5s'", vec![]).await?;
    db::exec(&tx, "SET LOCAL lock_timeout='3s'", vec![]).await?;
    let scope = format!("agent:{}:{}", auth::password::digest(event_key), path);
    // Authorization must precede replay; route mutations and response are one transaction.
    let key = req
        .headers()
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok());
    if method == "POST" && key.is_none() {
        return Err(bad("Idempotency-Key required"));
    }
    let owned = crate::routes::segments(path)?;
    let p: Vec<&str> = owned.iter().map(String::as_str).collect();
    if p.len() < 6 {
        return Err(missing());
    }
    let permission = match p[5] {
        "tickets" => "tickets:create",
        "calls" => "calls:result",
        "participants" => "calls:read",
        "runs" if method == "GET" => "calls:read",
        "runs" => "calls:create",
        "event" => "events:read",
        _ => "knowledge:read",
    };
    crate::credentials::pair(&tx, p[2], p[4], org_key, event_key, permission).await?;
    if p[5] == "calls" && body.get("ticket").is_some() {
        crate::credentials::pair(&tx, p[2], p[4], org_key, event_key, "tickets:create").await?;
    }
    if let Some(key) = key {
        if let Some(saved) = crate::idempotency::lookup(&tx, &scope, key, &body).await? {
            tx.commit().await?;
            return Ok((saved, None));
        }
    }
    let result = crate::agent::handle(&tx, path, method, body.clone(), org_key, event_key).await?;
    if let Some(key) = key {
        crate::idempotency::save(&tx, &scope, key, &body, &result).await?;
    }
    tx.commit().await?;
    Ok((result, None))
}
