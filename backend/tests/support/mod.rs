use event_confirm_api::{calling::imports, db, error::Result, events};
use sea_orm::{Database, DatabaseConnection, TransactionTrait};
use serde_json::{Value, json};
pub async fn fixture() -> Result<(DatabaseConnection, String, String)> {
    let url = std::env::var("TEST_DATABASE_URL")
        .expect("TEST_DATABASE_URL required: real PostgreSQL only");
    let db = Database::connect(url).await?;
    db::migrate(&db).await?;
    let org = uuid::Uuid::new_v4().to_string();
    db::exec(
        &db,
        "INSERT INTO organizations(id,name) VALUES($1,'Integration test')",
        vec![org.clone().into()],
    )
    .await?;
    let tx = db.begin().await?;
    let event=events::handle(&tx,&org,None,"POST",json!({"name":"Acceptance","code":"TEST","date":"2027-01-01","location":"Test","description":""})).await?;
    tx.commit().await?;
    Ok((db, org, event["id"].as_str().unwrap().into()))
}
pub async fn ingest(
    db: &DatabaseConnection,
    org: &str,
    event: &str,
    phones: &[&str],
) -> Result<()> {
    let tx = db.begin().await?;
    let rows: Vec<Value> = phones
        .iter()
        .map(|phone| {
            json!({"phone":phone,"first_name":"Test","last_name":"Person","nickname":"",
  "event_code":"TEST","event_date":"2027-01-01","lang_code":"th"})
        })
        .collect();
    let preview = imports::preview(&tx, org, event, json!({"rows":rows})).await?;
    assert_eq!(preview["errors"], json!([]));
    imports::commit(&tx, org, event, preview["id"].as_str().unwrap()).await?;
    tx.commit().await?;
    Ok(())
}
