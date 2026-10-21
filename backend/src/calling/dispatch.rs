use crate::{db, error::Result};
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde_json::Value;
#[derive(Debug, Clone)]
pub struct Claim {
    pub id: String,
    pub org: String,
    pub event: String,
    pub participant: String,
    pub phone: String,
    pub language: String,
}
pub async fn claim(db: &DatabaseConnection) -> Result<Option<Claim>> {
    let tx = db.begin().await?;
    let guard = db::one(
        &tx,
        "SELECT pg_try_advisory_xact_lock(71503621) AS acquired",
        vec![],
    )
    .await?;
    if !db::get::<bool>(&guard, "acquired")? {
        tx.commit().await?;
        return Ok(None);
    }
    let active=db::one(&tx,"SELECT count(*) AS count FROM attempts WHERE status IN ('reserved','uncertain','accepted')",vec![]).await?;
    if db::get::<i64>(&active, "count")? >= 1 {
        tx.commit().await?;
        return Ok(None);
    }
    let queues=db::rows(&tx,"SELECT q.* FROM queue_policy q JOIN events e ON e.id=q.event_id WHERE q.status='running' AND e.data->>'status'<>'archived' AND EXISTS(SELECT 1 FROM participants p WHERE p.event_id=q.event_id AND p.state IN ('ready','delayed') AND p.eligible_at<=now() AND p.attempt_count-p.cycle_base<=q.max_retries AND NOT EXISTS(SELECT 1 FROM schedules s WHERE s.event_id=p.event_id AND s.status='running' AND NOT (s.data->'participantIds' ? p.id))) AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.event_id=q.event_id AND a.status IN ('reserved','uncertain','accepted')) ORDER BY q.event_id FOR UPDATE OF q SKIP LOCKED LIMIT 1",vec![]).await?;
    let Some(queue) = queues.first() else {
        tx.commit().await?;
        return Ok(None);
    };
    let org: String = db::get(queue, "org_id")?;
    let event: String = db::get(queue, "event_id")?;
    let turn: i32 = db::get(queue, "turn")?;
    let new: i32 = db::get(queue, "new_weight")?;
    let cap: i32 = db::get(queue, "max_retries")?;
    db::exec(&tx,"UPDATE participants SET state='stopped' WHERE event_id=$1 AND state IN ('ready','delayed') AND attempt_count-cycle_base >= $2",vec![event.clone().into(),(cap+1).into()]).await?;
    let lane = if turn < new { "new" } else { "fail" };
    let people=db::rows(&tx,"SELECT * FROM participants WHERE event_id=$1 AND state IN ('ready','delayed') AND eligible_at<=now() AND attempt_count-cycle_base<$2 AND NOT EXISTS(SELECT 1 FROM schedules s WHERE s.event_id=participants.event_id AND s.status='running' AND NOT (s.data->'participantIds' ? participants.id)) ORDER BY (lane=$3) DESC,eligible_at,id FOR UPDATE SKIP LOCKED LIMIT 1",vec![event.clone().into(),(cap+1).into(),lane.into()]).await?;
    let Some(person) = people.first() else {
        tx.commit().await?;
        return Ok(None);
    };
    let id = uuid::Uuid::new_v4().to_string();
    let participant: String = db::get(person, "id")?;
    let data: Value = db::get(person, "data")?;
    let number = db::get::<i32>(person, "attempt_count")? + 1;
    db::exec(&tx,"INSERT INTO attempts(id,org_id,event_id,participant_id,number,status,lane) VALUES($1,$2,$3,$4,$5,'reserved',$6)",vec![id.clone().into(),org.clone().into(),event.clone().into(),participant.clone().into(),number.into(),db::get::<String>(person,"lane")?.into()]).await?;
    db::exec(
        &tx,
        "UPDATE participants SET state='awaiting_result' WHERE id=$1",
        vec![participant.clone().into()],
    )
    .await?;
    tx.commit().await?;
    Ok(Some(Claim {
        id,
        org,
        event,
        participant,
        phone: db::get(person, "phone")?,
        language: data["lang_code"].as_str().unwrap_or("th").into(),
    }))
}
pub async fn accepted(db: &DatabaseConnection, id: &str, provider: &str) -> Result<()> {
    let tx = db.begin().await?;
    let a = db::one(
        &tx,
        "SELECT * FROM attempts WHERE id=$1 FOR UPDATE",
        vec![id.into()],
    )
    .await?;
    let status: String = db::get(&a, "status")?;
    if status == "reserved" || status == "uncertain" {
        let event: String = db::get(&a, "event_id")?;
        let participant: String = db::get(&a, "participant_id")?;
        db::exec(
            &tx,
            "UPDATE attempts SET status='accepted',provider_id=$2 WHERE id=$1",
            vec![id.into(), provider.into()],
        )
        .await?;
        db::exec(
            &tx,
            "UPDATE participants SET attempt_count=$2 WHERE id=$1",
            vec![participant.into(), db::get::<i32>(&a, "number")?.into()],
        )
        .await?;
        db::exec(
            &tx,
            "UPDATE queue_policy SET turn=CASE WHEN $2='new' THEN CASE WHEN turn<new_weight THEN turn+1 ELSE turn END WHEN turn<new_weight THEN 0 ELSE (turn+1)%(new_weight+retry_weight) END WHERE event_id=$1",
            vec![event.into(), db::get::<String>(&a,"lane")?.into()],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
pub async fn uncertain(db: &DatabaseConnection, id: &str) -> Result<()> {
    db::exec(
        db,
        "UPDATE attempts SET status='uncertain' WHERE id=$1 AND status='reserved'",
        vec![id.into()],
    )
    .await?;
    Ok(())
}
