#!/usr/bin/env bash
set -euo pipefail
# Called inside the bounded CI container, with this repository mounted at its Jenkins workspace path.
export npm_config_cache="$PWD/.npm"
export CI=true
export NODE_OPTIONS=--max-old-space-size=768
node scripts/checks/source-lines.mjs
npm ci --prefix frontend --no-fund
node scripts/checks/frontend-boundaries.mjs
node frontend/scripts/contracts.mjs
node frontend/scripts/openapi.mjs
npm run format:check --prefix frontend
npm run typecheck --prefix frontend
npm run test --prefix frontend -- --reporter=default --reporter=junit --outputFile=reports/unit.xml
npm run build --prefix frontend
node scripts/checks/production-bundle.mjs
npm run test:e2e --prefix frontend
# Explicit public UI demo requested by the owner; real-API build is checked above.
npm run build:demo --prefix frontend
npm run test:demo --prefix frontend
