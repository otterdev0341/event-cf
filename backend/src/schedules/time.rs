use crate::error::{Result, bad};
use chrono::{DateTime, Datelike, Days, FixedOffset, NaiveDate, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub date: String,
    pub time: String,
    pub recurrence: String,
    pub weekdays: Vec<u32>,
    pub redial: bool,
    pub participant_ids: Vec<String>,
    pub expected_event_version: i32,
    pub consent: bool,
}
impl Rule {
    pub fn next(&self, after: DateTime<Utc>) -> Result<DateTime<Utc>> {
        let zone = FixedOffset::east_opt(7 * 3600).unwrap();
        let first = NaiveDate::parse_from_str(&self.date, "%Y-%m-%d")
            .map_err(|_| bad("Invalid schedule date"))?;
        let time = NaiveTime::parse_from_str(&self.time, "%H:%M")
            .map_err(|_| bad("Invalid schedule time"))?;
        if !self.consent
            || self.participant_ids.is_empty()
            || self.participant_ids.len() > 5000
            || self.weekdays.iter().any(|day| *day > 6)
            || self
                .weekdays
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.weekdays.len()
            || self
                .participant_ids
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != self.participant_ids.len()
            || !["once", "daily", "weekly"].contains(&self.recurrence.as_str())
            || (self.recurrence == "weekly" && self.weekdays.is_empty())
        {
            return Err(bad("Invalid schedule or missing explicit consent"));
        }
        let start = if self.recurrence == "once" {
            first
        } else {
            first.max(after.with_timezone(&zone).date_naive())
        };
        for offset in 0..=7 {
            if self.recurrence == "once" && offset != 0 {
                break;
            }
            let date = start
                .checked_add_days(Days::new(offset))
                .ok_or_else(|| bad("Date out of range"))?;
            if self.recurrence == "weekly"
                && !self
                    .weekdays
                    .contains(&date.weekday().num_days_from_sunday())
            {
                continue;
            }
            let at = zone
                .from_local_datetime(&date.and_time(time))
                .single()
                .unwrap()
                .with_timezone(&Utc);
            if at > after {
                return Ok(at);
            }
        }
        Err(bad("Schedule must be in the future"))
    }
}
