#!/usr/bin/env bash
set -euo pipefail
base=${1:-http://172.17.0.1:18346}
[[ "$(curl -fsS --max-time 15 "$base/event-confirm/healthz")" == ok ]]
for path in /event-confirm/ /event-confirm/nested/path; do
  curl -fsS --max-time 15 "$base$path" | grep -q '<title>Event Confirm'
done
[[ "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$base/event-confirm/api/voice")" == 503 ]]
html=$(curl -fsS --max-time 15 "$base/event-confirm/")
asset=$(sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' <<< "$html" | head -1)
[[ "$asset" == /event-confirm/assets/* ]]
curl -fsS --max-time 15 "$base$asset" -o /dev/null
[[ "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$base/event-confirm/assets/missing.js")" == 404 ]]
headers=$(curl -sSI --max-time 15 "$base/event-confirm")
grep -q ' 308 ' <<< "$headers"
if [[ "$base" == https://* ]]; then
  grep -qi "location: $base/event-confirm/" <<< "$headers"
  curl -fsSI --max-time 15 "$base/event-confirm/" | grep -qi 'X-Shared-Edge-Route: event-confirm'
fi

curl -fsS --max-time 15 "$base/event-confirm/swagger-ui/" | grep -q 'Swagger UI'
openapi=$(curl -fsS --max-time 15 "$base/event-confirm/swagger-ui/openapi.json")
grep -q '"openapi": "3.1.0"' <<< "$openapi"
[[ "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "$base/event-confirm/swagger-ui")" == 308 ]]
