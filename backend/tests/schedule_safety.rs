mod support;
use event_confirm_api::{
    auth::User,
    calling::{dispatch, policy, results},
    db,
    error::Result,
    schedules,
};
use sea_orm::TransactionTrait;
use serde_json::json;

#[ntex::test]
async fn cancelling_future_schedule_does_not_pause_manual_queue() -> Result<()> {
    let (db, org, event) = support::fixture().await?;
    support::ingest(&db, &org, &event, &["+66821111111"]).await?;
    let user = User {
        id: uuid::Uuid::new_v4().to_string(),
        root: true,
    };
    db::exec(
        &db,
        "INSERT INTO users(id,email,name,password_hash,root) VALUES($1,$2,'Schedule','!',true)",
        vec![
            user.id.clone().into(),
            format!("{}@example.test", user.id).into(),
        ],
    )
    .await?;
    let person = db::one(
        &db,
        "SELECT id FROM participants WHERE event_id=$1",
        vec![event.clone().into()],
    )
    .await?;
    let person: String = db::get(&person, "id")?;
    let rule = json!({"date":"2099-01-01","time":"09:00","recurrence":"once","weekdays":[],"redial":false,"participantIds":[person],"expectedEventVersion":1,"consent":true});
    let tx = db.begin().await?;
    let schedule = schedules::handle(&tx, &user, &org, &event, None, "POST", rule).await?;
    policy::run(&tx, &org, &event, json!({"action":"start"})).await?;
    schedules::handle(
        &tx,
        &user,
        &org,
        &event,
        schedule["id"].as_str(),
        "PATCH",
        json!({"action":"cancel","expectedVersion":1}),
    )
    .await?;
    assert_eq!(policy::state(&tx, &org, &event).await?["status"], "running");
    policy::run(&tx, &org, &event, json!({"action":"pause"})).await?;
    tx.commit().await?;
    Ok(())
}

#[ntex::test]
async fn non_redial_schedule_skips_people_called_before_occurrence() -> Result<()> {
    let (db, org, event) = support::fixture().await?;
    support::ingest(&db, &org, &event, &["+66821111112"]).await?;
    let user = User {
        id: uuid::Uuid::new_v4().to_string(),
        root: true,
    };
    db::exec(
        &db,
        "INSERT INTO users(id,email,name,password_hash,root) VALUES($1,$2,'Schedule','!',true)",
        vec![
            user.id.clone().into(),
            format!("{}@example.test", user.id).into(),
        ],
    )
    .await?;
    let person = db::one(
        &db,
        "SELECT id FROM participants WHERE event_id=$1",
        vec![event.clone().into()],
    )
    .await?;
    let person: String = db::get(&person, "id")?;
    let tx = db.begin().await?;
    let schedule=schedules::handle(&tx,&user,&org,&event,None,"POST",json!({"date":"2099-01-01","time":"09:00","recurrence":"once","weekdays":[],"redial":false,"participantIds":[person],"expectedEventVersion":1,"consent":true})).await?;
    policy::run(&tx, &org, &event, json!({"action":"start"})).await?;
    tx.commit().await?;
    let call = dispatch::claim(&db).await?.unwrap();
    dispatch::accepted(&db, &call.id, "schedule-manual").await?;
    let tx = db.begin().await?;
    results::apply(
        &tx,
        &org,
        &event,
        &call.id,
        json!({"result":"unknown","reason":"no_answer"}),
    )
    .await?;
    policy::run(&tx, &org, &event, json!({"action":"pause"})).await?;
    tx.commit().await?;
    db::exec(
        &db,
        "UPDATE schedules SET next_at=now()-interval '1 minute' WHERE id=$1",
        vec![schedule["id"].as_str().unwrap().into()],
    )
    .await?;
    db::exec(
        &db,
        "UPDATE participants SET eligible_at=now() WHERE id=$1",
        vec![person.into()],
    )
    .await?;
    schedules::worker::tick(&db).await?;
    assert!(
        dispatch::claim(&db).await?.is_none(),
        "non-redial occurrence must not dispatch a previous manual attempt"
    );
    schedules::worker::tick(&db).await?;
    assert_eq!(policy::state(&db, &org, &event).await?["status"], "paused");
    Ok(())
}
