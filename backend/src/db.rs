use crate::error::{Result, missing};
use sea_orm::{ConnectionTrait, DbBackend, QueryResult, Statement, Value};
pub async fn rows(
    db: &impl ConnectionTrait,
    sql: &str,
    args: Vec<Value>,
) -> Result<Vec<QueryResult>> {
    Ok(db
        .query_all(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            args,
        ))
        .await?)
}
pub async fn one(db: &impl ConnectionTrait, sql: &str, args: Vec<Value>) -> Result<QueryResult> {
    rows(db, sql, args)
        .await?
        .into_iter()
        .next()
        .ok_or_else(missing)
}
pub async fn exec(db: &impl ConnectionTrait, sql: &str, args: Vec<Value>) -> Result<u64> {
    Ok(db
        .execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            sql,
            args,
        ))
        .await?
        .rows_affected())
}
pub fn get<T: sea_orm::TryGetable>(row: &QueryResult, name: &str) -> Result<T> {
    Ok(row.try_get("", name)?)
}
pub async fn migrate(db: &sea_orm::DatabaseConnection) -> Result<()> {
    use sea_orm::TransactionTrait;
    let tx = db.begin().await?;
    exec(&tx, "SELECT pg_advisory_xact_lock(71503620)", vec![]).await?;
    exec(&tx,"CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY,digest text NOT NULL)",vec![]).await?;
    for (version, source) in [
        (1, include_str!("../migrations/001_core.sql")),
        (2, include_str!("../migrations/002_identity.sql")),
    ] {
        let digest = crate::auth::password::digest(source);
        let applied = rows(
            &tx,
            "SELECT digest FROM schema_migrations WHERE version=$1",
            vec![version.into()],
        )
        .await?;
        if let Some(row) = applied.first() {
            if get::<String>(row, "digest")? != digest {
                return Err(crate::error::Error(
                    503,
                    "Applied migration checksum mismatch".into(),
                ));
            }
            continue;
        }
        for statement in source.split(';') {
            if !statement.trim().is_empty() {
                exec(&tx, statement, vec![]).await?;
            }
        }
        exec(
            &tx,
            "INSERT INTO schema_migrations(version,digest) VALUES($1,$2)",
            vec![version.into(), digest.into()],
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
