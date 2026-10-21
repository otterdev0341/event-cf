use crate::{
    db,
    error::{Result, missing},
};
use sea_orm::ConnectionTrait;
use serde_json::Value;
pub async fn handle(
    db: &impl ConnectionTrait,
    path: &str,
    method: &str,
    body: Value,
    org_key: &str,
    event_key: &str,
) -> Result<Value> {
    let owned = crate::routes::segments(path)?;
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
        ("knowledge" | "categories", "GET") => "knowledge:read",
        ("event", "GET") => "events:read",
        ("runs", "GET") => "calls:read",
        ("tickets", "POST") => "tickets:create",
        ("participants", "GET") => "calls:read",
        ("runs", "POST") => "calls:create",
        ("calls", "POST") if p.len() == 8 && p[7] == "result" => "calls:result",
        _ => return Err(missing()),
    };
    crate::credentials::pair(db, org, event, org_key, event_key, scope).await?;
    match p[5] {
        "event" => crate::events::handle(db, org, Some(event), "GET", body).await,
        "runs" if method == "GET" => crate::calling::policy::state(db, org, event).await,
        "knowledge" | "categories" => {
            let row = db::one(
                db,
                "SELECT data FROM knowledge WHERE org_id=$1 AND event_id=$2",
                vec![org.into(), event.into()],
            )
            .await?;
            let published = db::get::<Value>(&row, "data")?["published"].clone();
            if p[5] == "categories" {
                let names: std::collections::BTreeSet<String> = published
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|faq| faq["category"].as_str().map(String::from))
                    .collect();
                return Ok(serde_json::json!(names));
            }
            Ok(published)
        }
        "participants" | "runs" => {
            crate::calling::handle(db, org, event, &p[5..], method, body).await
        }
        "tickets" => crate::tickets::handle(db, org, event, None, method, body).await,
        "calls" => {
            if body.get("ticket").is_some() {
                crate::credentials::pair(db, org, event, org_key, event_key, "tickets:create")
                    .await?;
            }
            crate::calling::results::apply(db, org, event, p[6], body).await
        }
        _ => Err(missing()),
    }
}
