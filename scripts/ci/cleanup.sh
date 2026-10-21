#!/usr/bin/env bash
set -euo pipefail
mode=${1:---dry-run}
[[ "$mode" == --dry-run || "$mode" == --apply ]] || exit 2
root=$(git rev-parse --show-toplevel)
root=$(realpath "$root")
[[ "$root" != / && "$root" != "$HOME" && "$PWD" == "$root" ]] || exit 2
echo "event-confirm cleanup: $mode in $root"
df -B1 "$root"
df -i "$root"
# Capture all mounts, including stopped containers; failure must stop cleanup.
containers=$(docker ps -aq)
mounts=
if [[ -n "$containers" ]]; then
  mounts=$(docker inspect --format '{{range .Mounts}}{{println .Source}}{{end}}' $containers)
fi
# Only this project's regenerable build outputs. No tracked lib/libs or shared caches.
for relative in node_modules dist coverage .npm   frontend/node_modules frontend/dist frontend/test-results frontend/playwright-report frontend/coverage frontend/reports backend/target backend/reports tests/api/build tests/api/.gradle .cargo-ci .gradle-ci; do
  target="$root/$relative"
  [[ -e "$target" || -L "$target" ]] || continue
  if [[ -L "$target" || "$(realpath "$target")" != "$target" ||
        -n "$(git ls-files -- "$relative")" ]]; then
    echo "PROTECTED: $target (symlink, tracked file, or noncanonical path)"
    continue
  fi
  protected=false
  while IFS= read -r mount; do
    [[ -n "$mount" ]] || continue
    # Jenkins sees a named volume path; map its own workspace to the host path.
    host_target="$target"
    if [[ "$target" == /var/jenkins_home/* ]]; then
      host_target="/var/lib/docker/volumes/otterpipeline_jenkins_home/_data/${target#/var/jenkins_home/}"
    fi
    # Ignore the controller's workspace volume itself; protect runtime binds.
    [[ "$mount" == /var/lib/docker/volumes/otterpipeline_jenkins_home/_data ]] && continue
    if [[ "$host_target" == "$mount" || "$host_target" == "$mount/"* || "$mount" == "$host_target/"* ]]; then
      protected=true
    fi
  done <<< "$mounts"
  if "$protected"; then echo "PROTECTED runtime mount: $target"; continue; fi
  echo "Disposable workspace output: $target"
  [[ "$mode" != --apply ]] || rm -rf --one-file-system -- "$target"
done
# The current and previous successful images are tagged deployed and rollback.
# Retain all images younger than 7 days and every image used by ANY container.
images=$(docker image ls -q --filter label=ci.project=event-confirm | sort -u)
for image in $images; do
  id=$(docker image inspect --format '{{.Id}}' "$image")
  tags=$(docker image inspect --format '{{json .RepoTags}}' "$image")
  protected_tag=false
  for component in web api provider; do
    if [[ "$tags" == *"event-confirm/$component:deployed\""* || "$tags" == *"event-confirm/$component:rollback\""* ]]; then protected_tag=true; fi
  done
  "$protected_tag" && continue
  created=$(docker image inspect --format '{{.Created}}' "$image")
  (( $(date +%s) - $(date -d "$created" +%s) > 604800 )) || continue
  containers=$(docker ps -aq)
  references=
  [[ -z "$containers" ]] || references=$(docker inspect --format '{{.Image}}' $containers)
  if grep -Fxq "$id" <<< "$references"; then echo "PROTECTED referenced image: $id"; continue; fi
  echo "Eligible old project image: $id"
  # Unforced exact deletion also protects against a container reference race.
  if [[ "$mode" == --apply ]]; then
    mapfile -t refs < <(docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' "$id" | sed '/^$/d')
    owned=true
    for ref in "${refs[@]}"; do
      [[ "$ref" =~ ^event-confirm/(web|api|provider):jenkins-[0-9]+$ ]] || owned=false
    done
    if ! "$owned"; then echo "PROTECTED unexpected tag: $tags"; continue; fi
    if ((${#refs[@]})); then docker image rm "${refs[@]}"; else docker image rm "$id"; fi
  fi
done
# Shared BuildKit cache and every volume are intentionally retained.
df -B1 "$root"
