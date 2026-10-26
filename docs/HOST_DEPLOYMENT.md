# Event Confirm host deployment

Jenkins deploys the full application: the React frontend and the Go API in one
container, served under `https://otterdev.xyz/event-confirm/`.

- `/event-confirm/` and nested paths serve the SPA (`dist/index.html` fallback).
- `/event-confirm/api/voice`, `voice-result`, `voice-recording`, `voice-events`
  and `voice-scheduler` are the API routes. Other `/event-confirm/api/*` paths return JSON 404.
- `/event-confirm/healthz` returns `ok`. `/event-confirm` redirects (308) to the trailing slash.

## Build

`infra/Dockerfile` has three stages:

1. Node: `npm ci`, the offline Node tests, then `npm run build` with the public
   `VITE_*` values as build args.
2. Go: `go vet`, `go test`, then a static binary.
3. Alpine runtime running as `nobody` on port 8080 with `STATIC_DIR=/app/dist`.

A failing test fails the image build, so nothing is deployed.

## Secrets

Runtime configuration comes from the env file named by `EVENT_CONFIRM_ENV_FILE`
(Jenkins sets `/var/jenkins_home/secrets/event-confirm.env`). It is never committed.
Use `.env.example` as the template. The Jenkins build also reads the public
`VITE_*` values from this file for the frontend build args. `docker compose config`
fails closed when the variable or file is missing.

## Runtime

The `event-confirm` Jenkins job checks out `main` from `otterdev0341/event-cf`.
It builds through `otter-shared-ci`, using the host's shared Docker lock and
single-step BuildKit concurrency/central cache GC. Runtime limits are 0.25 CPU,
128 MiB RAM (`GOMEMLIMIT=100MiB`) with no extra swap, 64 PIDs, a read-only root
filesystem, and two 5 MiB log files. Idle memory is about 4 MiB; the limit leaves
room for large campaign reads, which decode up to 32 MiB of JSON.
Host port 18346 (container port 8080) binds only loopback and the Docker bridge gateway.

`scripts/ci/deploy.sh` starts the new image, runs `scripts/ci/smoke.sh`, and restores
the previous image when the smoke test fails. The smoke test checks health, the SPA,
the redirect, and that an anonymous API call is rejected with 401 (which also proves
the server configuration loaded).

The campaign scheduler has no in-process timer. Supabase `pg_cron` must call
`/event-confirm/api/voice-scheduler`; see [SCHEDULER_SETUP](../SCHEDULER_SETUP.md).

## Edge and storage

Public routing belongs to the separate `shared-edge-nginx` service, whose config
is `cross_fade_project/infra/edge/gateway.conf`. It forwards the entire
`/event-confirm/` prefix.

CI requires 20 GiB, 10% free capacity and 10% free inodes on the workspace and
Docker backing filesystem. Both reside on the host root disk at initialization.
If storage mounts move, update the disk checks. Cleanup recovers project-owned
`node_modules`, `dist`, `coverage`, and `.npm` only, excluding tracked files,
symlinks and runtime mounts. It runs before builds and after success/failure/abort
when the agent is available; the next preflight recovers after agent loss.
The deployed and rollback images, all container-referenced images, and images
under seven days old are retained. Shared caches and all volumes are untouched.
Cleanup warnings remain visible without replacing the original build result.
