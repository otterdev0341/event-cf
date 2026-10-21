use crate::error::{Error, Result};
use serde::Deserialize;
use std::time::Duration;
#[derive(Deserialize)]
pub struct Metadata {
    pub attempt_id: String,
    pub provider_id: String,
    pub recording_id: String,
    pub content_type: String,
    pub simulated: bool,
}
pub struct Provider {
    client: reqwest::Client,
    base: reqwest::Url,
    token: String,
}
fn upstream() -> Error {
    Error(
        502,
        "Recording provider unavailable or invalid response".into(),
    )
}
impl Provider {
    pub fn new(base: &str, token: String) -> Result<Self> {
        let base = reqwest::Url::parse(base).map_err(|_| upstream())?;
        if !["http", "https"].contains(&base.scheme())
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            return Err(upstream());
        }
        Ok(Self {
            base,
            token,
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(10))
                .connect_timeout(Duration::from_secs(3))
                .build()
                .map_err(|_| upstream())?,
        })
    }
    async fn get(&self, attempt: &str, audio: bool) -> Result<reqwest::Response> {
        let mut url = self.base.clone();
        url.path_segments_mut()
            .map_err(|_| upstream())?
            .pop_if_empty()
            .push("recordings")
            .push(attempt);
        if audio {
            url.path_segments_mut()
                .map_err(|_| upstream())?
                .push("audio");
        }
        self.client
            .get(url)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|_| upstream())
    }
    pub async fn metadata(&self, attempt: &str, provider: &str) -> Result<Option<Metadata>> {
        let response = self.get(attempt, false).await?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if response.status() != reqwest::StatusCode::OK {
            return Err(upstream());
        }
        let bytes = bounded(response, 16384).await?;
        let value: Metadata = serde_json::from_slice(&bytes).map_err(|_| upstream())?;
        if value.attempt_id != attempt
            || value.provider_id != provider
            || value.recording_id.is_empty()
            || value.recording_id.len() > 256
            || ![
                "audio/wav",
                "audio/mpeg",
                "audio/ogg",
                "audio/webm",
                "audio/mp4",
            ]
            .contains(&value.content_type.as_str())
        {
            return Err(upstream());
        }
        Ok(Some(value))
    }
    pub async fn audio(&self, metadata: &Metadata) -> Result<Vec<u8>> {
        let response = self.get(&metadata.attempt_id, true).await?;
        if response.status() != reqwest::StatusCode::OK {
            return Err(upstream());
        }
        for (name, expected) in [
            ("x-attempt-id", &metadata.attempt_id),
            ("x-provider-id", &metadata.provider_id),
            ("x-recording-id", &metadata.recording_id),
            ("content-type", &metadata.content_type),
        ] {
            if response.headers().get(name).and_then(|v| v.to_str().ok()) != Some(expected.as_str())
            {
                return Err(upstream());
            }
        }
        bounded(response, 8 * 1024 * 1024).await
    }
}
async fn bounded(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(upstream());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| upstream())? {
        if bytes.len() + chunk.len() > limit {
            return Err(upstream());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
