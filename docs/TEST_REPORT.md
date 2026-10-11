# CSV campaign queue — 11 October 2026

- Replaced the campaign per-person form with a CSV preview and sequential call queue. Step 3 now maps Agent input variables to columns, permits column reuse for multiple variables and explicitly marks output variables. No input/output role is guessed from a placeholder name.
- CSV validation checks every row, including empty input cells, phone format, missing/removed columns, obsolete variable bindings and input size. Output fields are omitted from outbound inputs; their extraction/storage after a call still depends on provider support and is not added by this change.
- The backend independently loads the owner's campaign via RLS, checks the campaign version/Agent and derives each destination and input from saved CSV. Browser-provided field values cannot replace batch data.
- Calls are sequential, with at least 13 seconds between submissions, pausing on unknown results or status failures. Durable call-request history plus a deterministic per-campaign-version/row request UUID prevents automatic duplicate submission on resume or across tabs. If an edited campaign has attempts from an earlier version (including legacy manual attempts), the queue refuses to restart and asks the user to review history/create a new campaign instead of silently redialing recipients.
- The queue requires an open browser and awake device. Pause prevents further submissions; it does not hang up a submitted call. This is not a background worker or scheduler.
- Build passed. Automated checks: 78 passing (19 client, 32 backend, 12 database, 15 CSV/queue). Queue/provider responses are simulated only inside the tests; production UI has no generated records.
- Browser verified the existing Test(VC) campaign loads actual CSV name and phone in the new table. Its current file lacks columns for the remaining inputs and has no output classifications, so Start stays disabled. No campaign data was modified and no real calls were made.
- Live provider substitution of metadata.variables and live multi-recipient dialing remain unverified. Vercel has not been redeployed.

---

# Campaign call entry — 11 October 2026

- Added a call action on saved campaigns. It opens the selected campaign by ID without converting it to an editing draft or overwriting another draft.
- The call form uses that campaign's Agent, first contact, mapped destination and variables. Selecting another contact updates the destination and clears consent. Unknown campaign IDs show an error instead of falling back to another draft.
- Browser confirmed the existing Test(VC) campaign opened with its actual contact and mapped phone. The phone_number prompt input also receives the mapped destination when no explicit value exists.
- Read-only connection check succeeded. The provider returned the existing trunk_unprobeable warning. The call button remained disabled with consent unchecked and four missing prompt fields (applicant_id, internship_date, call_result, needs_agent).
- Existing limitation: every extracted placeholder is currently treated as required; input/output variable classification is not implemented. No values were invented to satisfy validation.
- Build passed. No outbound call was placed. This is manual one-contact calling, not a background campaign dialer or scheduler.

---
# Four-step campaign wizard — 11 October 2026

- Flow: campaign setup → choose Agent → map CSV fields → review and save draft.
- Mapping options come from the selected Agent's current greeting and prompt. Changing Agent removes incompatible mappings; revisiting the same Agent preserves deliberately skipped columns.
- Summary includes campaign settings, selected Agent, CSV sample/mapping, edit links and explicit confirmation. Saving does not start outbound calls.
- `npm test`: 58 passing checks (19 client, 27 backend, 12 database), including mapping preservation and Agent changes.
- `npm run build`: passed after the final wizard changes (existing bundle-size warning).
- `git diff --check`: passed.
- The browser account has no campaign draft. Populated end-to-end wizard saving was not exercised in the live database; no sample campaigns or real calls were created for this UI check.

---
# Member access update — 11 October 2026

The owner requested automatic Voice Bot access for registered users. Default access mode is now `members`: a server-verified Supabase session and confirmed email are required, without manual email allowlisting. Explicit `allowlist` mode remains available. Unknown modes fail closed.

- `npm test`: 55 passing checks (16 client, 27 backend, 12 database), including confirmed members without allowlist entries, unconfirmed email rejection, invalid sessions and invalid access modes.
- `npm run build`: passed (existing bundle-size warning).
- `npm run test:readiness`: passed with local accessMode `members`.
- Agent/tenant membership checks, request reservation/rate limit and owner RLS remain in place.
- Members share the central Voice Bot account and its upstream reports, logs and usage quota. Supabase campaign/contact/request data remains scoped to its owner.
- Local implementation is enabled. Vercel has not been redeployed. No real calls were made during these checks.

---

# Live setup verification — 11 October 2026

Installed `supabase/migrations/202610090001_voice_workspace.sql` in the Supabase project configured by the app after the owner confirmed the access changes. SQL Editor returned `Success. No rows returned`.

