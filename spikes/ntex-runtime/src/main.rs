use sea_orm::{ConnectOptions, ConnectionTrait, Database, DbBackend, Statement};
use std::{error::Error, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// A disposable compatibility probe, never a production server or migration.
#[ntex::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let url = std::env::var("SPIKE_DATABASE_URL")?;
    let mut options = ConnectOptions::new(url);
    options.max_connections(2).connect_timeout(Duration::from_secs(5));
    let db = Database::connect(options).await?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let fake = ntex::rt::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = [0u8; 2048];
        stream.read(&mut request).await.unwrap();
        tokio::time::sleep(Duration::from_millis(150)).await;
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok").await.unwrap();
    });
    let client = reqwest::Client::builder().timeout(Duration::from_secs(3)).build()?;
    let outbound = client.get(format!("http://{address}")).send();
    let query = db.query_one(Statement::from_string(DbBackend::Postgres, "SELECT 42 AS answer"));
    let (response, row) = tokio::join!(outbound, query);
    assert_eq!(response?.text().await?, "ok");
    let answer: i32 = row?.ok_or("missing DB result")?.try_get("", "answer")?;
    assert_eq!(answer, 42);
    fake.await?;
    db.close().await?;
    println!("PASS: ntex Tokio runtime + SeaORM PostgreSQL + concurrent async HTTP");
    Ok(())
}
