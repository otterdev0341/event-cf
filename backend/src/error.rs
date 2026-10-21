use serde_json::{Value, json};
#[derive(Debug)]
pub struct Error(pub u16, pub String);
pub type Result<T> = std::result::Result<T, Error>;
impl From<sea_orm::DbErr> for Error {
    fn from(error: sea_orm::DbErr) -> Self {
        if matches!(
            error.sql_err(),
            Some(sea_orm::SqlErr::UniqueConstraintViolation(_))
        ) {
            Self(409, "Duplicate or concurrent update".into())
        } else {
            eprintln!("database operation failed: {error}");
            Self(503, "Database unavailable".into())
        }
    }
}
impl From<serde_json::Error> for Error {
    fn from(_: serde_json::Error) -> Self {
        Self(422, "Invalid input".into())
    }
}
pub fn bad(message: &str) -> Error {
    Error(422, message.into())
}
pub fn denied() -> Error {
    Error(403, "Access denied".into())
}
pub fn missing() -> Error {
    Error(404, "Not found".into())
}
pub fn conflict() -> Error {
    Error(409, "Stale version or operation in progress".into())
}
pub fn ok() -> Value {
    json!({"ok":true})
}
