# Implementation phases — ntex + async end-to-end

สถานะล่าสุด (2026-10-21): P0–P5 ส่งมอบ frontend แล้ว; P6–P7a มี Rust backend และ integration acceptance อยู่ใน checkout. ดู [execution status](PHASE_6_9_EXECUTION.md) สำหรับหลักฐานล่าสุดและสถานะ deployment; ห้ามใช้ delivery report P0–P5 เป็นสถานะปัจจุบันของ backend.
ข้อกำหนด: React/Vite/Tailwind/Zustand frontend ก่อน; Rust **ntex** + SeaORM/PostgreSQL
ใช้ phase IDs เดิมของ REFACTOR_IMPLEMENTATION_PLAN.md เพื่อไม่ทำให้ references ขัดกัน
ผลการโทรยึด CALL_OUTCOME_MODEL.md: confirm / decline / unknown พร้อม reason

## Async contract

เลือก ntex **Tokio runtime backend** และ SeaORM PostgreSQL driver/runtime ที่เข้ากัน
ตรวจ compatibility และ pin crate versions, features, Rust toolchain และ Cargo.lock ใน P0/P6
ไม่ผสม runtime โดยอาศัย defaults และไม่สร้าง nested runtime ต่อ request

- HTTP handlers/middleware ที่ทำ I/O → use cases → repository → SeaORM เป็น async/await
- Provider HTTP, email delivery, file streaming และ worker polling/timers ใช้ async APIs
- Frontend services ใช้ Promise/async พร้อม cancellation; Zustand ไม่เก็บ secret/server data ซ้ำ
- ไม่ใช้ blocking HTTP client, std::thread::sleep, sync file I/O หรือ block_on ใน async request/task
- Argon2 password hashing และ CSV/XLSX parsing ที่หนักใช้ bounded blocking pool แล้ว await
  ตั้ง semaphore/concurrency cap ก่อน submit, จำกัด input/expanded file size และ memory
- pure validation, DTO mapping และ domain calculation สั้นๆ ยังเป็น sync function ได้;
  เป้าหมายคือไม่มี blocking งานหนักบน executor ไม่ใช่ใส่ async ให้ทุกฟังก์ชัน
- Timeout ของ await ไม่รับประกันว่า blocking task หยุดแล้ว: จำกัดงานที่รับเข้าและ track
  จนจบ; ใช้ cooperative cancellation เมื่อทำได้ ไม่ปล่อย tasks เพิ่มไม่จำกัด
- กำหนด pool size, acquire timeout, query timeout, provider deadline และ bounded task/channel
  จาก resource budget; pool ทั้ง API และ worker รวมกันต้องไม่เกิน DB capacity
- ไม่มี DB transaction/lock ค้างขณะ await provider HTTP, sleep หรือ parse file
  await DB queries ภายใน short transaction ได้; มี rollback และ cancellation handling
- Persist queue/attempt ก่อน dispatch; cancellation/HTTP timeout หลังส่งอาจเป็น ambiguous
  ต้อง reconcile และใช้ idempotency ห้ามถือว่าหยุด future แล้วสายไม่ได้เริ่ม
- Shutdown: stop accepting/claiming, drain bounded in-flight work, persist uncertain dispatch,
  ปิด pool ภายใน deadline; restart ใช้ durable state/lease ห้ามลืม counter หรือส่งสายซ้ำ
- Low usage เริ่ม worker 1 process พร้อม bounded dispatch; async ไม่ได้แปลว่าโทรพร้อมกันไม่จำกัด
  แยก dispatch concurrency, active-call capacity และ X:1 scheduling policy

## Phase roadmap และ acceptance gates

| Phase | Deliverable | Gate ก่อนเดินต่อ |
|---|---|---|
| **P0 — Contracts + runtime spike** | Freeze DTO/OpenAPI, module boundaries, outcome/retry rules; minimal ntex/Tokio + SeaORM real Postgres + fake HTTP compatibility spike | async DB + outbound HTTP ทำงานบน runtime ที่เลือก, pin dependencies; แยก spike จาก production; ระบุ defaults ที่ยังไม่ยืนยัน |
| **P1 — Frontend foundation** | Vite/Tailwind tokens, routing, reusable UI, Zustand UI slices, query cache, service/DTO boundaries; แยก legacy CSS | build/typecheck และ <=300 lines full-tree gate ผ่าน, base path/deep links ใช้งานได้ |
| **P2 — Auth + multi-org UI** | Login/reset/invite, org switcher, roles/permission states ด้วย dev/test mock | org switch cancel requests/clear tenant state, keyboard/validation ผ่าน; ไม่อ้างว่า auth จริงพร้อม |
| **P3 — Events + FAQ UI** | Event CRUD, categories, Q/A editor, draft/publish preview | Agent preview เห็น published snapshot เท่านั้น; reusable forms/services |
| **P3a — Import + calling UI** | Template download/upload/preview/commit, NEW/FAIL tabs, X:1 settings, attempt history และ 3 outcomes | Upload ไม่โทร, unknown แสดง reason/จำนวน no_answer, confirm+ticket ได้, decline ไม่ retry |
| **P4 — Kanban UI** | Ticket board/list/detail, assignment, comments, transitions, callback intent | Save failure rollback, version conflict handling, ticket ไม่เปลี่ยน attendance result |
| **P5 — Agent credentials UI** | Org/event credential pair, scope, rotate/revoke, API examples | Pair mismatch states, key-once UX, mock-only keys; contracts พร้อมต่อ real backend |
| **P6 — ntex backend core** | Runtime/config, async handlers/services/repositories, migrations, real auth/org/event/FAQ; เชื่อม UI ทีละ feature | Real Postgres isolation tests, Argon2 bounded offload, session/security tests, async responsiveness/shutdown gates ผ่าน |
| **P7 — Tickets + Agent API** | Real Kanban, paired credentials, published FAQ API, idempotent results/ticket ingestion | Cross-tenant/scopes/revocation tests; confirm + unanswered question บันทึก ticket ไม่สูญหายและไม่สร้างซ้ำ |
| **P7a — Imports + durable calling worker** | Async upload + bounded parser, explicit run start, PostgreSQL weighted claims, provider adapter/callbacks, retry/reconcile | 2:1/5:1, restart/concurrent claims, cooldown/attempt caps, unknown reason, late confirm/decline, timeout ambiguity tests ผ่าน |
| **P7b — Groovy acceptance + CI gate** | Complete Groovy/Spock API suite via pinned Gradle Wrapper; Jenkins JUnit before project cleanup | Real API/worker/DB + fake provider + test clock ผ่าน; suite failure/missing reports block deployment; normal CI ไม่โทรจริง |
| **P8 — Lightsail cutover** | Production images/limits/secrets/TLS, migration rehearsal, off-host backup/restore, rollback and monitoring | Mock disabled, P6–P7b gates pass, controlled authorized provider acceptance, restore ไม่ redial เก่า, resource/load evidence |
| **P9 — Legacy parity** | Recurring schedules/recordings และ flow เก่าที่ยังต้องใช้ | Parity acceptance หรือ explicit removal decision; ไม่ลบ legacy โดยสมมติว่าไม่มีคนใช้ |

