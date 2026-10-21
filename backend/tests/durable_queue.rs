use event_confirm_api::events;
mod support;
use event_confirm_api::{
    auth,
    calling::{dispatch, policy, results},
    credentials, db,
    error::Result,
};
use sea_orm::{Database, TransactionTrait};
use serde_json::{Value, json};
use support::{fixture, ingest};
#[ntex::test]
async fn caps_concurrent_claims_reconciliation_and_idempotent_results() -> Result<()> {
    let (db, org, event) = fixture().await?;
    ingest(
        &db,
        &org,
        &event,
        &["+66800000001", "+66800000002", "+66800000003"],
    )
    .await?;
    policy::update(
        &db,
        &org,
        &event,
        json!({"ratio":2,"retryRatio":1,"maxRetries":1,"expectedVersion":1}),
    )
    .await?;
    policy::run(&db, &org, &event, json!({"action":"start"})).await?;
    let (a, b) = tokio::join!(dispatch::claim(&db), dispatch::claim(&db));
    let claimed = [a?, b?];
    assert_eq!(claimed.iter().filter(|c| c.is_some()).count(), 1);
    let first = claimed.into_iter().flatten().next().unwrap();
    assert_eq!(first.language, "th");
    dispatch::uncertain(&db, &first.id).await?;
    assert!(
        dispatch::claim(&db).await?.is_none(),
        "uncertain call blocks dispatch until reconciled"
    );
    dispatch::accepted(&db, &first.id, "provider-1").await?;
    dispatch::accepted(&db, &first.id, "provider-1").await?;
    let queue = policy::state(&db, &org, &event).await?;
    assert_eq!(
        queue["newSinceFail"], 1,
        "accepted retry cannot consume another turn"
    );
    let tx = db.begin().await?;
    results::apply(
        &tx,
        &org,
        &event,
        &first.id,
        json!({"result":"unknown","reason":"no_answer"}),
    )
    .await?;
    tx.commit().await?;
    let tx = db.begin().await?;
    results::apply(
        &tx,
        &org,
        &event,
        &first.id,
        json!({"result":"unknown","reason":"no_answer"}),
    )
    .await?;
    tx.commit().await?;
    let second = dispatch::claim(&db).await?.unwrap();
    assert_ne!(second.participant, first.participant);
    dispatch::accepted(&db, &second.id, "provider-2").await?;
    let tx = db.begin().await?;
    results::apply(
        &tx,
        &org,
        &event,
        &second.id,
        json!({"result":"decline","reason":null}),
    )
    .await?;
    tx.commit().await?;
    db::exec(
        &db,
        "UPDATE participants SET eligible_at=now() WHERE id=$1",
        vec![first.participant.clone().into()],
    )
    .await?;
    let third = dispatch::claim(&db).await?.unwrap();
    assert_eq!(third.participant, first.participant, "2 NEW then 1 RETRY");
    dispatch::accepted(&db, &third.id, "provider-3").await?;
    let tx = db.begin().await?;
    results::apply(
        &tx,
        &org,
        &event,
        &third.id,
        json!({"result":"unknown","reason":"no_answer"}),
    )
    .await?;
    tx.commit().await?;
    let stopped = db::one(
        &db,
        "SELECT state,attempt_count,data FROM participants WHERE id=$1",
        vec![first.participant.clone().into()],
    )
    .await?;
    assert_eq!(db::get::<String>(&stopped, "state")?, "stopped");
    assert_eq!(
        db::get::<i32>(&stopped, "attempt_count")?,
        2,
        "one initial plus one retry"
    );
    assert_eq!(db::get::<Value>(&stopped, "data")?["noAnswerCount"], 2);
    // Persisted state survives replacing the application connection.
    let reopened = Database::connect(std::env::var("TEST_DATABASE_URL").unwrap()).await?;
    let last = dispatch::claim(&reopened).await?.unwrap();
    assert_ne!(
        last.participant, first.participant,
        "exhausted participant cannot be requeued on restart"
    );
    dispatch::accepted(&reopened, &last.id, "provider-4").await?;
    let tx = reopened.begin().await?;
    results::apply(&tx,&org,&event,&last.id,json!({"result":"confirm","reason":null,"ticket":{
  "title":"Question","description":"Agent cannot answer","type":"unanswered","assigneeIds":[],"dueDate":""}})).await?;
    tx.commit().await?;
    let count = db::one(
        &db,
        "SELECT count(*) AS count FROM tickets WHERE event_id=$1",
        vec![event.clone().into()],
    )
    .await?;
    assert_eq!(db::get::<i64>(&count, "count")?, 1);
    assert!(dispatch::claim(&db).await?.is_none());
    Ok(())
}
#[ntex::test]
async fn tenant_isolation_and_paired_credential_revocation() -> Result<()> {
    let (db, org, event) = fixture().await?;
    let user = auth::User {
        id: uuid::Uuid::new_v4().to_string(),
        root: false,
    };
    assert_eq!(
        auth::scope(&db, &user, &org, Some(&event), false, false)
            .await
            .unwrap_err()
            .0,
        403
    );
    assert!(
        events::handle(&db, "different-org", Some(&event), "GET", json!({}))
            .await
            .is_err()
    );
    let tx = db.begin().await?;
    let parent = credentials::handle(
        &tx,
        &org,
        &[],
        "POST",
        json!({"name":"Org","kind":"org","eventId":null,"parentId":null,
  "scopes":["knowledge:read"],"expiresAt":"2027-12-31"}),
    )
    .await?;
    let child = credentials::handle(
        &tx,
        &org,
        &[],
        "POST",
        json!({"name":"Event","kind":"event","eventId":event,"parentId":parent["credential"]["id"],
  "scopes":["knowledge:read"],"expiresAt":"2027-12-31"}),
    )
    .await?;
    tx.commit().await?;
    let org_key = parent["secret"].as_str().unwrap();
    let event_key = child["secret"].as_str().unwrap();
    credentials::pair(&db, &org, &event, org_key, event_key, "knowledge:read").await?;
    assert!(
        credentials::pair(
            &db,
            &org,
            "other-event",
            org_key,
            event_key,
            "knowledge:read"
        )
        .await
        .is_err()
    );
    assert!(
        credentials::pair(&db, &org, &event, org_key, event_key, "tickets:create")
            .await
            .is_err()
    );
    let tx = db.begin().await?;
    credentials::handle(
        &tx,
        &org,
        &[parent["credential"]["id"].as_str().unwrap(), "revoke"],
        "POST",
        json!({}),
    )
    .await?;
    tx.commit().await?;
    assert!(
        credentials::pair(&db, &org, &event, org_key, event_key, "knowledge:read")
            .await
            .is_err()
    );
    Ok(())
}
