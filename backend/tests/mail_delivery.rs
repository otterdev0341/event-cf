mod support;
use event_confirm_api::{auth::mailer, config::App, db, error::Result};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::Semaphore,
};

#[ntex::test]
async fn lost_mail_response_reuses_idempotency_key_and_success_erases_token() -> Result<()> {
    let (db, _, _) = support::fixture().await?;
    let id = uuid::Uuid::new_v4().to_string();
    db::exec(&db,
        "INSERT INTO mail_outbox(id,recipient,payload,next_at) VALUES($1,'synthetic@example.test',$2,now()-interval '2 days')",
        vec![id.clone().into(),json!({"url":"/reset?token=synthetic-only"}).into()]).await?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let expected = id.clone();
    let server = ntex::rt::spawn(async move {
        for attempt in 0..2 {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0u8; 2048];
            while !bytes.windows(4).any(|b| b == b"\r\n\r\n") {
                let count = stream.read(&mut buffer).await.unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&buffer[..count]);
            }
            let request = String::from_utf8_lossy(&bytes).to_lowercase();
            assert!(request.starts_with("post /messages "));
            assert!(request.contains(&format!("idempotency-key: {expected}\r\n")));
            if attempt == 1 {
                stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .await
                    .unwrap();
            }
            // First response is lost after provider accepts; retry must retain identity.
        }
    });
    let app = App {
        db: db.clone(),
        hashing: Arc::new(Semaphore::new(2)),
        parsing: Arc::new(Semaphore::new(1)),
        origin: url.clone(),
        secure_cookie: false,
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    mailer::tick(&app, &client, &url, "synthetic-token").await?;
    let first = db::one(
        &db,
        "SELECT state,attempts FROM mail_outbox WHERE id=$1",
        vec![id.clone().into()],
    )
    .await?;
    assert_eq!(db::get::<String>(&first, "state")?, "pending");
    assert_eq!(db::get::<i32>(&first, "attempts")?, 1);
    db::exec(
        &db,
        "UPDATE mail_outbox SET next_at=now()-interval '2 days' WHERE id=$1",
        vec![id.clone().into()],
    )
    .await?;
    mailer::tick(&app, &client, &url, "synthetic-token").await?;
    tokio::time::timeout(Duration::from_secs(3), server)
        .await
        .unwrap()
        .unwrap();
    let final_row = db::one(
        &db,
        "SELECT state,attempts,payload FROM mail_outbox WHERE id=$1",
        vec![id.into()],
    )
    .await?;
    assert_eq!(db::get::<String>(&final_row, "state")?, "sent");
    assert_eq!(db::get::<i32>(&final_row, "attempts")?, 2);
    assert_eq!(db::get::<Value>(&final_row, "payload")?, json!({}));
    Ok(())
}
