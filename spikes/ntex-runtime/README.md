# Phase 0 runtime compatibility spike

Not a production API. Pins Rust 1.97.0, ntex 4.3.0 (Tokio feature), SeaORM 1.1.20
(PostgreSQL + runtime-tokio-rustls), Tokio 1.54.0 and reqwest 0.12.28 in Cargo.lock.

Verified against disposable PostgreSQL 17: one ntex runtime concurrently awaits a
SeaORM SQL query and a delayed local fake HTTP provider. The result is checked and
the connection pool closed. No external voice provider, real credentials or tenant
schema is involved. Rust 1.96 cannot compile these ntex dependencies; the spike's
rust-toolchain.toml selects 1.97 without changing other projects' default toolchain.

```bash
cd spikes/ntex-runtime
cargo build --locked -j 1
SPIKE_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:PORT/DISPOSABLE_DB cargo run --locked -j 1
```

Test evidence: `PASS: ntex Tokio runtime + SeaORM PostgreSQL + concurrent async HTTP`.
The temporary test database container was stopped/removed after the run; no volume
was retained. P6 must still implement ntex handlers, authentication, migration,
bounded password hashing, deadlines, shutdown and tenant-isolation tests. This probe
establishes dependency/runtime compatibility, not production readiness or capacity.
