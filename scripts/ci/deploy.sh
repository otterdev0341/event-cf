#!/usr/bin/env bash
set -euo pipefail
previous=$(docker image ls -q event-confirm/web:deployed)
if [[ -n "$previous" ]]; then docker tag event-confirm/web:deployed event-confirm/web:rollback; fi
if ! docker compose up -d --no-build --wait --wait-timeout 60 || ! bash scripts/ci/smoke.sh; then
  if [[ -n "$previous" ]]; then
    echo "Smoke failed; restoring previous deployment" >&2
    IMAGE_TAG=rollback docker compose up -d --no-build --wait --wait-timeout 60
  fi
  exit 1
fi
docker tag "event-confirm/web:$IMAGE_TAG" event-confirm/web:deployed
