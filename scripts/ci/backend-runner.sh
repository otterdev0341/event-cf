#!/usr/bin/env bash
set -euo pipefail
export CARGO_BUILD_JOBS=1
export CARGO_HOME=/work/.cargo-ci
export TEST_DATABASE_URL="$DATABASE_URL"
mkdir -p backend/reports
cargo test --locked --manifest-path backend/Cargo.toml -- --test-threads=1 > backend/reports/rust-tests.log 2>&1
cargo build --locked --manifest-path backend/Cargo.toml
touch backend/reports/rust-passed
exec backend/target/debug/event-confirm-api
