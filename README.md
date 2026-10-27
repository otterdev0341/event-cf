# Voice Confirm

React + Vite interface for Voice Bot calls, reports, agents and campaign CSV workflows, served with a Go API from one container under the `/event-confirm/` base path.

## Layout

- `src/` – React frontend (Vite, TypeScript).
- `shared/` – campaign, queue, schedule and recording-repair rules used by the frontend and the Node tests.
- `backend/` – Go server: `/event-confirm/api/*` plus the built frontend from `dist`. Standard library only, apart from `golang.org/x/text`.
- `supabase/migrations/` – tables, RLS and RPCs. Apply in filename order.
- `infra/Dockerfile`, `compose.yaml`, `Jenkinsfile` – image build and host deployment.
- `docs/` – architecture and feature documentation ([index](docs/README.md)).

## Setup

Requires Node 22 and Go 1.26.

1. Install dependencies with `npm ci`.
2. Copy `.env.example` to `.env`, configure Supabase and server-only Voice Bot credentials.
3. Follow [Backend and database setup](docs/BACKEND_SETUP.md) to apply the migrations and approve Supabase login accounts.
4. Start the Go API with the `.env` variables exported. The server does not read `.env` itself:
   ```bash
   set -a; . ./.env; set +a
   cd backend && ADDR=127.0.0.1:8080 go run .
   ```
   In Git Bash on Windows, prefix the command with `MSYS_NO_PATHCONV=1`. Otherwise Git Bash rewrites values that start with `/` (possible in base64 keys) into Windows paths, and the backend reports "ผู้ดูแลยังตั้งค่าระบบเชื่อมบัญชีไม่ครบ".
5. Start the frontend with `npm run dev` and open `http://127.0.0.1:5173/event-confirm/`. Vite proxies `/event-confirm/api` to the Go server (override with `API_ORIGIN`).

## Server configuration

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | Supabase project URL (the server accepts either). |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key used to validate browser sessions. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Callbacks, scheduler and Agent setup audits. |
| `VOICE_CONNECTION_ENCRYPTION_KEY` | Server-only AES-256 key (32 bytes, Base64) for stored personal Voice Bot JWTs. |
| `VOICE_BOT_BASE_URL` | Voice Bot API origin. |
| `VOICE_BOT_LOGS_BASE_URL` | Optional Voice Bot log/audio origin. |
| `VOICE_RESULT_CALLBACK_URL`, `VOICE_RESULT_CALLBACK_SECRET` | Public result receiver URL and root callback secret (min. 32 characters). New Agent Tools receive account-specific derived keys, never the root secret. |
| `VOICE_ACCESS_MODE`, `VOICE_ALLOWED_EMAILS`, `VOICE_ALLOWED_USER_IDS` | `members` (default) or `allowlist` access. |
| `BASE_PATH`, `ADDR`, `STATIC_DIR` | Defaults: `/event-confirm`, `:80`, `dist`. The image sets `ADDR=:8080` and `STATIC_DIR=/app/dist`. |

Never put server-only values in `VITE_` variables. Callback endpoints return HTTP 503 until their settings are complete.

## API routes

| Route | Caller | Purpose |
| --- | --- | --- |
| `GET /event-confirm/healthz` | Host | Health check. |
| `/event-confirm/api/voice?path=…` | Browser (Supabase session) | Allowed Voice Bot and workspace operations only. Not a general proxy. |
| `POST /event-confirm/api/voice-result` | Agent HTTP Tool | Final call result ([setup](docs/VOICE_RESULT_SETUP.md)). |
| `POST /event-confirm/api/voice-recording` | Botnoi system | Call ID to recording file link ([contract](docs/BOTNOI_RECORDING_CALLBACK.md)). |
| `POST /event-confirm/api/voice-events` | Agent HTTP Tool | Public event information for inbound calls ([inbound](docs/INBOUND.md)). |
| `POST /event-confirm/api/voice-scheduler` | Supabase cron | Campaign worker tick ([scheduler](SCHEDULER_SETUP.md)). |

