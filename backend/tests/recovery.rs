mod support;
use event_confirm_api::{
    calling::{dispatch, policy, results},
    db,
    error::Result,
};
use sea_orm::TransactionTrait;
use serde_json::{Value, json};
use support::{fixture, ingest};

#[ntex::test]
async fn five_to_two_dispatch_and_zero_retries() -> Result<()> {
    let (db, org, event) = fixture().await?;
    ingest(
        &db,
        &org,
        &event,
        &[
            "+66900000001",
            "+66900000002",
            "+66900000003",
            "+66900000004",
            "+66900000005",
            "+66900000006",
            "+66900000007",
            "+66900000008",
            "+66900000009",
        ],
    )
    .await?;
    db::exec(&db,"UPDATE participants SET lane='fail',attempt_count=1 WHERE event_id=$1 AND phone IN ('+66900000008','+66900000009')",vec![event.clone().into()]).await?;
    policy::update(
        &db,
        &org,
        &event,
        json!({"ratio":5,"retryRatio":2,"maxRetries":2,"expectedVersion":1}),
    )
    .await?;
    policy::run(&db, &org, &event, json!({"action":"start"})).await?;
    let mut lanes = Vec::new();
    for n in 0..9 {
        let claim = dispatch::claim(&db).await?.unwrap();
        let row = db::one(
            &db,
            "SELECT lane FROM participants WHERE id=$1",
            vec![claim.participant.into()],
        )
        .await?;
        lanes.push(db::get::<String>(&row, "lane")?);
        dispatch::accepted(&db, &claim.id, &format!("provider-{n}")).await?;
        let tx = db.begin().await?;
        results::apply(
            &tx,
            &org,
            &event,
            &claim.id,
            json!({"result":"confirm","reason":null}),
        )
        .await?;
        tx.commit().await?;
    }
    assert_eq!(
        lanes,
        [
            "new", "new", "new", "new", "new", "fail", "fail", "new", "new"
        ]
    );
    let (db, org, event) = fixture().await?;
    ingest(&db, &org, &event, &["+66911111111"]).await?;
    policy::update(
        &db,
        &org,
        &event,
        json!({"ratio":1,"retryRatio":1,"maxRetries":0,"expectedVersion":1}),
    )
    .await?;
    policy::run(&db, &org, &event, json!({"action":"start"})).await?;
    let call = dispatch::claim(&db).await?.unwrap();
    dispatch::accepted(&db, &call.id, "one-only").await?;
    let tx = db.begin().await?;
    results::apply(
        &tx,
        &org,
        &event,
        &call.id,
        json!({"result":"unknown","reason":"no_answer"}),
    )
    .await?;
    tx.commit().await?;
    assert!(dispatch::claim(&db).await?.is_none());
    let person = db::one(
        &db,
        "SELECT state FROM participants WHERE id=$1",
        vec![call.participant.into()],
    )
    .await?;
    assert_eq!(db::get::<String>(&person, "state")?, "stopped");
    Ok(())
}

#[ntex::test]
async fn late_confirmation_prevents_an_inflight_retry_from_reopening_attendance() -> Result<()> {
    let (db, org, event) = fixture().await?;
    ingest(&db, &org, &event, &["+66922222222"]).await?;
    policy::run(&db, &org, &event, json!({"action":"start"})).await?;
    let first = dispatch::claim(&db).await?.unwrap();
    dispatch::accepted(&db, &first.id, "first").await?;
    let tx = db.begin().await?;
    results::apply(
        &tx,
        &org,
        &event,
        &first.id,
        json!({"result":"unknown","reason":"ai_cannot_infer"}),
    )
    .await?;
    tx.commit().await?;
    assert!(
        dispatch::claim(&db).await?.is_none(),
        "cooldown is enforced"
    );
    db::exec(
        &db,
        "UPDATE participants SET eligible_at=now() WHERE id=$1",
        vec![first.participant.clone().into()],
    )
    .await?;
    let retry = dispatch::claim(&db).await?.unwrap();
    dispatch::accepted(&db, &retry.id, "retry").await?;
    let tx = db.begin().await?;
    results::apply(
        &tx,
        &org,
        &event,
        &first.id,
        json!({"result":"confirm","reason":null}),
    )
    .await?;
    tx.commit().await?;
    let tx = db.begin().await?;
    results::apply(
        &tx,
        &org,
        &event,
        &retry.id,
        json!({"result":"unknown","reason":"no_answer"}),
    )
    .await?;
    tx.commit().await?;
    let person = db::one(
        &db,
        "SELECT state,data FROM participants WHERE id=$1",
        vec![first.participant.into()],
    )
    .await?;
    assert_eq!(db::get::<String>(&person, "state")?, "stopped");
    assert_eq!(
        db::get::<Value>(&person, "data")?["outcome"]["result"],
        "confirm"
    );
    assert!(dispatch::claim(&db).await?.is_none());
    Ok(())
}
