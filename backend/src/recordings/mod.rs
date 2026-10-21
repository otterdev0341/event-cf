pub mod provider;
use crate::{
    auth,
    config::App,
    db,
    error::{Error, Result, missing},
};
use ntex::web::{HttpRequest, HttpResponse};
use serde_json::json;
use tokio::sync::Semaphore;
static READERS: Semaphore = Semaphore::const_new(2);

// Recording I/O deliberately runs outside browser mutation transactions.
pub async fn route(req: &HttpRequest, app: &App) -> Option<Result<HttpResponse>> {
    let path = req.path().strip_prefix("/event-confirm/api/v1/")?;
    let (agent, path) = path
        .strip_prefix("agent/")
        .map_or((false, path), |p| (true, p));
    let p: Vec<&str> = path.split('/').collect();
    if p.len() < 7 || p[0] != "orgs" || p[2] != "events" || p[4] != "calls" || p[6] != "recording" {
        return None;
    }
    Some(serve(req, app, &p, agent).await)
}
async fn serve(req: &HttpRequest, app: &App, p: &[&str], agent: bool) -> Result<HttpResponse> {
    if req.method().as_str() != "GET" {
        return Err(Error(405, "Method not allowed".into()));
    }
    let audio = p.len() == 8 && p[7] == "audio";
    if p.len() != 7 && !audio {
        return Err(missing());
    }
    let (org, event, attempt) = (p[1], p[3], p[5]);
    if agent {
        let header = |name: &str| {
            req.headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .ok_or(Error(401, "Agent credential pair required".into()))
        };
        crate::credentials::pair(
            &app.db,
            org,
            event,
            header("X-Org-Credential")?,
            header("X-Event-Credential")?,
            "calls:read",
        )
        .await?;
    } else {
        let user = auth::user(app, req).await?;
        auth::scope(&app.db, &user, org, Some(event), false, false).await?;
    }
    let row = db::one(
        &app.db,
        "SELECT status,provider_id FROM attempts WHERE org_id=$1 AND event_id=$2 AND id=$3",
        vec![org.into(), event.into(), attempt.into()],
    )
    .await?;
    if db::get::<String>(&row, "status")? != "completed" {
        return state("pending", audio);
    }
    let provider_id: Option<String> = db::get(&row, "provider_id")?;
    let (Some(provider_id), Ok(base), Ok(token)) = (
        provider_id,
        std::env::var("RECORDING_PROVIDER_URL"),
        std::env::var("PROVIDER_TOKEN"),
    ) else {
        return state("not_available", audio);
    };
    let _permit = READERS
        .try_acquire()
        .map_err(|_| Error(429, "Recording service busy".into()))?;
    let provider = provider::Provider::new(&base, token)?;
    // Metadata/audio together have a fixed deadline and at most two bounded buffers.
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let Some(metadata) = provider.metadata(attempt, &provider_id).await? else {
            return state("not_available", audio);
        };
        if audio {
            let bytes = provider.audio(&metadata).await?;
            Ok(HttpResponse::Ok()
                .header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Type", metadata.content_type)
                .header("Content-Disposition", "inline; filename=recording")
                .body(bytes))
        } else {
            Ok(HttpResponse::Ok()
                .header("Cache-Control", "no-store")
                .json(&json!({"state":"available",
                "playbackPath":format!("{}/audio",req.path()),"simulated":metadata.simulated})))
        }
    })
    .await
    .map_err(|_| Error(504, "Recording provider deadline exceeded".into()))?
}
fn state(value: &str, audio: bool) -> Result<HttpResponse> {
    if audio {
        return Err(missing());
    }
    Ok(HttpResponse::Ok()
        .header("Cache-Control", "no-store")
        .json(&json!({"state":value})))
}
