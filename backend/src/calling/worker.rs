use super::dispatch;
use crate::{
    config::App,
    db,
    error::{Error, Result},
};
use std::time::Duration;
pub async fn tick(app: &App, client: &reqwest::Client, base: &str, key: &str) -> Result<()> {
    // Reconcile ambiguous submissions before claiming new work. Never guess from a timeout.
    let pending=db::rows(&app.db,"SELECT id FROM attempts WHERE status IN ('reserved','uncertain') AND lease_until<now() ORDER BY created_at LIMIT 1",vec![]).await?;
    if let Some(row) = pending.first() {
        let id: String = db::get(row, "id")?;
        if let Ok(response) = client
            .get(format!("{base}/calls/{id}"))
            .bearer_auth(key)
            .send()
            .await
        {
            if response.status().is_success() {
                let value: serde_json::Value = response
                    .json()
                    .await
                    .map_err(|_| Error(502, "Invalid provider response".into()))?;
                if let Some(provider) = value["provider_id"].as_str() {
                    dispatch::accepted(&app.db, &id, provider).await?;
                }
            }
        }
        return Ok(());
    }
    let Some(claim) = dispatch::claim(&app.db).await? else {
        return Ok(());
    };
    let response = client
        .post(format!("{base}/calls"))
        .bearer_auth(key)
        .header("Idempotency-Key", &claim.id)
        .json(
            &serde_json::json!({"attempt_id":claim.id,"org_id":claim.org,"event_id":claim.event,
    "participant_id":claim.participant,"phone":claim.phone,"lang_code":claim.language}),
        )
        .send()
        .await;
    match response {
        Ok(response) if response.status().is_success() => {
            match response.json::<serde_json::Value>().await {
                Ok(value) if value["provider_id"].as_str().is_some() => {
                    dispatch::accepted(&app.db, &claim.id, value["provider_id"].as_str().unwrap())
                        .await?
                }
                _ => dispatch::uncertain(&app.db, &claim.id).await?,
            }
        }
        _ => dispatch::uncertain(&app.db, &claim.id).await?,
    }
    Ok(())
}
pub async fn run(app: App) -> Result<()> {
    if std::env::var("CALLING_ENABLED").as_deref() != Ok("true") {
        return Err(Error(503, "Calling must be explicitly enabled".into()));
    }
    let base =
        std::env::var("PROVIDER_URL").map_err(|_| Error(503, "Provider URL required".into()))?;
    let key = std::env::var("PROVIDER_TOKEN")
        .map_err(|_| Error(503, "Provider token required".into()))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| Error(503, "Provider client unavailable".into()))?;
    let mut stop = Box::pin(tokio::signal::ctrl_c());
    loop {
        tokio::select! {
         _=&mut stop=>break,
         _=tokio::time::sleep(Duration::from_secs(1))=>{
          if let Err(error)=tick(&app,&client,&base,&key).await {eprintln!("worker: {}",error.1);}
         }
        }
    }
    Ok(())
}
