mod support;
use event_confirm_api::{
    auth::{self, User},
    db,
    error::Result,
    routes,
};
use sea_orm::TransactionTrait;
use serde_json::json;

#[ntex::test]
async fn roles_event_grants_and_membership_removal_are_enforced() -> Result<()> {
    let (db, org, event) = support::fixture().await?;
    let (_, foreign_org, foreign_event) = support::fixture().await?;
    for role in ["org_admin", "event_admin", "team_member"] {
        let id = uuid::Uuid::new_v4().to_string();
        db::exec(
            &db,
            "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Scope test','!')",
            vec![id.clone().into(), format!("{id}@example.test").into()],
        )
        .await?;
        db::exec(
            &db,
            "INSERT INTO memberships(org_id,user_id,role,event_ids) VALUES($1,$2,$3,$4)",
            vec![
                org.clone().into(),
                id.clone().into(),
                role.into(),
                json!([event]).into(),
            ],
        )
        .await?;
        let user = User {
            id: id.clone(),
            root: false,
        };
        auth::scope(&db, &user, &org, Some(&event), false, false).await?;
        assert_eq!(
            auth::scope(&db, &user, &org, Some(&event), true, false)
                .await
                .is_ok(),
            role != "team_member"
        );
        assert_eq!(
            auth::scope(&db, &user, &org, None, true, true)
                .await
                .is_ok(),
            role == "org_admin"
        );
        assert!(
            auth::scope(&db, &user, &foreign_org, Some(&foreign_event), false, false)
                .await
                .is_err()
        );
        // Even an org admin cannot resolve an event belonging to another org.
        let tx = db.begin().await?;
        assert!(
            routes::browser(
                &tx,
                &user,
                &format!("/orgs/{org}/events/{foreign_event}"),
                "GET",
                json!({})
            )
            .await
            .is_err()
        );
        tx.rollback().await?;
        db::exec(
            &db,
            "DELETE FROM memberships WHERE org_id=$1 AND user_id=$2",
            vec![org.clone().into(), id.into()],
        )
        .await?;
        assert!(
            auth::scope(&db, &user, &org, Some(&event), false, false)
                .await
                .is_err()
        );
    }
    let root = User {
        id: "platform-root".into(),
        root: true,
    };
    auth::scope(&db, &root, &org, Some(&event), true, true).await?;
    Ok(())
}
