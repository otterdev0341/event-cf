# Voice Confirm

React + Vite interface for Voice Bot calls, reports, agents and campaign CSV workflows.

## Setup

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env.local`, configure Supabase and server-only Voice Bot credentials.
3. Follow [Backend and database setup](docs/BACKEND_SETUP.md) to apply the migration and approve Supabase login accounts.
4. Start with `npm run dev`.

Voice Bot credentials stay in `/api/voice`; the browser sends only its Supabase session. The backend validates the session, confirmed email (members mode), account, agent and permitted endpoint. All confirmed members can use the central Voice Bot account by default; set VOICE_ACCESS_MODE=allowlist for optional restricted access. Supabase workspace data remains owner-scoped, while upstream Voice Bot reports and quota are shared. It does not expose a general proxy or telephony administration operations.

Campaigns and imported contact rows are stored in Supabase with owner RLS. Saving detects conflicts across tabs/devices. Earlier browser drafts are available for explicit import. No mock API responses or fabricated participation outcomes are used.

Per-contact variables are previewed and sent in outbound metadata. Provider-side prompt substitution is not yet confirmed. Batch dialing, schedules, live microphone conversations and RSVP outcome processing remain unimplemented.

## Build and deployment

`npm run build` compiles TypeScript and creates `dist`. Deploy the full repository to Vercel so its API function is included; static-only hosting is insufficient. See [deployment handoff](docs/DEPLOYMENT_HANDOFF.md).

## Tests

`npm test` runs 50 offline checks across CSV/client logic, authenticated backend behavior, and the real SQL migration/RLS in disposable PostgreSQL (PGlite). It never makes external calls or changes the connected Supabase project.

`npm run test:readiness` performs read-only connectivity and configuration checks using local environment settings. It exits nonzero when configuration or tables are missing. It never places calls.

See [test results and remaining blockers](docs/TEST_REPORT.md). The older `test:integration` scripts have not been adapted for this backend and are not included in `npm test`.
