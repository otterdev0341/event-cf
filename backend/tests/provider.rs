mod support;
use event_confirm_api::{
    calling::{policy, worker},
    config::App,
    db,
    error::Result,
};
use serde_json::json;
use std::{sync::Arc, time::Duration};
use support::{fixture, ingest};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Semaphore,
};

#[ntex::test]
async fn lost_acceptance_reconciles_without_redial_and_slow_provider_does_not_block_database()
-> Result<()> {
    let (db, org, event) = fixture().await?;
    ingest(&db, &org, &event, &["+66933333333"]).await?;
    policy::run(&db, &org, &event, json!({"action":"start"})).await?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let fake = ntex::rt::spawn(async move {
        let (mut first, _) = listener.accept().await.unwrap();
        let mut input = [0u8; 4096];
        let size = first.read(&mut input).await.unwrap();
        assert!(String::from_utf8_lossy(&input[..size]).starts_with("POST /calls "));
        drop(first); // Provider accepted internally but the transport lost its response.
        let (mut second, _) = listener.accept().await.unwrap();
        let size = second.read(&mut input).await.unwrap();
        assert!(String::from_utf8_lossy(&input[..size]).starts_with("GET /calls/"));
        tokio::time::sleep(Duration::from_millis(700)).await;
        let body = r#"{"provider_id":"fake-accepted"}"#;
        second.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).as_bytes()).await.unwrap();
    });
    let app = App {
        db: db.clone(),
        hashing: Arc::new(Semaphore::new(2)),
        parsing: Arc::new(Semaphore::new(1)),
        origin: base.clone(),
        secure_cookie: false,
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    worker::tick(&app, &client, &base, "fake-token").await?;
    let row = db::one(
        &db,
        "SELECT id,status FROM attempts WHERE event_id=$1",
        vec![event.clone().into()],
    )
    .await?;
    assert_eq!(db::get::<String>(&row, "status")?, "uncertain");
    db::exec(
        &db,
        "UPDATE attempts SET lease_until=now()-interval '1 second' WHERE event_id=$1",
        vec![event.clone().into()],
    )
    .await?;
    let check =
        ntex::rt::spawn(async move { worker::tick(&app, &client, &base, "fake-token").await });
    tokio::time::sleep(Duration::from_millis(30)).await;
    tokio::time::timeout(Duration::from_millis(300), db.ping())
        .await
        .expect("DB responsive during slow provider")
        .unwrap();
    check.await.unwrap()?;
    fake.await.unwrap();
    let rows = db::rows(
        &db,
        "SELECT status FROM attempts WHERE event_id=$1",
        vec![event.clone().into()],
    )
    .await?;
    assert_eq!(rows.len(), 1);
    assert_eq!(db::get::<String>(&rows[0], "status")?, "accepted");
    // Close the synthetic call so subsequent isolated scenarios can claim.
    let tx = sea_orm::TransactionTrait::begin(&db).await?;
    event_confirm_api::calling::results::apply(
        &tx,
        &org,
        &event,
        &db::get::<String>(&row, "id")?,
        json!({"result":"confirm","reason":null}),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}
