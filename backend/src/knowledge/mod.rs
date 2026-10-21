use crate::{
    db,
    error::{Result, bad, conflict, missing, ok},
};
use sea_orm::ConnectionTrait;
use serde_json::{Value, json};
#[derive(serde::Deserialize)]
struct FaqInput {
    question: String,
    answer: String,
    category: String,
}
fn faq(body: Value, data: &Value) -> Result<Value> {
    let input: FaqInput = serde_json::from_value(body)?;
    if input.question.trim().is_empty()
        || input.question.len() > 500
        || input.answer.trim().is_empty()
        || input.answer.len() > 5000
        || !data["categories"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c == &input.category)
    {
        return Err(bad(
            "Question, answer and an existing event category are required",
        ));
    }
    Ok(
        json!({"id":uuid::Uuid::new_v4().to_string(),"question":input.question.trim(),"answer":input.answer.trim(),
  "category":input.category,"version":1,"updatedAt":chrono::Utc::now().to_rfc3339()}),
    )
}
pub async fn handle(
    db: &impl ConnectionTrait,
    org: &str,
    event: &str,
    tail: &[&str],
    method: &str,
    body: Value,
) -> Result<Value> {
    let row = db::one(
        db,
        "SELECT data FROM knowledge WHERE org_id=$1 AND event_id=$2 FOR UPDATE",
        vec![org.into(), event.into()],
    )
    .await?;
    let mut data: Value = db::get(&row, "data")?;
    let kind = tail.first().copied().unwrap_or("");
    if method == "GET" {
        return match kind {
            "knowledge" => Ok(data),
            "categories" => Ok(data["categories"].clone()),
            _ => Err(missing()),
        };
    }
    match (kind, method) {
        ("categories", "POST" | "PATCH" | "DELETE") => {
            let revision = data["categoryRevision"].as_i64().unwrap();
            if body["expectedRevision"].as_i64() != Some(revision) {
                return Err(conflict());
            }
            let old = tail.get(1).copied();
            let name = body["name"].as_str().unwrap_or("").trim();
            if method != "DELETE" {
                if name.is_empty()
                    || name.len() > 80
                    || data["categories"].as_array().unwrap().iter().any(|c| {
                        c.as_str().unwrap().to_lowercase() == name.to_lowercase()
                            && c.as_str() != old
                    })
                {
                    return Err(bad("Invalid or duplicate category"));
                }
            }
            if let Some(old) = old {
                let index = data["categories"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .position(|c| c == old)
                    .ok_or_else(missing)?;
                if method == "DELETE" {
                    if ["draft", "published"].iter().any(|field| {
                        data[field]
                            .as_array()
                            .unwrap()
                            .iter()
                            .any(|f| f["category"] == old)
                    }) {
                        return Err(conflict());
                    }
                    data["categories"].as_array_mut().unwrap().remove(index);
                } else if method == "PATCH" {
                    data["categories"][index] = json!(name);
                    for f in data["draft"].as_array_mut().unwrap() {
                        if f["category"] == old {
                            f["category"] = json!(name);
                            f["version"] = json!(f["version"].as_i64().unwrap() + 1);
                            f["updatedAt"] = json!(chrono::Utc::now().to_rfc3339());
                        }
                    }
                } else {
                    return Err(bad("Invalid category operation"));
                }
            } else if method == "POST" {
                data["categories"].as_array_mut().unwrap().push(json!(name));
            } else {
                return Err(missing());
            }
            data["categoryRevision"] = json!(revision + 1);
        }
        ("faqs", "POST") => {
            let item = faq(body, &data)?;
            data["draft"].as_array_mut().unwrap().push(item);
        }
        ("faqs", "PATCH" | "DELETE") => {
            let id = tail.get(1).ok_or_else(missing)?;
            let index = data["draft"]
                .as_array()
                .unwrap()
                .iter()
                .position(|f| f["id"] == *id)
                .ok_or_else(missing)?;
            if method == "DELETE" {
                data["draft"].as_array_mut().unwrap().remove(index);
            } else {
                let version = data["draft"][index]["version"].as_i64().unwrap();
                if body["expectedVersion"].as_i64() != Some(version) {
                    return Err(conflict());
                }
                let mut item = faq(body, &data)?;
                item["id"] = json!(id);
                item["version"] = json!(version + 1);
                data["draft"][index] = item;
            }
        }
        ("publish", "POST") => data["published"] = data["draft"].clone(),
        ("knowledge-import", "POST") => {
            let event_row = db::one(
                db,
                "SELECT code FROM events WHERE org_id=$1 AND id=$2",
                vec![org.into(), event.into()],
            )
            .await?;
            if body["eventCode"] != db::get::<String>(&event_row, "code")?
                || body["categoryRevision"] != data["categoryRevision"]
            {
                return Err(conflict());
            }
            let rows = body["rows"]
                .as_array()
                .filter(|r| !r.is_empty() && r.len() <= 1000)
                .ok_or_else(|| bad("1–1000 rows required"))?;
            let mut seen: Vec<String> = data["draft"]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| f["question"].as_str().unwrap().trim().to_lowercase())
                .collect();
            let mut items = Vec::new();
            for row in rows {
                let item = faq(row.clone(), &data)?;
                let question = item["question"].as_str().unwrap().to_lowercase();
                if seen.contains(&question) {
                    return Err(bad("Duplicate question"));
                }
                seen.push(question);
                items.push(item);
            }
            data["draft"].as_array_mut().unwrap().extend(items);
        }
        _ => return Err(missing()),
    }
    db::exec(
        db,
        "UPDATE knowledge SET data=$1 WHERE org_id=$2 AND event_id=$3",
        vec![data.into(), org.into(), event.into()],
    )
    .await?;
    Ok(ok())
}
