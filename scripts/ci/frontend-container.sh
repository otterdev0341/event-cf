#!/usr/bin/env bash
set -euo pipefail
# The Docker daemon is outside Jenkins. Map ONLY this job's directory from the
# controller's actual volume source; never expose the whole Jenkins home/socket.
: "${WORKSPACE:?Jenkins workspace required}"
: "${BUILD_NUMBER:?Jenkins build identity required}"
workspace=$(realpath "$WORKSPACE")
[[ "$workspace" == /var/jenkins_home/workspace/* && "$PWD" == "$workspace" ]] || {
  echo 'Unexpected Jenkins workspace; refusing broad mount' >&2; exit 2;
}
volume_source=$(docker inspect --format \
  '{{range .Mounts}}{{if eq .Destination "/var/jenkins_home"}}{{.Source}}{{end}}{{end}}' \
  otter-control-plane-jenkins)
[[ "$volume_source" == /* && "$volume_source" != / ]] || exit 2
host_workspace="$volume_source/${workspace#/var/jenkins_home/}"
docker run --rm --init \
  --cpus=1 --memory=1536m --memory-swap=1536m --pids-limit=256 \
  --label ci.project=event-confirm --label ci.purpose=frontend-validation \
  --label "ci.build=$BUILD_NUMBER" --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$host_workspace,target=/work" -w /work \
  -e HOME=/tmp -e CI=true \
  mcr.microsoft.com/playwright:v1.64.1-noble bash scripts/ci/frontend.sh
