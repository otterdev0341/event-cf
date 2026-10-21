use crate::{
    auth::password,
    db,
    error::{Result, bad, denied, missing, ok},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
const SCOPES: [&str; 5] = [
    "knowledge:read",
    "tickets:create",
    "calls:read",
    "calls:create",
    "calls:result",
];
pub async fn handle(
    db: &impl ConnectionTrait,
    org: &str,
    tail: &[&str],
    method: &str,
    body: Value,
) -> Result<Value> {
    if method == "GET" && tail.is_empty() {
        let rows = db::rows(
            db,
            "SELECT data FROM credentials WHERE org_id=$1 ORDER BY id",
            vec![org.into()],
        )
        .await?;
        return Ok(Value::Array(
            rows.iter()
                .map(|r| db::get(r, "data"))
                .collect::<Result<_>>()?,
        ));
    }
    if method != "POST" {
        return Err(missing());
    }
    if tail.len() == 2 {
        let row = db::one(
            db,
            "SELECT data FROM credentials WHERE org_id=$1 AND id=$2 FOR UPDATE",
            vec![org.into(), tail[0].into()],
        )
        .await?;
        let data: Value = db::get(&row, "data")?;
        if data["status"] == "revoked" {
            return Err(bad("Credential already revoked"));
        }
        if !["rotate", "revoke"].contains(&tail[1]) {
            return Err(missing());
        }
        db::exec(db,"UPDATE credentials SET revoked=true,data=jsonb_set(data,'{status}','\"revoked\"') WHERE org_id=$1 AND (id=$2 OR parent_id=$2)",vec![org.into(),tail[0].into()]).await?;
        return if tail[1] == "rotate" {
            issue(db, org, data).await
        } else {
            Ok(ok())
        };
    }
    if tail.is_empty() {
        return issue(db, org, body).await;
    }
    Err(missing())
}
async fn issue(db: &impl ConnectionTrait, org: &str, body: Value) -> Result<Value> {
    let name = body["name"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 100)
        .ok_or_else(|| bad("Name required"))?;
    let kind = body["kind"]
        .as_str()
        .filter(|s| ["org", "event"].contains(s))
        .ok_or_else(|| bad("Invalid credential type"))?;
    let scopes: Vec<String> = serde_json::from_value(body["scopes"].clone())?;
    if scopes.is_empty() || scopes.iter().any(|s| !SCOPES.contains(&s.as_str())) {
        return Err(bad("Invalid scopes"));
    }
    let expiry = body["expiresAt"]
        .as_str()
        .ok_or_else(|| bad("Expiry required"))?;
    let date = chrono::NaiveDate::parse_from_str(&expiry[..expiry.len().min(10)], "%Y-%m-%d")
        .map_err(|_| bad("Invalid expiry"))?;
    let expires = date.and_hms_opt(23, 59, 59).unwrap().and_utc();
    if expires <= chrono::Utc::now() {
        return Err(bad("Expiry must be in the future"));
    }
    let event = body["eventId"].as_str();
    let parent = body["parentId"].as_str();
    if kind == "event" {
        let (event, parent) = (
            event.ok_or_else(|| bad("Event required"))?,
            parent.ok_or_else(|| bad("Parent required"))?,
        );
        db::one(
            db,
            "SELECT id FROM events WHERE org_id=$1 AND id=$2",
            vec![org.into(), event.into()],
        )
        .await?;
        let row=db::one(db,"SELECT data,expires_at FROM credentials WHERE org_id=$1 AND id=$2 AND event_id IS NULL AND revoked=false AND expires_at>now()",vec![org.into(),parent.into()]).await?;
        let parent_data: Value = db::get(&row, "data")?;
        if scopes.iter().any(|s| {
            !parent_data["scopes"]
                .as_array()
                .unwrap()
                .contains(&json!(s))
        }) || expires > db::get::<chrono::DateTime<chrono::Utc>>(&row, "expires_at")?
        {
            return Err(bad("Scopes and expiry must be within parent"));
        }
    } else if event.is_some() || parent.is_some() {
        return Err(bad("Org credential cannot have event or parent"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let secret = password::secret();
    let data = json!({"id":id,"name":name,"kind":kind,"eventId":event,"parentId":parent,"prefix":&secret[..8],
  "scopes":scopes,"expiresAt":expiry,"status":"active"});
    db::exec(db,"INSERT INTO credentials(id,org_id,event_id,parent_id,digest,data,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
  vec![id.into(),org.into(),event.map(String::from).into(),parent.map(String::from).into(),password::digest(&secret).into(),data.clone().into(),expires.into()]).await?;
    Ok(json!({"credential":data,"secret":secret}))
}
pub async fn pair(
    db: &impl ConnectionTrait,
    org: &str,
    event: &str,
    org_key: &str,
    event_key: &str,
    scope: &str,
) -> Result<()> {
    let rows=db::rows(db,"SELECT id,parent_id,event_id,data,digest FROM credentials WHERE org_id=$1 AND digest IN ($2,$3) AND revoked=false AND expires_at>now()",vec![org.into(),password::digest(org_key).into(),password::digest(event_key).into()]).await?;
    if rows.len() != 2 {
        return Err(denied());
    }
    let parent = rows
        .iter()
        .find(|r| db::get::<Option<String>>(r, "event_id").ok() == Some(None))
        .ok_or_else(denied)?;
    let child = rows
        .iter()
        .find(|r| db::get::<Option<String>>(r, "event_id").ok() == Some(Some(event.into())))
        .ok_or_else(denied)?;
    if db::get::<Option<String>>(child, "parent_id")? != Some(db::get(parent, "id")?) {
        return Err(denied());
    }
    if db::get::<String>(parent, "digest")? != password::digest(org_key)
        || db::get::<String>(child, "digest")? != password::digest(event_key)
    {
        return Err(denied());
    }
    for row in [parent, child] {
        let data: Value = db::get(row, "data")?;
        if !data["scopes"].as_array().unwrap().contains(&json!(scope)) {
            return Err(denied());
        }
    }
    Ok(())
}

pub async fn check_ids(db: &impl ConnectionTrait, org: &str, body: Value) -> Result<Value> {
    let org_id = body["orgKeyId"]
        .as_str()
        .ok_or_else(|| bad("Org key ID required"))?;
    let event_id = body["eventKeyId"]
        .as_str()
        .ok_or_else(|| bad("Event key ID required"))?;
    let event = body["eventId"]
        .as_str()
        .ok_or_else(|| bad("Event required"))?;
    db::one(db,"SELECT c.id FROM credentials c JOIN credentials p ON p.id=c.parent_id WHERE c.org_id=$1 AND p.org_id=$1 AND p.id=$2 AND c.id=$3 AND c.event_id=$4 AND p.event_id IS NULL AND NOT c.revoked AND NOT p.revoked AND c.expires_at>now() AND p.expires_at>now()",vec![org.into(),org_id.into(),event_id.into(),event.into()]).await.map_err(|_|denied())?;
    Ok(ok())
}
