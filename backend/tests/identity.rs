mod support;
use event_confirm_api::{auth, config::App, db, error::Result};
use sea_orm::TransactionTrait;
use serde_json::{Value, json};
use std::sync::Arc;
use tokio::sync::Semaphore;
#[ntex::test]
async fn invitation_onboarding_and_reset_are_single_use_and_revoke_sessions() -> Result<()> {
    let (db, org, event) = support::fixture().await?;
    let app = App {
        db: db.clone(),
        hashing: Arc::new(Semaphore::new(2)),
        parsing: Arc::new(Semaphore::new(1)),
        origin: "http://127.0.0.1".into(),
        secure_cookie: false,
    };
    let email = format!("{}@example.test", uuid::Uuid::new_v4());
    let tx = db.begin().await?;
    auth::invitations::invite(
        &tx,
        &org,
        json!({"email":email,"role":"event_admin","eventIds":[event]}),
    )
    .await?;
    tx.commit().await?;
    let mail = db::one(
        &db,
        "SELECT payload FROM mail_outbox WHERE recipient=$1 ORDER BY next_at DESC LIMIT 1",
        vec![email.clone().into()],
    )
    .await?;
    let payload: Value = db::get(&mail, "payload")?;
    let token = payload["url"]
        .as_str()
        .unwrap()
        .split("token=")
        .nth(1)
        .unwrap();
    auth::tokens::complete(
        &app,
        json!({"token":token,"password":"new-account-password"}),
    )
    .await?;
    assert!(
        auth::tokens::complete(&app, json!({"token":token,"password":"replay-password"}))
            .await
            .is_err()
    );
    let (profile, session) = auth::login(
        &app,
        json!({"email":email,"password":"new-account-password"}),
    )
    .await?;
    let user = auth::User {
        id: profile["user"]["id"].as_str().unwrap().into(),
        root: false,
    };
    auth::scope(&db, &user, &org, Some(&event), true, false).await?;
    assert!(
        auth::scope(&db, &user, &org, Some("other-event"), true, false)
            .await
            .is_err()
    );
    assert!(
        auth::scope(&db, &user, &org, None, true, true)
            .await
            .is_err()
    );
    auth::tokens::reset(&app, json!({"email":email})).await?;
    let mail = db::one(
        &db,
        "SELECT payload FROM mail_outbox WHERE recipient=$1 ORDER BY next_at DESC LIMIT 1",
        vec![email.clone().into()],
    )
    .await?;
    let payload: Value = db::get(&mail, "payload")?;
    let token = payload["url"]
        .as_str()
        .unwrap()
        .split("token=")
        .nth(1)
        .unwrap();
    auth::tokens::complete(
        &app,
        json!({"token":token,"password":"reset-account-password"}),
    )
    .await?;
    let sessions = db::rows(
        &db,
        "SELECT digest FROM sessions WHERE digest=$1",
        vec![auth::password::digest(&session).into()],
    )
    .await?;
    assert!(sessions.is_empty());
    assert!(
        auth::login(
            &app,
            json!({"email":email,"password":"new-account-password"})
        )
        .await
        .is_err()
    );
    auth::login(
        &app,
        json!({"email":email,"password":"reset-account-password"}),
    )
    .await?;
    let row = db::one(
        &db,
        "SELECT password_hash FROM users WHERE id=$1",
        vec![user.id.into()],
    )
    .await?;
    assert!(db::get::<String>(&row, "password_hash")?.starts_with("$argon2id$"));
    Ok(())
}