- `voice_campaigns` and `voice_call_requests` exist; both have RLS enabled and two owner policies each (verified through SQL catalog queries).
- One Auth account exists for the configured allowed email. No user credentials were created or changed.
- Local allowlist has one email; Voice Bot secret remains server-only.
- `npm run test:readiness` passed against live services: Auth 200, Voice Bot account 200, both tables reject anonymous access with 401 / 42501, local backend rejects anonymous and forged sessions with 401, and built JavaScript excludes the Voice Bot secret.
- Corrected readiness checks to expect explicit anonymous permission denial for these private tables. This check does not prove authenticated CRUD or all RLS behavior.
- No sample records were added to production and no outbound calls were made in this setup step.
- User signed into Voice Confirm with the replacement approved email. Local allowlist was changed to that account and Vite restarted. Browser verified the signed-in account, successful Voice Bot account retrieval through the authenticated backend, empty own call-request history, and empty cloud campaign list. Readiness passed again. Authenticated create/update/delete, outbound calls through the new backend, provider variable substitution, and Vercel deployment remain unverified.

The results below are the earlier offline test report and historical pre-installation readiness status.

---

# ผลทดสอบ 9 ตุลาคม 2026

## สรุป

`npm test`: ผ่าน 50 ข้อ — 16 local/client, 22 backend, 12 database

- local/client: CSV, Mapping, ตัวแปรรายคน, เวอร์ชันข้อมูล cloud, การเปลี่ยนบัญชี, session และ payload โทร
- backend: ตรวจ session/allowlist, ไม่เปิด proxy ไป URL อื่น, จำกัด tenant/agent, ตัดข้อมูลลับออกจากผลลัพธ์, consent, จอง request ID, จำกัดคำขอ, timeout และไม่ส่งโทรซ้ำ
- database: รัน migration จริงใน PostgreSQL ชั่วคราวผ่าน PGlite ทดสอบ RLS ด้วย role authenticated/anon และ user IDs สองบัญชี ทดสอบ update version conflict, การลบ/อ่านข้ามบัญชี และเพดานคำขอ

ชุดทดสอบ client/backend ใช้ข้อมูลเฉพาะใน process ทดสอบ ไม่มีคำขอออกเครือข่ายและไม่มีข้อมูลตัวอย่างถูกเพิ่มในเว็บ/ฐานข้อมูลจริง PostgreSQL ชั่วคราวรองรับการทดสอบ SQL/RLS แต่ไม่แทนการทดสอบ Supabase Auth/PostgREST/เครือข่ายจริงครบวงจร

## การเชื่อมต่อจริงแบบอ่านอย่างเดียว

`npm run test:readiness`:

| รายการ | ผล |
|---|---|
| Supabase Auth settings | HTTP 200 |
| Voice Bot GET /me | HTTP 200, ได้ข้อมูลบัญชี |
| API local ไม่มี session | HTTP 401 ตามที่ควรเป็น |
| API local ใช้ session ปลอม | HTTP 401 ตามที่ควรเป็น |
| Token Voice Bot ใน JavaScript build | ไม่พบค่า secret |
| allowlist ผู้มีสิทธิ์ | ยังว่าง |
| ตาราง voice_campaigns | API ตอบ 404 / PGRST205 |
| ตาราง voice_call_requests | API ตอบ 404 / PGRST205 |

ผล readiness จึงเป็น **BLOCKED**: ยังไม่พร้อมทดสอบขั้นตอนที่ต้อง login และใช้งานตารางจริง ต้องติดตั้ง migration และกำหนดผู้มีสิทธิ์ก่อน ไม่มีการสร้างผู้ใช้ ไม่มีการเพิ่มข้อมูลใน Supabase และไม่มีการโทรจริงในรอบนี้

## ปัญหาที่แก้ระหว่างทดสอบ

1. ชุดทดสอบเก่าผูกกับ localStorage ปรับให้ตรงกับ cloud client/backend ใหม่
2. JSON null/JSON ผิดรูปแบบบางแบบคืน 503 แทน 400 แก้ให้ตอบ client error และหยุดก่อนโทร
3. เพิ่มตรวจชนิดเบอร์และรูปแบบ UUID
4. เพิ่มเงื่อนไขเจ้าของและเวอร์ชันซ้ำใน SQL ON CONFLICT เพื่อไม่ให้เกิดการแก้ข้อมูลข้ามบัญชีหากสร้าง UUID เดียวกันพร้อมกัน

## ยังไม่ยืนยัน

- login ด้วยบัญชีจริงที่ได้รับสิทธิ์ และ CRUD ผ่าน Supabase ที่ deploy แล้ว
- การโทรผ่าน backend ใหม่นี้และการแทน Prompt ด้วย metadata.variables ฝั่ง Voice Bot
- Vercel deployment

ดู [BACKEND_SETUP.md](BACKEND_SETUP.md) สำหรับขั้นตอนติดตั้ง
