use crate::error::{Result, bad};
use serde::{Deserialize, Serialize};
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInput {
    pub name: String,
    pub code: String,
    pub date: String,
    pub location: String,
    pub description: String,
}
impl EventInput {
    pub fn validate(&self) -> Result<()> {
        if self.name.trim().is_empty()
            || self.name.len() > 150
            || self.location.trim().is_empty()
            || self.location.len() > 250
            || self.description.len() > 4000
            || !(2..=40).contains(&self.code.len())
            || !self
                .code
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
            || chrono::NaiveDate::parse_from_str(&self.date, "%Y-%m-%d").is_err()
        {
            return Err(bad("Invalid event fields"));
        }
        Ok(())
    }
}
