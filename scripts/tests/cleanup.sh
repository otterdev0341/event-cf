#!/usr/bin/env bash
set -euo pipefail
source_script="$(pwd)/scripts/ci/cleanup.sh"
fixture=$(mktemp -d /tmp/event-confirm-cleanup-test.XXXXXX)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/repo" "$fixture/bin" "$fixture/outside"
cd "$fixture/repo"
git init -q
mkdir -p backend/target backend/reports tests/api/build tests/api/.gradle .cargo-ci .gradle-ci frontend/{dist,node_modules,test-results,reports} .npm other-project/build
touch frontend/dist/disposable.js frontend/node_modules/keep.js frontend/test-results/runtime.txt
 touch frontend/reports/unit.xml .npm/cache other-project/build/keep.txt "$fixture/outside/keep.txt"
ln -s "$fixture/outside" frontend/coverage
git add -f frontend/node_modules/keep.js other-project/build/keep.txt
cat > "$fixture/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [[ "$1 $2" == 'ps -aq' ]]; then echo fixture-runtime; exit 0; fi
if [[ "$1" == inspect ]]; then echo "$PWD/frontend/test-results"; exit 0; fi
if [[ "$1 $2" == 'image ls' ]]; then exit 0; fi
echo "Unexpected Docker operation: $*" >&2
exit 1
STUB
chmod +x "$fixture/bin/docker"
PATH="$fixture/bin:$PATH" bash "$source_script" --apply > "$fixture/result.log"
[[ ! -e backend/target && ! -e backend/reports && ! -e tests/api/build && ! -e .cargo-ci && ! -e .gradle-ci ]]
[[ ! -e frontend/dist && ! -e frontend/reports && ! -e .npm ]]
[[ -f frontend/node_modules/keep.js && -f frontend/test-results/runtime.txt ]]
[[ -L frontend/coverage && -f "$fixture/outside/keep.txt" && -f other-project/build/keep.txt ]]
echo 'PASS: cleanup deletes owned outputs; protects tracked files, symlink escapes, runtime binds and other projects'
