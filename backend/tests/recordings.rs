use event_confirm_api::recordings::provider::Provider;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
async fn fixture(responses: Vec<String>) -> (Provider, ntex::rt::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = ntex::rt::spawn(async move {
        for response in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut input = [0; 4096];
            let size = stream.read(&mut input).await.unwrap();
            let request = String::from_utf8_lossy(&input[..size]);
            assert!(request.starts_with("GET /recordings/attempt"));
            assert!(request.contains("Bearer recording-test-token"));
            let _ = stream.write_all(response.as_bytes()).await;
        }
    });
    (
        Provider::new(&base, "recording-test-token".into()).unwrap(),
        task,
    )
}
fn response(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}
fn metadata(attempt: &str) -> String {
    response(&serde_json::json!({"attempt_id":attempt,"provider_id":"provider","recording_id":"file","content_type":"audio/wav","simulated":true}).to_string())
}
#[ntex::test]
async fn recording_requires_exact_identity_and_bounded_provider_response() {
    let (provider,task) = fixture(vec![metadata("wrong-attempt"),
        "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
        "HTTP/1.1 200 OK\r\nContent-Length: 20000\r\nConnection: close\r\n\r\n".into()]).await;
    for _ in 0..3 {
        assert!(provider.metadata("attempt", "provider").await.is_err());
    }
    task.await.unwrap();
}
#[ntex::test]
async fn audio_rechecks_identity_and_size_before_returning_content() {
    let audio = |id: &str, length: usize, body: &str| {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {length}\r\nContent-Type: audio/wav\r\nX-Attempt-Id: attempt\r\nX-Provider-Id: provider\r\nX-Recording-Id: {id}\r\nConnection: close\r\n\r\n{body}"
        )
    };
    let (provider, task) = fixture(vec![
        metadata("attempt"),
        audio("file", 4, "RIFF"),
        audio("different-file", 4, "RIFF"),
        audio("file", 9 * 1024 * 1024, ""),
    ])
    .await;
    let meta = provider
        .metadata("attempt", "provider")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(provider.audio(&meta).await.unwrap(), b"RIFF");
    assert!(provider.audio(&meta).await.is_err());
    assert!(provider.audio(&meta).await.is_err());
    task.await.unwrap();
}
