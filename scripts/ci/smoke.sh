#!/usr/bin/env bash
set -euo pipefail
base=${1:-http://172.17.0.1:18346}
[[ "$(curl -fsS --max-time 15 "$base/event-confirm/healthz")" == ok ]]
for path in /event-confirm/ /event-confirm/nested/path; do
  curl -fsS --max-time 15 "$base$path" | grep -q '<div id="root">'
done
# Anonymous API calls are rejected by the application, not a placeholder.
[[ "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$base/event-confirm/api/voice?path=%2Fme")" == 401 ]]
headers=$(curl -sSI --max-time 15 "$base/event-confirm")
grep -q ' 308 ' <<< "$headers"
grep -qiE "location: ($base)?/event-confirm/" <<< "$headers"
if [[ "$base" == https://* ]]; then
  curl -fsSI --max-time 15 "$base/event-confirm/" | grep -qi 'X-Shared-Edge-Route: event-confirm'
fi
