mod support;
use event_confirm_api::{
    auth::User,
    calling::{dispatch, results},
    db,
    error::Result,
    schedules::{self, time::Rule},
};
use sea_orm::TransactionTrait;
use serde_json::{Value, json};

#[test]
fn bangkok_once_daily_weekly_match_legacy_time_rules() {
    let mut rule: Rule = serde_json::from_value(json!({"date":"2027-01-03","time":"09:30","recurrence":"once", "weekdays":[],"redial":false,"participantIds":["p"],"expectedEventVersion":1,"consent":true})).unwrap();
    let now = "2027-01-02T23:00:00Z".parse().unwrap();
    assert_eq!(
        rule.next(now).unwrap().to_rfc3339(),
        "2027-01-03T02:30:00+00:00"
    );
    assert!(rule.next("2027-01-03T02:30:00Z".parse().unwrap()).is_err());
    rule.recurrence = "daily".into();
    assert_eq!(
        rule.next("2027-01-03T02:30:00Z".parse().unwrap())
            .unwrap()
            .to_rfc3339(),
        "2027-01-04T02:30:00+00:00"
    );
    rule.recurrence = "weekly".into();
    rule.weekdays = vec![1];
    assert_eq!(
        rule.next(now).unwrap().to_rfc3339(),
        "2027-01-04T02:30:00+00:00"
    );
    rule.weekdays = vec![];
    assert!(rule.next(now).is_err());
}

#[ntex::test]
async fn explicit_schedule_redial_preserves_history_and_limits_selection() -> Result<()> {
    let (db, org, event) = support::fixture().await?;
    support::ingest(&db, &org, &event, &["+66811111111", "+66811111112"]).await?;
    let user = User {
        id: uuid::Uuid::new_v4().to_string(),
        root: true,
    };
    db::exec(
        &db,
        "INSERT INTO users(id,email,name,password_hash,root) VALUES($1,$2,'Scheduler','!',true)",
        vec![
            user.id.clone().into(),
            format!("{}@example.test", user.id).into(),
        ],
    )
    .await?;
    let person = db::one(
        &db,
        "SELECT id FROM participants WHERE event_id=$1 ORDER BY phone LIMIT 1",
        vec![event.clone().into()],
    )
    .await?;
    let person: String = db::get(&person, "id")?;
    let rule = json!({"date":"2099-01-01","time":"09:00","recurrence":"once","weekdays":[],"redial":true,"participantIds":[person],"expectedEventVersion":1,"consent":true});
    for number in 1..=2 {
        let tx = db.begin().await?;
        let schedule =
            schedules::handle(&tx, &user, &org, &event, None, "POST", rule.clone()).await?;
        tx.commit().await?;
        db::exec(
            &db,
            "UPDATE schedules SET next_at=now()-interval '1 minute' WHERE id=$1",
            vec![schedule["id"].as_str().unwrap().into()],
        )
        .await?;
        let (a, b) = tokio::join!(schedules::worker::tick(&db), schedules::worker::tick(&db));
        a?;
        b?;
        schedules::worker::tick(&db).await?;
        let claim = dispatch::claim(&db)
            .await?
            .expect("schedule must remain running before dispatch");
        assert_eq!(claim.participant, person);
        dispatch::accepted(&db, &claim.id, &format!("scheduled-{number}")).await?;
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
        assert!(
            dispatch::claim(&db).await?.is_none(),
            "unselected rows must not dispatch"
        );
        schedules::worker::tick(&db).await?;
        let saved = db::one(
            &db,
            "SELECT status,completed_runs FROM schedules WHERE id=$1",
            vec![schedule["id"].as_str().unwrap().into()],
        )
        .await?;
        assert_eq!(db::get::<String>(&saved, "status")?, "completed");
        assert_eq!(db::get::<i32>(&saved, "completed_runs")?, 1);
    }
    let history = db::rows(
        &db,
        "SELECT number,result FROM attempts WHERE participant_id=$1 ORDER BY number",
        vec![person.into()],
    )
    .await?;
    assert_eq!(history.len(), 2);
    assert_eq!(db::get::<i32>(&history[1], "number")?, 2);
    assert_eq!(
        db::get::<Value>(&history[0], "result")?["result"],
        "confirm"
    );
    Ok(())
}
