use crate::{
    auth::{self, User},
    db,
    error::{Result, bad, missing},
};
use sea_orm::ConnectionTrait;
use serde_json::Value;
pub async fn browser(
    db: &impl ConnectionTrait,
    user: &User,
    path: &str,
    method: &str,
    body: Value,
) -> Result<Value> {
    if path == "/invitations/accept" && method == "POST" {
        return crate::auth::tokens::accept(db, user, body).await;
    }
    if path == "/organizations" && method == "POST" {
        return crate::organizations::create(db, user, body).await;
    }
    let owned = segments(path)?;
    let p: Vec<&str> = owned.iter().map(String::as_str).collect();
    if p.len() < 3 || p[0] != "orgs" {
        return Err(missing());
    }
    let org = p[1];
    db::one(
        db,
        "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
        vec![org.into()],
    )
    .await?;
    auth::scope(db, user, org, None, false, false).await?;
    if p[2] == "members" {
        return crate::organizations::members(db, user, org, p.get(3).copied(), method, body).await;
    }
    if p[2] == "check-pair" && method == "POST" {
        auth::scope(db, user, org, None, true, true).await?;
        return crate::credentials::check_ids(db, org, body).await;
    }
    if p[2] == "credentials" {
        auth::scope(db, user, org, None, true, true).await?;
        return crate::credentials::handle(db, org, &p[3..], method, body).await;
    }
    if p[2] != "events" {
        return Err(missing());
    }
    let event = p.get(3).copied();
    auth::scope(
        db,
        user,
        org,
        event,
        method != "GET" && p.get(4) != Some(&"tickets"),
        false,
    )
    .await?;
    if let Some(event) = event {
        db::one(
            db,
            "SELECT id FROM events WHERE org_id=$1 AND id=$2",
            vec![org.into(), event.into()],
        )
        .await?;
    }
    let value = if p.len() <= 4 {
        crate::events::handle(db, org, event, method, body).await?
    } else {
        match p[4] {
            "participants" | "imports" | "queue-state" | "queue-policy" | "runs" => {
                crate::calling::handle(db, org, event.unwrap(), &p[4..], method, body).await?
            }
            "tickets" => {
                crate::tickets::handle(db, org, event.unwrap(), p.get(5).copied(), method, body)
                    .await?
            }
            _ => crate::knowledge::handle(db, org, event.unwrap(), &p[4..], method, body).await?,
        }
    };
    if method == "GET" && event.is_none() && !user.root {
        let role = db::one(
            db,
            "SELECT role,event_ids FROM memberships WHERE org_id=$1 AND user_id=$2",
            vec![org.into(), user.id.clone().into()],
        )
        .await?;
        let grants: Value = db::get(&role, "event_ids")?;
        if db::get::<String>(&role, "role")? != "org_admin" {
            return Ok(Value::Array(
                value
                    .as_array()
                    .ok_or_else(|| bad("Invalid event list"))?
                    .iter()
                    .filter(|e| grants.as_array().unwrap().contains(&e["id"]))
                    .cloned()
                    .collect(),
            ));
        }
    }
    Ok(value)
}
pub async fn agent(
    db: &impl ConnectionTrait,
    path: &str,
    method: &str,
    body: Value,
    org_key: &str,
    event_key: &str,
) -> Result<Value> {
    let owned = segments(path)?;
    let p: Vec<&str> = owned.iter().map(String::as_str).collect();
    if p.len() < 6 || p[0] != "agent" || p[1] != "orgs" || p[3] != "events" {
        return Err(missing());
    }
    let org = p[2];
    let event = p[4];
    db::one(
        db,
        "SELECT id FROM organizations WHERE id=$1 FOR UPDATE",
        vec![org.into()],
    )
    .await?;
    let scope = match (p[5], method) {
        ("knowledge", "GET") => "knowledge:read",
        ("tickets", "POST") => "tickets:create",
        ("participants", "GET") => "calls:read",
        ("runs", "POST") => "calls:create",
        ("calls", "POST") if p.len() == 8 && p[7] == "result" => "calls:result",
        _ => return Err(missing()),
    };
    crate::credentials::pair(db, org, event, org_key, event_key, scope).await?;
    match p[5] {
        "knowledge" => {
            let row = db::one(
                db,
                "SELECT data FROM knowledge WHERE org_id=$1 AND event_id=$2",
                vec![org.into(), event.into()],
            )
            .await?;
            Ok(db::get::<Value>(&row, "data")?["published"].clone())
        }
        "participants" | "runs" => {
            crate::calling::handle(db, org, event, &p[5..], method, body).await
        }
        "tickets" => crate::tickets::handle(db, org, event, None, method, body).await,
        "calls" => crate::calling::results::apply(db, org, event, p[6], body).await,
        _ => Err(missing()),
    }
}

pub fn segments(path: &str) -> Result<Vec<String>> {
    path.split('/')
        .filter(|s| !s.is_empty())
        .map(|s| {
            percent_encoding::percent_decode_str(s)
                .decode_utf8()
                .map(|v| v.into_owned())
                .map_err(|_| bad("Invalid path encoding"))
        })
        .collect()
}
