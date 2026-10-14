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

## Voice recordings

- Search owned Agent logs using GET /logs/list_file/ with start_date and end_date (YYYY/MM/DD); the workspace accepts a maximum 31-day range.
- The provider lists .txt records. Replace only the final .txt extension with .wav and fetch GET /logs/audio?file_path on backend-voicebot-stg.botnoigroup.com. This returns WAV bytes, not a JSON audio URL.
- The website streams audio through an authenticated workspace route using the saved server-side Voice Bot JWT. It rechecks account and Agent ownership, validates the selected file against the current list, and never sends the provider JWT to the browser. VOICE_BOT_LOGS_BASE_URL can configure the provider log origin on the server.
- Recordings appear on the Agent, campaign, and inbound pages. File timestamps are shown as supplied by the provider. They are not assigned to individual contacts without an exact provider Call ID or file reference.
- Run npm run test:audio for isolated listing, authorization, WAV streaming and input validation checks.

The recording player automatically applies the user-reviewed PCM/packed mu-law listening repair after loading audio. Processing runs locally in a Web Worker and labels the derivative with its adjusted duration. The original remains at the provider; the player offers only the adjusted listening download. Unsupported inputs show an explicit error without playing unadjusted audio. It is limited to PCM16 stereo 8 kHz inputs under 16 MB; it is not an authoritative call timeline.
