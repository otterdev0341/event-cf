#!/usr/bin/env bash
set -euo pipefail
# Synthetic adapters only. Stop immediately after signal registration, before first tick.
: "${DATABASE_URL:?Disposable test database required}"
: "${TEST_DATABASE_URL:?Disposable test database required}"
[[ "$DATABASE_URL" == "$TEST_DATABASE_URL" ]] || exit 2
mkdir -p backend/reports
child=''
cleanup() {
  if [[ -n "$child" ]]; then kill -KILL "$child" 2>/dev/null || true; fi
}
trap cleanup EXIT
for mode in worker mailer; do
  log="backend/reports/$mode-shutdown.log"
  CALLING_ENABLED=true MAIL_ENABLED=true \
    PROVIDER_URL=http://127.0.0.1:9 PROVIDER_TOKEN=synthetic \
    MAIL_API_URL=http://127.0.0.1:9 MAIL_API_TOKEN=synthetic \
    backend/target/debug/event-confirm-api "$mode" >"$log" 2>&1 &
  child=$!
  ready=false
  for attempt in {1..100}; do
    if grep -q 'shutdown listener ready' "$log"; then ready=true; break; fi
    kill -0 "$child" 2>/dev/null || { cat "$log"; exit 1; }
    sleep .1
  done
  "$ready" || { cat "$log"; exit 1; }
  kill -TERM "$child"
  exited=false
  for attempt in {1..100}; do
    if ! kill -0 "$child" 2>/dev/null; then exited=true; break; fi
    sleep .1
  done
  "$exited" || { cat "$log"; exit 1; }
  wait "$child"
  child=''
  echo "PASS $mode exits successfully on SIGTERM"
done
