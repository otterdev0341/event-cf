use crate::{
    auth::password,
    db,
    error::{Result, bad, conflict},
};
use sea_orm::ConnectionTrait;
use serde_json::Value;
pub async fn lookup(
    db: &impl ConnectionTrait,
    scope: &str,
    key: &str,
    body: &Value,
) -> Result<Option<Value>> {
    if key.is_empty() || key.len() > 128 {
        return Err(bad("Idempotency-Key of 1–128 bytes required"));
    }
    // Transaction advisory lock serializes this exact key across all API instances.
    db::exec(
        db,
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        vec![format!("{scope}:{key}").into()],
    )
    .await?;
    let rows = db::rows(
        db,
        "SELECT fingerprint,response FROM idempotency WHERE scope=$1 AND key=$2",
        vec![scope.into(), key.into()],
    )
    .await?;
    if let Some(row) = rows.first() {
        if db::get::<String>(row, "fingerprint")? != password::digest(&body.to_string()) {
            return Err(conflict());
        }
        return Ok(Some(db::get(row, "response")?));
    }
    Ok(None)
}
pub async fn save(
    db: &impl ConnectionTrait,
    scope: &str,
    key: &str,
    body: &Value,
    response: &Value,
) -> Result<()> {
    db::exec(
        db,
        "INSERT INTO idempotency(scope,key,fingerprint,response) VALUES($1,$2,$3,$4)",
        vec![
            scope.into(),
            key.into(),
            password::digest(&body.to_string()).into(),
            response.clone().into(),
        ],
    )
    .await?;
    Ok(())
}
