#!/usr/bin/env bash
set -euo pipefail
: "${EVENT_CONFIRM_ENV_FILE:?Runtime environment file required}"
previous=$(docker image ls -q event-confirm/web:deployed)
previous_api=$(docker image ls -q event-confirm/api:deployed)
for component in web api provider; do
  image=$(docker image ls -q "event-confirm/$component:deployed")
  if [[ -n "$image" ]]; then docker tag "$image" "event-confirm/$component:rollback"; fi
done
compose=(docker compose --env-file "$EVENT_CONFIRM_ENV_FILE")
if ! "${compose[@]}" up -d --no-build --wait --wait-timeout 120 || ! bash scripts/ci/smoke.sh; then
  if [[ -n "$previous_api" ]]; then
    echo "Smoke failed; restoring previous application images" >&2
    IMAGE_TAG=rollback "${compose[@]}" up -d --no-build --wait --wait-timeout 120
  elif [[ -n "$previous" ]]; then
    echo "First backend cutover failed; restoring prior frontend and stopping dispatch" >&2
    "${compose[@]}" stop worker
    IMAGE_TAG=rollback "${compose[@]}" up -d --no-deps --no-build web
  fi
  exit 1
fi
for component in web api provider; do
  docker tag "event-confirm/$component:$IMAGE_TAG" "event-confirm/$component:deployed"
done
