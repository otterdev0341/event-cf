#!/usr/bin/env bash
set -euo pipefail
: "${WORKSPACE:?Jenkins workspace required}"
: "${BUILD_NUMBER:?Build identity required}"
workspace=$(realpath "$WORKSPACE")
[[ "$workspace" == /var/jenkins_home/workspace/* && "$PWD" == "$workspace" ]] || exit 2
volume_source=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/jenkins_home"}}{{.Source}}{{end}}{{end}}' otter-control-plane-jenkins)
[[ "$volume_source" == /* && "$volume_source" != / ]] || exit 2
host_workspace="$volume_source/${workspace#/var/jenkins_home/}"
network="event-confirm-ci-$BUILD_NUMBER"
db="$network-db"
api="$network-api"
provider="$network-provider"
cleanup() {
  docker rm -f "$api" "$db" "$provider" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Small dedicated CI subnet; Docker rejects overlaps rather than reusing a live network.
docker network create --subnet "${EVENT_CONFIRM_CI_SUBNET:-10.203.45.0/28}" \
  --label ci.project=event-confirm "$network" >/dev/null
docker run -d --name "$db" --network "$network" --network-alias db \
  --label ci.project=event-confirm --label ci.purpose=validation \
  --cpus=.5 --memory=256m --memory-swap=256m --pids-limit=100 \
  --tmpfs /var/lib/postgresql/data:size=256m -e POSTGRES_USER=event_test \
  -e POSTGRES_PASSWORD=disposable-test-only -e POSTGRES_DB=event_test \
  postgres:17-alpine -c max_connections=20 -c shared_buffers=32MB -c statement_timeout=5000 >/dev/null
for attempt in {1..30}; do
  if docker exec "$db" pg_isready -U event_test -d event_test >/dev/null; then break; fi
  sleep 1
done
docker run -d --name "$provider" --network "$network" --network-alias provider \
  --label ci.project=event-confirm --label ci.purpose=validation \
  --cpus=.25 --memory=64m --memory-swap=64m --pids-limit=64 \
  --tmpfs /data:size=8m --mount "type=bind,source=$host_workspace/scripts/ops/simulated-provider.mjs,target=/app.mjs,readonly" \
  -e PROVIDER_TOKEN=acceptance-simulation-token-only node:22-bookworm-slim node /app.mjs >/dev/null
docker run -d --name "$api" --network "$network" --network-alias api \
  --label ci.project=event-confirm --label ci.purpose=validation \
  --cpus=1 --memory=1536m --memory-swap=1536m --pids-limit=256 \
  --user "$(id -u):$(id -g)" --mount "type=bind,source=$host_workspace,target=/work" -w /work \
  -e HOME=/tmp -e DATABASE_URL=postgres://event_test:disposable-test-only@db:5432/event_test \
  -e CALLING_ENABLED=true -e PROVIDER_URL=http://provider:8080 -e PROVIDER_TOKEN=acceptance-simulation-token-only \
  -e COOKIE_SECURE=false -e PUBLIC_ORIGIN=http://127.0.0.1:18446 -e BIND_ADDRESS=0.0.0.0:18460 \
  -e SEED_ADMIN_EMAIL=admin@example.test -e SEED_ADMIN_PASSWORD=acceptance-test-password \
  rust:1.97.0-bookworm bash scripts/ci/backend-runner.sh >/dev/null
ready=false
for attempt in {1..1200}; do
  if docker exec "$api" curl -fsS http://127.0.0.1:18460/healthz >/dev/null 2>&1; then ready=true; break; fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$api")" != true ]]; then docker logs "$api"; exit 1; fi
  sleep 1
done
"$ready" || { docker logs "$api"; exit 1; }
docker run --rm --network "$network" --cpus=1 --memory=768m --memory-swap=768m --pids-limit=128 \
  --label ci.project=event-confirm --label ci.purpose=validation --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$host_workspace,target=/work" -w /work/tests/api \
  -e JAVA_TOOL_OPTIONS="-XX:ActiveProcessorCount=1 -XX:+UseSerialGC" \
  -e GRADLE_USER_HOME=/work/.gradle-ci -e TEST_ADMIN_EMAIL=admin@example.test \
  -e TEST_ADMIN_PASSWORD=acceptance-test-password eclipse-temurin:21-jdk \
  ./gradlew test --no-daemon --max-workers=1 -Devent.baseUrl=http://api:18460
test -f backend/reports/rust-passed
test -f tests/api/build/test-results/test/TEST-eventconfirm.WorkspaceSpec.xml
docker run --rm --init --network "$network" --cpus=1 --memory=1536m --memory-swap=1536m --pids-limit=256   --label ci.project=event-confirm --label ci.purpose=validation --user "$(id -u):$(id -g)"   --mount "type=bind,source=$host_workspace,target=/work" -w /work/frontend   -e HOME=/tmp -e CI=true -e EVENT_CONFIRM_API_TARGET=http://api:18460   -e TEST_ADMIN_EMAIL=admin@example.test -e TEST_ADMIN_PASSWORD=acceptance-test-password   mcr.microsoft.com/playwright:v1.64.1-noble npm run test:backend
