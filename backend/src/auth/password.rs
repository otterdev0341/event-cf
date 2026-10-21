use crate::{
    config::App,
    error::{Error, Result},
};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
pub fn secret() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub async fn password(app: &App, input: String, existing: Option<String>) -> Result<String> {
    if input.len() < 8 || input.len() > 256 {
        return Err(Error(422, "Password must be 8–256 bytes".into()));
    }
    let permit = app
        .hashing
        .clone()
        .try_acquire_owned()
        .map_err(|_| Error(429, "Try again shortly".into()))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if let Some(hash) = existing {
            let parsed =
                PasswordHash::new(&hash).map_err(|_| Error(401, "Invalid credentials".into()))?;
            Argon2::default()
                .verify_password(input.as_bytes(), &parsed)
                .map_err(|_| Error(401, "Invalid credentials".into()))?;
            Ok(hash)
        } else {
            Argon2::default()
                .hash_password(input.as_bytes(), &SaltString::generate(&mut OsRng))
                .map(|h| h.to_string())
                .map_err(|_| Error(503, "Password service unavailable".into()))
        }
    })
    .await
    .map_err(|_| Error(503, "Password service unavailable".into()))?
}
