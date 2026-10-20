# Event Confirm deployment foundation

The existing application is awaiting a rewrite. Jenkins deploys only the small
nginx readiness service in `infra/`, not the existing Vite/Vercel application.
`/event-confirm/` and nested paths show an explicit pending message.
`/event-confirm/api/*` returns JSON 503; `/event-confirm/healthz` returns 200.
No Supabase credentials, database migrations, scheduler, or outbound calls run.

The `event-confirm` Jenkins job checks out `main` from `otterdev0341/event-cf`.
It builds through `otter-shared-ci`, using the host's shared Docker lock and
single-step BuildKit concurrency/central cache GC. Runtime limits are 0.25 CPU,
64 MiB RAM with no extra swap, 64 PIDs, and two 5 MiB log files.
Host port 18346 binds only loopback and the Docker bridge gateway.

Public routing belongs to the separate `shared-edge-nginx` service, whose config
is `cross_fade_project/infra/edge/gateway.conf`. It forwards the entire
`/event-confirm/` prefix and redirects `/event-confirm` to its trailing slash.

CI requires 20 GiB, 10% free capacity and 10% free inodes on the workspace and
Docker backing filesystem. Both reside on the host root disk at initialization.
If storage mounts move, update the disk checks. Cleanup recovers project-owned
`node_modules`, `dist`, `coverage`, and `.npm` only, excluding tracked files,
symlinks and runtime mounts. It runs before builds and after success/failure/abort
when the agent is available; the next preflight recovers after agent loss.
The deployed and rollback images, all container-referenced images, and images
under seven days old are retained. Shared caches and all volumes are untouched.
Cleanup warnings remain visible without replacing the original build result.

When rewriting, replace the foundation Dockerfile/nginx response with the app
build and server. Keep navigation, assets, API and auth redirects under
`/event-confirm/`. Add application tests and publish their reports before
cleanup. Provision server secrets separately from Git, add database readiness,
and update the smoke assertions before enabling real application behavior.
