use super::time::Rule;
use crate::{auth, db, error::Result};
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde_json::Value;
// One short transaction advances at most one schedule; no provider I/O occurs here.
pub async fn tick(db: &DatabaseConnection) -> Result<()> {
    let tx = db.begin().await?;
    let rows = db::rows(&tx,"SELECT s.* FROM schedules s JOIN queue_policy q ON q.event_id=s.event_id WHERE (s.status='scheduled' OR (s.status='running' AND q.status='running')) AND s.next_at<=now() ORDER BY s.next_at,s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1",vec![]).await?;
    let Some(row) = rows.first() else {
        tx.commit().await?;
        return Ok(());
    };
    let id: String = db::get(row, "id")?;
    let org: String = db::get(row, "org_id")?;
    let event: String = db::get(row, "event_id")?;
    let user_id: String = db::get(row, "user_id")?;
    let user = db::one(
        &tx,
        "SELECT root FROM users WHERE id=$1",
        vec![user_id.clone().into()],
    )
    .await?;
    let user = auth::User {
        id: user_id,
        root: db::get(&user, "root")?,
    };
    let current = db::one(
        &tx,
        "SELECT version,data FROM events WHERE id=$1",
        vec![event.clone().into()],
    )
    .await?;
    let permitted = auth::scope(&tx, &user, &org, Some(&event), true, false)
        .await
        .is_ok();
    if !permitted
        || db::get::<i32>(&current, "version")? != db::get::<i32>(row, "event_version")?
        || db::get::<Value>(&current, "data")?["status"] == "archived"
    {
        db::exec(
            &tx,
            "UPDATE schedules SET status='failed',version=version+1 WHERE id=$1",
            vec![id.into()],
        )
        .await?;
        if db::get::<String>(row, "status")? == "running" {
            db::exec(
                &tx,
                "UPDATE queue_policy SET status='paused',version=version+1 WHERE event_id=$1",
                vec![event.into()],
            )
            .await?;
        }
        tx.commit().await?;
        return Ok(());
    }
    db::one(
        &tx,
        "SELECT event_id FROM queue_policy WHERE event_id=$1 FOR UPDATE",
        vec![event.clone().into()],
    )
    .await?;
    let state = crate::calling::policy::state(&tx, &org, &event).await?;
    if state["pendingTurn"] == true {
        tx.commit().await?;
        return Ok(());
    }
    let rule: Rule = serde_json::from_value(db::get(row, "data")?)?;
    if db::get::<String>(row, "status")? == "running" {
        if state["status"] != "running" {
            tx.commit().await?;
            return Ok(());
        }
        let pending = db::rows(&tx,"SELECT p.id FROM participants p JOIN schedules s ON s.event_id=p.event_id WHERE s.id=$1 AND s.active_participant_ids ? p.id AND p.state IN ('ready','delayed','awaiting_result') LIMIT 1",vec![id.clone().into()]).await?;
        if !pending.is_empty() {
            tx.commit().await?;
            return Ok(());
        }
        let next = if rule.recurrence == "once" {
            None
        } else {
            Some(rule.next(chrono::Utc::now())?)
        };
        db::exec(&tx,"UPDATE schedules SET status=$2,next_at=COALESCE($3,next_at),completed_runs=completed_runs+1,version=version+1 WHERE id=$1",
            vec![id.into(),(if next.is_some() { "scheduled" } else { "completed" }).into(),next.into()]).await?;
        db::exec(
            &tx,
            "UPDATE queue_policy SET status='paused',version=version+1 WHERE event_id=$1",
            vec![event.into()],
        )
        .await?;
    } else {
        if state["status"] == "running" {
            tx.commit().await?;
            return Ok(());
        }
        let occurrence = uuid::Uuid::new_v4().to_string();
        let due: chrono::DateTime<chrono::Utc> = db::get(row, "next_at")?;
        db::exec(
            &tx,
            "INSERT INTO schedule_occurrences(id,schedule_id,scheduled_at) VALUES($1,$2,$3)",
            vec![occurrence.into(), id.clone().into(), due.into()],
        )
        .await?;
        let mut active = Vec::new();
        for person in &rule.participant_ids {
            let participant = db::one(
                &tx,
                "SELECT attempt_count FROM participants WHERE event_id=$1 AND id=$2",
                vec![event.clone().into(), person.clone().into()],
            )
            .await?;
            if !rule.redial && db::get::<i32>(&participant, "attempt_count")? > 0 {
                continue;
            }
            active.push(person.clone());
            if rule.redial {
                db::exec(&tx,"UPDATE participants SET cycle_base=attempt_count,lane='new',state='ready',eligible_at=now(),data=jsonb_set(data,'{outcome}','{\"result\":null,\"reason\":null}') WHERE event_id=$1 AND id=$2",vec![event.clone().into(),person.clone().into()]).await?;
            } else {
                db::exec(&tx,"UPDATE participants SET lane='new',state='ready',eligible_at=now() WHERE event_id=$1 AND id=$2 AND attempt_count=0",vec![event.clone().into(),person.clone().into()]).await?;
            }
        }
        db::exec(
            &tx,
            "UPDATE queue_policy SET status='running',turn=0,version=version+1 WHERE event_id=$1",
            vec![event.into()],
        )
        .await?;
        db::exec(
            &tx,
            "UPDATE schedules SET status='running',active_participant_ids=$2,version=version+1 WHERE id=$1",
            vec![id.into(),serde_json::json!(active).into()],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