OpenAPI spec: [`public/openapi.yaml`](public/openapi.yaml), rendered with ReDoc at `/event-confirm/api-docs.html` (`https://otterdev.xyz/event-confirm/api-docs.html`).

The browser sends only its Supabase session. The backend validates the session, confirmed email (members mode), account, Agent and permitted endpoint. Each member uses their own connected Voice Bot JWT, which the server stores encrypted and never returns to the browser ([connection](docs/PERSONAL_VOICE_BOT_CONNECTION.md)). Supabase workspace data is owner-scoped. Telephony administration operations are not exposed.

## Campaigns and calls

- Campaigns and imported contact rows are stored in Supabase with owner RLS. Saving detects conflicts across tabs and devices. Earlier browser drafts can be imported explicitly.
- `{{variable}}` placeholders in the Agent greeting and instruction are filled per contact from mapped CSV columns and sent in `metadata.variables`. Provider-side prompt substitution is not yet confirmed.
- Calls run from a manual queue on the campaign page, or from optional one-time or recurring server alarms ([scheduler](SCHEDULER_SETUP.md)). Deterministic request IDs and a database reservation prevent duplicate dialing.
- Call results come only from explicit provider fields, the Agent result Tool, or manual review with a note ([call results](docs/CALL_RESULTS.md)). Transcripts are never interpreted as outcomes. No mock API responses or fabricated outcomes are used.
- Live microphone conversations are not implemented.

## Build and deployment

`npm run build` compiles TypeScript and creates `dist`. `infra/Dockerfile` builds the frontend and the Go binary, runs both test suites and produces one image. Jenkins builds it and deploys it with `compose.yaml` to `https://otterdev.xyz/event-confirm/` ([host deployment](docs/HOST_DEPLOYMENT.md)). CI runs typechecks for the frontend and backend on `dev` and `main`.

## Tests

`npm test` runs the offline Node checks (CSV and client logic, shared rules, and the real SQL migrations and RLS in disposable PostgreSQL via PGlite). It then runs `go test ./...` in `backend/`, which covers the handlers plus golden tests against the previous Node implementation. It never makes external calls or changes the connected Supabase project. Run only the Go tests with `npm run test:go`.

`npm run test:readiness` performs read-only connectivity and configuration checks using local environment settings. It exits nonzero when configuration or tables are missing. It never places calls.

See [test results and remaining blockers](docs/TEST_REPORT.md). The older `test:integration` scripts have not been adapted for this backend and are not included in `npm test`.

## Voice recordings

- Search owned Agent logs using GET /logs/list_file/ with start_date and end_date (YYYY/MM/DD); the workspace accepts a maximum 31-day range.
- The provider lists .txt records. Replace only the final .txt extension with .wav and fetch GET /logs/audio?file_path on backend-voicebot-stg.botnoigroup.com. This returns WAV bytes, not a JSON audio URL.
- The website streams audio through an authenticated workspace route using the saved server-side Voice Bot JWT. It rechecks account and Agent ownership, validates the selected file against the current list, and never sends the provider JWT to the browser. VOICE_BOT_LOGS_BASE_URL can configure the provider log origin on the server.
- Recordings appear on the Agent, campaign, and inbound pages. File timestamps are shown as supplied by the provider. They are not assigned to individual contacts without an exact provider Call ID or file reference.
- `go test` in `backend/` covers listing, authorization, WAV streaming and input validation (`TestAudioLibrary`).

The recording player automatically applies the user-reviewed PCM/packed mu-law listening repair after loading audio. Processing runs locally in a Web Worker and labels the derivative with its adjusted duration. The original remains at the provider; the player offers only the adjusted listening download. Unsupported inputs show an explicit error without playing unadjusted audio. It is limited to PCM16 stereo 8 kHz inputs under 16 MB; it is not an authoritative call timeline.
