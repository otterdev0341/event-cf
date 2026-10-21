mod support;
use event_confirm_api::{
    calling::{dispatch, policy, results},
    db,
    error::Result,
};
use sea_orm::TransactionTrait;
use serde_json::json;

#[ntex::test]
async fn new_lane_preserves_import_order_when_timestamps_match() -> Result<()> {
    let (db, org, event) = support::fixture().await?;
    let phones = ["+66830000003", "+66830000001", "+66830000002"];
    support::ingest(&db, &org, &event, &phones).await?;
    // Force UUID ordering opposite to row order; timestamp ties are normal within a commit.
    for (i, phone) in phones.iter().enumerate() {
        db::exec(
            &db,
            "UPDATE participants SET id=$1,eligible_at='2026-01-01' WHERE event_id=$2 AND phone=$3",
            vec![
                format!("{event}-{}", 3 - i).into(),
                event.clone().into(),
                (*phone).into(),
            ],
        )
        .await?;
    }
    policy::run(&db, &org, &event, json!({"action":"start"})).await?;
    for phone in phones {
        let claim = dispatch::claim(&db).await?.unwrap();
        assert_eq!(claim.phone, phone);
        dispatch::accepted(&db, &claim.id, "fifo-test").await?;
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
    }
    Ok(())
}
