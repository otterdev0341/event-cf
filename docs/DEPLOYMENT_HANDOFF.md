# Vercel redeploy handoff

Repository: `pannawat1233/voice-confirm`, branch `main`.

Read [BACKEND_SETUP.md](BACKEND_SETUP.md) before redeploying. This version requires Supabase tables, authenticated users and a server access mode. Deploy the repository including `api/voice.mjs`, not only the `dist` directory.

- Install: `npm ci`
- Build: `npm run build`
- Output: `dist`
- SPA routing: `vercel.json` excludes `/api/` from the HTML fallback.
- Set server-only `VOICE_BOT_ACCESS_TOKEN`, `VOICE_BOT_BASE_URL` and `VOICE_ACCESS_MODE=members` for automatic access after email confirmation. Remove old `VITE_VOICE_BOT_ACCESS_TOKEN` configuration.
- Migration `supabase/migrations/202610090001_voice_workspace.sql` was installed in the configured Supabase project on 11 October 2026. Both tables have RLS enabled. Do not rerun blindly: policy creation is not idempotent. Apply once as project owner only when deploying to a fresh database.

UI sample records and fabricated API fallbacks were removed. Campaign CSV records now persist to the authenticated user's Supabase workspace. The old local data can be explicitly imported. Upstream reports and transcripts remain read from Voice Bot; missing business outcomes are not fabricated.

Previous national-number calls succeeded through the older local browser flow. The authenticated backend now passes signed-in account reads and the cloud campaign/call-history reads succeed locally. Production Vercel environment configuration and a complete write/call flow still need verification; earlier call results do not verify the new flow. Use `VOICE_ACCESS_MODE=members` in production as requested by the owner; allowlist entries are ignored in this mode. Members share the central Voice Bot account, quota and upstream reports/logs. Supabase campaign/contact/request rows remain private per user. Local .env.local is ignored by Git. Prompt interpolation from metadata is not documented by the provider and remains unconfirmed.

For Agent result callbacks, complete [VOICE_RESULT_SETUP.md](VOICE_RESULT_SETUP.md). No live callback delivery has been verified yet.
