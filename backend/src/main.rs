use event_confirm_api::{auth, config::App, db, http};
use ntex::{SharedCfg, web};
#[ntex::main(name = "event-confirm", signals = true)]
async fn main() -> std::io::Result<()> {
    let app = App::connect()
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    db::migrate(&app.db)
        .await
        .map_err(|e| std::io::Error::other(e.1))?;
    auth::seed(&app)
        .await
        .map_err(|e| std::io::Error::other(e.1))?;
    if std::env::args().any(|arg| arg == "worker") {
        return event_confirm_api::calling::worker::run(app)
            .await
            .map_err(|e| std::io::Error::other(e.1));
    }
    if std::env::args().any(|arg| arg == "mailer") {
        return auth::mailer::run(app)
            .await
            .map_err(|e| std::io::Error::other(e.1));
    }
    let bind = std::env::var("BIND_ADDRESS").unwrap_or("127.0.0.1:18460".into());
    web::HttpServer::new(async move |_| {
        web::App::new()
            .with_config(
                web::WebAppConfig::default()
                    .set_state(app.clone())
                    .set_state(web::types::PayloadConfig::new(2 * 1024 * 1024)),
            )
            .service(web::resource("/healthz").route(web::get().to(http::health)))
            .service(web::resource("/event-confirm/api/v1/{tail}*").to(http::handle))
    })
    .bind(bind, SharedCfg::default())?
    .workers(1)
    .max_connections(64)
    .backlog(128)
    .graceful_shutdown()
    .graceful_shutdown_timeout(ntex::time::Seconds(15))
    .run()
    .await
}
