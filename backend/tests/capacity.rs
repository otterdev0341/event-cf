use event_confirm_api::{auth::password, config::App, db, error::Error};
use sea_orm::TransactionTrait;
use std::time::{Duration, Instant};

#[ntex::test]
async fn exhausted_pool_times_out_then_recovers_without_stalling_runtime() {
    let app = App::connect_url(&std::env::var("TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let mut held = Vec::new();
    for _ in 0..5 {
        held.push(app.db.begin().await.unwrap());
    }
    let started = Instant::now();
    let connection = app.db.clone();
    let waiting =
        ntex::rt::spawn(async move { db::one(&connection, "SELECT 1 AS healthy", vec![]).await });
    // The executor must remain responsive while a request awaits a pool slot.
    tokio::time::timeout(Duration::from_millis(500), async {
        tokio::time::sleep(Duration::from_millis(20)).await;
    })
    .await
    .unwrap();
    let result = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(result, Err(Error(503, _))));
    assert!(started.elapsed() >= Duration::from_secs(2));
    for tx in held {
        tx.rollback().await.unwrap();
    }
    app.db.ping().await.unwrap();
    let row = db::one(&app.db, "SHOW statement_timeout", vec![])
        .await
        .unwrap();
    assert_eq!(db::get::<String>(&row, "statement_timeout").unwrap(), "5s");
}

#[ntex::test]
async fn saturated_hashing_returns_backpressure_and_recovers() {
    let app = App::connect_url(&std::env::var("TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let first = app.hashing.clone().acquire_owned().await.unwrap();
    let second = app.hashing.clone().acquire_owned().await.unwrap();
    let result = password::password(&app, "valid-password".into(), None).await;
    assert!(matches!(result, Err(Error(429, _))));
    drop(first);
    drop(second);
    let hash = password::password(&app, "valid-password".into(), None)
        .await
        .unwrap();
    assert!(hash.starts_with("$argon2id$"));
    assert_eq!(app.hashing.available_permits(), 2);
}
