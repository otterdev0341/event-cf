#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_BUCKET:?s3:// bucket/prefix required}"
: "${BACKUP_DIRECTORY:?Private local backup directory required}"
[[ "$BACKUP_BUCKET" == s3://* ]] || exit 2
umask 077
mkdir -p "$BACKUP_DIRECTORY"
archive="$BACKUP_DIRECTORY/event-confirm-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose -f infra/backend/compose.yaml exec -T db \
  pg_dump -U event_confirm -d event_confirm --format=custom > "$archive"
[[ -s "$archive" ]]
sha256sum "$archive" > "$archive.sha256"
aws s3 cp "$archive" "$BACKUP_BUCKET/$(basename "$archive")" --sse AES256 --only-show-errors
aws s3 cp "$archive.sha256" "$BACKUP_BUCKET/$(basename "$archive.sha256")" --sse AES256 --only-show-errors
echo "Backup uploaded; restore rehearsal is a separate required gate."
