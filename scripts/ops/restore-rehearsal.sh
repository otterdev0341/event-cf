#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_ARCHIVE:?Local downloaded custom-format dump required}"
: "${RESTORE_CONTAINER:?Disposable PostgreSQL container name required}"
[[ "$RESTORE_CONTAINER" == event-confirm-restore-* ]] || exit 2
[[ "$(docker inspect --format '{{index .Config.Labels "ci.purpose"}}' "$RESTORE_CONTAINER")" == restore-rehearsal ]] || exit 2
docker exec -i "$RESTORE_CONTAINER" pg_restore -U event_confirm -d event_confirm \
  --exit-on-error --no-owner < "$RESTORE_ARCHIVE"
docker exec "$RESTORE_CONTAINER" psql -U event_confirm -d event_confirm -v ON_ERROR_STOP=1 -c \
  "UPDATE queue_policy SET status='paused'; UPDATE attempts SET status='uncertain' WHERE status='reserved';"
docker exec "$RESTORE_CONTAINER" psql -U event_confirm -d event_confirm -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) AS events FROM events; SELECT status,count(*) FROM attempts GROUP BY status;"
