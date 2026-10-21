use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use std::{env, sync::Arc, time::Duration};
use tokio::sync::Semaphore;
#[derive(Clone)]
pub struct App {
    pub db: DatabaseConnection,
    pub hashing: Arc<Semaphore>,
    pub parsing: Arc<Semaphore>,
    pub origin: String,
    pub secure_cookie: bool,
}
impl App {
    pub async fn connect() -> Result<Self, Box<dyn std::error::Error>> {
        let mut url = reqwest::Url::parse(&env::var("DATABASE_URL")?)?;
        let existing: Vec<(String, String)> = url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        let mut settings = existing
            .iter()
            .find(|(k, _)| k == "options")
            .map(|(_, v)| v.clone())
            .unwrap_or_default();
        settings
            .push_str(" -c statement_timeout=5000 -c idle_in_transaction_session_timeout=10000");
        url.query_pairs_mut()
            .clear()
            .extend_pairs(existing.iter().filter(|(k, _)| k != "options"))
            .append_pair("options", settings.trim());
        let mut options = ConnectOptions::new(url.to_string());
        options
            .max_connections(5)
            .min_connections(1)
            .connect_timeout(Duration::from_secs(5))
            .acquire_timeout(Duration::from_secs(3))
            .sqlx_logging(false);
        let db = Database::connect(options).await?;
        Ok(Self {
            db,
            hashing: Arc::new(Semaphore::new(2)),
            parsing: Arc::new(Semaphore::new(1)),
            origin: env::var("PUBLIC_ORIGIN").unwrap_or("http://127.0.0.1:18460".into()),
            secure_cookie: env::var("COOKIE_SECURE").as_deref() != Ok("false"),
        })
    }
}