P0 ทำเพียง technical spike เพื่อลด runtime risk; product implementation ยังคง frontend-first P1–P5
P6 ต่อ P2/P3 กับ real services; P7 ต่อ P4/P5; P7a ต่อ P3a ก่อน P8
เริ่ม Groovy test harness ตั้งแต่ P6 และเพิ่ม suite ทุก feature; P7b เป็น final completeness gate
ไม่เลื่อนการเขียน/รันทดสอบทั้งหมดไปท้ายโปรเจค
P9 อยู่หลัง P8 ได้เฉพาะ legacy journeys ที่ยังมีเส้นทางใช้งานเดิมแยกอยู่;
ถ้า cutover จะปิดระบบเดิมทั้งหมด ต้องทำ parity/explicit disposition ใน P9 ก่อน P8

## Async verification ที่ต้องแสดงหลักฐาน

1. เปิด slow fake provider response พร้อมเรียก health/read endpoints: API ยังตอบภายใน
   acceptance budget ที่กำหนดใน P0/P6 ไม่รอ outbound call จบ
2. ทำ concurrent password checks และ import parsing: bounded pool ไม่ทำให้ health/read
   timeout, ไม่มี queue งานใน memory โตไม่จำกัด; overload ถูก reject/backpressure ชัดเจน
3. Slow DB/pool exhaustion: acquire/query deadline ทำงาน ไม่มี leaked connection/transaction
4. Cancel client upload/request: rollback/cleanup temp file และ durable import state ถูกต้อง
5. Stop/restart worker หลัง provider accepted แต่ก่อน ack persisted: reconcile ก่อน retry,
   ไม่ duplicate call และ ratio counter ถูก finalize ครั้งเดียว
6. Graceful shutdown ระหว่าง in-flight operations: ไม่รับ job ใหม่, deadline bounded,
   leases/attempt state recover ได้; tests ตรวจ dispatch journal ไม่ใช่แค่ HTTP status
7. Review/CI checks ห้าม blocking APIs ใน async paths; static checks เป็นตัวเสริม
   ต้องมี behavior tests ข้างต้น เพราะ async fn อย่างเดียวไม่รับประกัน non-blocking

Groovy ทดสอบ API behavior; Rust integration tests ตรวจ transaction/runtime/concurrency;
frontend component/E2E tests ตรวจ UI journeys ทั้งหมดใช้ fake provider ใน CI
ทุก code file รวม Groovy/tests/migrations <=300 บรรทัดตาม AGENTS.md

## เอกสารอ้างอิงสำหรับ implementation

- [ntex runtime guide](https://docs.ntex.rs/4-runtime.html): runtime backend และ executor model
- [ntex API](https://docs.ntex.rs/api/ntex/index.html): ตรวจ feature/API ให้ตรง pinned release
- [SeaORM async runtime](https://www.sea-ql.org/SeaORM/docs/install-and-config/database-and-async-runtime/): PostgreSQL driver/runtime features

Dependency versions ยังไม่ freeze จากแผนนี้; ต้องผ่าน compatibility spike ก่อน commit manifest

## 2026-10-21 requirement update

See [Workspace operations update](WORKSPACE_OPERATIONS_UPDATE.md) and its
[JSON plan](WORKSPACE_OPERATIONS_UPDATE.json). This supersedes the earlier role names,
single assignee/three-stage board, template columns, dashboard and retry-policy UI.
The remaining backend phases must implement these contracts and Swagger route parity.

## P6–P9 execution update

See [execution status](PHASE_6_9_EXECUTION.md) and [JSON](PHASE_6_9_EXECUTION.json).
Queue settings now support X:Y and maxRetries excluding the initial call.
