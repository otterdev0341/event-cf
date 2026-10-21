use crate::{
    db,
    error::{Result, bad, conflict, ok},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
#[derive(serde::Deserialize, serde::Serialize)]
pub struct Row {
    pub phone: String,
    pub first_name: String,
    pub last_name: String,
    pub nickname: String,
    pub event_code: String,
    pub event_date: String,
    pub lang_code: String,
}
fn normalize(phone: &str) -> Result<String> {
    let phone: String = phone
        .chars()
        .filter(|c| !c.is_whitespace() && !['-', '(', ')'].contains(c))
        .collect();
    let phone = if phone.starts_with('0') {
        format!("+66{}", &phone[1..])
    } else {
        phone
    };
    if !phone.starts_with('+')
        || !(9..=16).contains(&phone.len())
        || !phone[1..].bytes().all(|c| c.is_ascii_digit())
    {
        return Err(bad("Invalid phone"));
    }
    Ok(phone)
}
pub async fn preview(
    db: &impl ConnectionTrait,
    org: &str,
    event: &str,
    body: Value,
) -> Result<Value> {
    let rows: Vec<Row> = serde_json::from_value(body["rows"].clone())?;
    if rows.is_empty() || rows.len() > 1000 {
        return Err(bad("Upload requires 1–1000 rows"));
    }
    let metadata = db::one(
        db,
        "SELECT data FROM events WHERE org_id=$1 AND id=$2",
        vec![org.into(), event.into()],
    )
    .await?;
    let metadata: Value = db::get(&metadata, "data")?;
    let existing = db::rows(
        db,
        "SELECT phone FROM participants WHERE org_id=$1 AND event_id=$2",
        vec![org.into(), event.into()],
    )
    .await?;
    let mut phones = existing
        .iter()
        .map(|r| db::get::<String>(r, "phone"))
        .collect::<Result<Vec<_>>>()?;
    let mut errors = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let phone = normalize(&row.phone);
        if row.event_code != metadata["code"]
            || row.event_date != metadata["date"]
            || row.first_name.trim().is_empty()
            || row.last_name.trim().is_empty()
            || row.first_name.len() > 150
            || row.last_name.len() > 150
            || row.nickname.len() > 100
            || ![
                "th", "en", "ja", "zh", "ko", "vi", "id", "ms", "fr", "de", "es", "ar",
            ]
            .contains(&row.lang_code.as_str())
            || phone.is_err()
            || phone.as_ref().is_ok_and(|p| phones.contains(p))
        {
            errors.push(format!(
                "Row {}: invalid event, person, language or duplicate phone",
                i + 1
            ));
        }
        if let Ok(phone) = phone {
            phones.push(phone);
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let data = json!({"id":id,"rows":rows,"errors":errors,"committed":false});
    db::exec(
        db,
        "INSERT INTO imports(id,org_id,event_id,data) VALUES($1,$2,$3,$4)",
        vec![id.into(), org.into(), event.into(), data.clone().into()],
    )
    .await?;
    Ok(data)
}
pub async fn commit(db: &impl ConnectionTrait, org: &str, event: &str, id: &str) -> Result<Value> {
    let r=db::one(db,"SELECT data,committed FROM imports WHERE id=$1 AND org_id=$2 AND event_id=$3 AND expires_at>now() FOR UPDATE",vec![id.into(),org.into(),event.into()]).await?;
    if db::get::<bool>(&r, "committed")? {
        return Ok(ok());
    }
    let data: Value = db::get(&r, "data")?;
    if !data["errors"].as_array().unwrap().is_empty() {
        return Err(bad("Preview has validation errors"));
    }
    let event_row = db::one(
        db,
        "SELECT data FROM events WHERE org_id=$1 AND id=$2 FOR UPDATE",
        vec![org.into(), event.into()],
    )
    .await?;
    let mut metadata: Value = db::get(&event_row, "data")?;
    for row in data["rows"].as_array().unwrap() {
        let row: Row = serde_json::from_value(row.clone())?;
        if metadata["status"] == "archived"
            || metadata["code"] != row.event_code
            || metadata["date"] != row.event_date
        {
            return Err(conflict());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let phone = normalize(&row.phone)?;
        let person = json!({"id":id,"phone":phone,"firstName":row.first_name,"lastName":row.last_name,"nickname":row.nickname,
   "lang_code":row.lang_code,"outcome":{"result":null,"reason":null},"noAnswerCount":0});
        db::exec(
            db,
            "INSERT INTO participants(id,org_id,event_id,phone,data) VALUES($1,$2,$3,$4,$5)",
            vec![
                id.into(),
                org.into(),
                event.into(),
                phone.into(),
                person.into(),
            ],
        )
        .await?;
    }
    let count = db::one(
        db,
        "SELECT count(*) AS count FROM participants WHERE org_id=$1 AND event_id=$2",
        vec![org.into(), event.into()],
    )
    .await?;
    metadata["participantCount"] = json!(db::get::<i64>(&count, "count")?);
    db::exec(
        db,
        "UPDATE events SET data=$1 WHERE org_id=$2 AND id=$3",
        vec![metadata.into(), org.into(), event.into()],
    )
    .await?;
    db::exec(
        db,
        "UPDATE imports SET committed=true WHERE id=$1",
        vec![id.into()],
    )
    .await?;
    Ok(ok())
}
