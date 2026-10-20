# Event calling, participant templates และ org/event credentials

> **อัปเดตผลการโทร:** ใช้ [CALL_OUTCOME_MODEL.md](CALL_OUTCOME_MODEL.md) เป็นข้อกำหนดล่าสุด: `confirm` / `decline` / `unknown` พร้อมเหตุผล แทน `not_confirmed` ในเอกสารนี้; confirm อาจมี ticket และ decline ไม่โทรซ้ำ

อัปเดต requirement: 21 ตุลาคม 2026 · สถานะ: แผน ยังไม่ implementation
เอกสารนี้เป็นส่วนหนึ่งของ [แผน refactor หลัก](REFACTOR_IMPLEMENTATION_PLAN.md)
และปรับ scope ให้ import รายชื่อ + initial calling + retry เมื่อโทรไม่ติด/ไม่ยืนยันอยู่ใน MVP
Frontend ยังทำก่อน ด้วย DTO/services/mock contracts; backend จริงตามมาใน P7a
ข้อกำหนดคิวล่าสุด: [สอง lane แบบ X:1 และ Groovy tests](WEIGHTED_QUEUE_GROOVY_TEST_PLAN.md)
รายละเอียด queue/runtime: [QUEUE_LIGHTSAIL_DESIGN.md](QUEUE_LIGHTSAIL_DESIGN.md)

## 1. Journey: เตรียมรายชื่อของ Event

1. Staff เข้าสู่ระบบ → เลือก org → เลือก Event → Participants
2. กด Download template เลือก CSV UTF-8 หรือ XLSX
3. Template มี header มาตรฐานและแถวตัวอย่างแยกชัดเจน พร้อม event_code/event_date ของ Event
4. กรอกรายชื่อ → upload → server validate → ดู preview/row errors → ยืนยัน import
5. รายชื่อที่ commit แล้วแสดงใน Event; **upload/import ไม่เริ่มโทรอัตโนมัติ**
6. Staff เลือกรายชื่อ ตั้ง calling policy แล้วกดยืนยันเริ่มโทรแยกต่างหาก

### Template schema v1

| Column | คำอธิบาย | Validation |
|---|---|---|
| `phone` | เบอร์โทร | required string; รักษา 0 นำหน้า, normalize country code/E.164 |
| `first_name` | ชื่อ | required, trim whitespace, length limit |
| `last_name` | สกุล | required ตาม proposal v1; ถ้าไม่มีนามสกุลต้องตัดสินใจ policy ก่อน implementation |
| `nickname` | ชื่อเล่น | column ต้องมี แต่ค่าปล่อยว่างได้ |
| `event_code` | รหัส Event | required; ตรงกับ Event ที่เลือก ภายใน org ของผู้ใช้ |
| `event_date` | วันที่จัด Event | required `YYYY-MM-DD`; ตรงกับ local start date ใน timezone ของ Event |

ตัวอย่าง **ข้อมูลสมมติเท่านั้น ไม่ใช่รายชื่อสำหรับโทรจริง**:

```csv
phone,first_name,last_name,nickname,event_code,event_date
"0812345678","สมชาย","ตัวอย่าง","ชาย","EVT-DEMO-001","2026-12-01"
```

- `event_code` เป็น business identifier ไม่ใช่ credential; unique ต่อ org
- หนึ่งไฟล์ต่อหนึ่ง Event ใน MVP; mixed-event file หรือผิดวันที่ต้อง reject ไม่เปลี่ยน event ตามไฟล์
- Event ที่หลายวันใช้วันเริ่มใน timezone ของ Event; วัน/เวลาจริงอ่านจาก Event canonical record
- `event_date` ในไฟล์เป็น validation snapshot ไม่สร้าง/แก้วันจัดงานจาก import
- XLSX ใช้ phone column เป็น text; CSV ให้คำแนะนำ import เป็น Text ใน spreadsheet
  หากศูนย์นำหน้าหายหรือหมายเลขกำกวมให้แจ้ง error ไม่เดาเติมเบอร์เอง
- วันเวลาใช้ ISO date ไม่รับค่ากำกวม `01/02/26`; XLSX native date แปลงโดย parser อย่างชัดเจน
- Schema version อยู่ใน template metadata (XLSX sheet / CSV filename + download metadata)
  และ upload request ส่ง `schema_version=1`; ไม่ใส่ credentials ในไฟล์
- ชื่อไฟล์ตัวอย่าง: `event-participants-v1-EVT-DEMO-001.csv`
- ตัวอย่างในไฟล์ต้องถูกแยกจาก data rows หรือถูกลบก่อน import; ไม่แถมเบอร์ตัวอย่างเป็นผู้รับจริง

### Import contract และ consistency

- Staff session + membership ตรวจสิทธิ์ `participants:write`; import batch ผูก org/event/user
- API รับ upload แบบ bounded multipart; ตรวจ actual format, encoding, columns, row/field limits
  proposal เริ่ม 5 MiB / 5,000 rows; สำหรับ XLSX จำกัด expanded bytes/cells/sheets เพื่อไม่ให้ zip bomb
- ไม่ execute formula/macros/external links; ปฏิเสธ spreadsheet formula cells และ neutralize
  spreadsheet-formula prefixes ใน text เมื่อ export error report/CSV
- Preview แสดง accepted/rejected rows, duplicate phone, filename และ event context ชัดเจน
- MVP commit ทั้ง batch แบบ atomic เมื่อทุกแถวถูกต้อง; ไม่ import บางแถวแบบเงียบๆ
- Proposal identity: unique `(org_id,event_id,phone_normalized)`; ชื่อขัดกันให้แก้ก่อน import
  ไม่ใช้ policy นี้กับการ dedup tickets; shared-phone attendees ต้องยืนยันก่อนล็อก schema
- Upload ซ้ำตรวจ hash เพื่อแจ้งเตือน; ไม่ใช้ file hash เป็น authorization หรือ silently overwrite
- `commit` ใช้ Idempotency-Key + batch state lock; request ซ้ำคืนผลเดิม ไม่เพิ่มรายชื่อรอบใหม่
- Commit revalidate Event version/date, row constraints และ participant uniqueness ใน transaction
- Preview token/batch ID ไม่ใช่สิทธิ์; ทุก get/commit/error-download ตรวจ org/event/owner permission
- Preview มี expiry; event date เปลี่ยนหลัง upload ตอบ conflict และให้ download/validate ใหม่
- ไฟล์ชั่วคราวมี retention proposal 24 ชั่วโมง; error reports จำกัดสิทธิ์เหมือนข้อมูลรายชื่อ
- สิทธิ์แก้ participant ที่ถูกใช้ใน run ไม่เปลี่ยน attempt history: run เก็บ snapshot รายชื่อ/วันงาน

DTO ที่เพิ่ม: `ParticipantTemplateMetadataDto`, `UploadImportResponseDto`,
`ImportRowErrorDto`, `ImportPreviewDto`, `CommitImportRequestDto`, `ParticipantDto`

## 2. Journey: คิว new/fail และ retry เมื่อโทรไม่ติดหรือไม่ยืนยัน

1. Staff เปิด Event → Calls → เลือก participants ที่ต้องการโทร
2. ตรวจชื่อ/เบอร์, Event/date, provider agent และ retry policy พร้อมสรุปจำนวนสายสูงสุด
3. ยืนยันเริ่ม run; backend บันทึก recipient snapshot และ durable dispatch reservation
4. Worker เรียก provider และติดตามผลผ่าน callback/status API
5. ถ้า provider ยืนยัน terminal โทรไม่ติด หรือได้ final `not_confirmed` หลังจบสาย ให้เข้า fail lane
   ตั้ง `retry_wait` ตาม policy; missing/ambiguous result ต้อง reconcile ก่อน
6. เมื่อครบเวลารอ Worker ตรวจเงื่อนไขใหม่ แล้วเลือก new X ครั้ง : fail 1 ครั้งตาม Event ratio
7. confirmed จึงหยุด retry; answered แต่ final not_confirmed ยัง retry ได้
   ครบ limit แสดง `exhausted`; explicit decline/opt-out หยุดตาม policy พร้อมประวัติทุก attempt
8. Staff pause/cancel run ได้; ดู next retry และเหตุผลที่หยุดได้จาก UI

### Retry policy proposal — ต้องยืนยันก่อนเปิดโทรจริง

| Field | Proposal |
|---|---|
| `enabled` | default false; เปิดเมื่อ staff ตั้งค่า/ยืนยัน run |
| `max_attempts` | 3 ครั้งรวมสายแรก = retry เพิ่มได้สูงสุด 2 ครั้ง |
| `retry_delay_minutes` | 15 นาทีหลัง terminal/result ที่เข้าเงื่อนไข fail |
| `new_to_fail_ratio` | EventQueuePolicy แยก; X:1 เช่น 2:1/5:1; default proposal 2:1 |
| `retry_on` | no_answer / retryable busy-unreachable / final not_confirmed; explicit mapping |
| `allowed_hours` | staff กำหนดช่วงโทรใน timezone ของ Event; บังคับมีก่อน start |
| `cutoff_at` | staff กำหนด; default proposal ไม่เกินเวลาเริ่ม Event |
| `concurrency` | มีเพดานต่อ provider/org/event และ active call ต่อ recipient |

ถ้าเวลาถัดไปอยู่นอก allowed hours ให้เลื่อนไปช่วงที่อนุญาตถัดไป
หากเลย cutoff แล้วให้หยุดเป็น `expired` ไม่รอวนซ้ำไม่สิ้นสุด
Policy snapshot ผูก run; การแก้ policy ของ Event ไม่มีผลย้อนหลังกับ run ที่เริ่มแล้ว
Ratio เป็น Event-level policy แยกจาก run retry snapshot: เปลี่ยนเมื่อ pause และไม่มี pending turn
พร้อม versioned counter reset/audit ตาม weighted queue spec
การเปลี่ยน run policy ต้องเป็น explicit action ที่มี version check/audit และไม่เพิ่ม limit เงียบๆ

### State model

- Run: `draft → queued → running → completed`; มี `paused`, `cancelled`, `failed`
- Recipient: `queued → dispatching → in_progress`; terminal no-connection ไป
  `retry_wait | exhausted` ส่วน answered ไป `awaiting_result → confirmed | retry_wait | stopped`
  และมี `unknown`, `failed`, `cancelled`, `suppressed`, `expired`
- Attempt: `reserved → submitted → ringing → answered | no_answer | busy | rejected | failed | unknown`
  `answered` ใน model นี้เป็นผลเมื่อ provider ยืนยันว่าสายจบและเคยรับสาย ไม่สร้างสายใหม่ขณะสายยังอยู่
- `busy/temporarily_unreachable` เข้า fail เมื่อ adapter ยืนยัน retryable terminal outcome
- `invalid_number`, explicit decline/opt-out ไม่ retry; `failed` ที่กำกวมต้อง reconcile
- final `not_confirmed` เข้า fail แม้ answered; ไม่ใช้การขาด result เป็น not_confirmed
- HTTP timeout, webhook ไม่มา หรือไม่ทราบ Call ID = `unknown` ไม่ใช่ `no_answer`
  ต้อง reconcile จาก provider ก่อน ห้าม dispatch attempt ใหม่เพื่อแก้ความไม่แน่นอน
- Answered ไม่ได้หมายถึงลูกค้ายืนยันเข้าร่วมงาน: transport_outcome กับ confirmation_status
  แยก fields; confirmed จบ journey, not_confirmed เข้า fail ตาม policy

### Durable execution และการป้องกันโทรซ้ำ

- Queue/leases/next_attempt_at อยู่ใน PostgreSQL ไม่พึ่ง browser tab หรือ in-memory timer
- Unique `(run_id,recipient_id,attempt_no)` และ active reservation ต่อ Event/participant
- Dispatch jobs มี lane=new/fail; จอง EventQueueState + pending turn แบบ atomic และนับ ratio
  ครั้งเดียวเมื่อ provider accepted; technical retry ไม่เพิ่ม call attempt/ratio counter
  ป้องกัน concurrent start/retry รวมถึงสอง run ที่เลือกคนเดียวกัน
- Worker claim ด้วย transaction/lease; persist dispatch intent ก่อนส่ง provider
- API transport retry ใช้ attempt/dispatch identity เดิม ไม่เพิ่ม attempt number
- Crash หลัง provider รับคำขอแต่ก่อนบันทึก Call ID ต้อง reconcile ด้วย provider idempotency/
  client reference; ถ้า provider ไม่มีความสามารถนี้ให้ค้าง unknown เพื่อ review ไม่ resend เดาๆ
- Application reservation ไม่รับประกัน exactly-once ที่ provider; ทดสอบ failure window นี้โดยเฉพาะ
- Callback ตรวจ signature/provider secret แยกจาก client credentials และ resolve org/event
  จาก stored provider connection/call mapping ไม่เชื่อ org/event ที่ callback body อ้างเอง
- Callback dedup ด้วย provider event ID หรือ stable payload identity; delayed/out-of-order event
  ห้ามเปลี่ยน answered กลับเป็น no_answer; event ขัดกันให้ reconcile ก่อน retry
- ก่อน retry ตรวจ run ยัง active, ไม่มีสาย active, attempts remaining, window/cutoff,
  participant ไม่ opt-out, Event ไม่ archived, provider connection พร้อม และ policy version
- Run ที่สร้างผ่าน external credential pair เก็บ principal reference; revoke/expiry ของ key
  ใด key หนึ่งระงับ pending dispatch/retry ของ run นั้นจน staff review
- Pause/cancel/archive/opt-out ป้องกันการจองใหม่แบบ transaction; สายที่ provider รับไปแล้ว
  อาจยังจบได้ ต้องแสดง in-flight แยกจาก cancelled pending ไม่สัญญาว่ายกเลิกสายที่เริ่มแล้วทันที
- Worker restart คืนงานที่ lease หมดอย่างปลอดภัย; lease หมดไม่ใช่หลักฐานว่าสายไม่ถูกส่ง

### ความสัมพันธ์กับ Kanban

- ไม่สร้าง unanswered-question ticket เพียงเพราะลูกค้าไม่รับสาย: เป็นคนละเหตุการณ์
- `exhausted` อยู่ใน Calls และ staff เลือกสร้าง follow-up ticket ได้แบบ explicit
- เมื่อลูกค้ารับสายแล้วถามสิ่งที่ Agent ตอบไม่ได้ หรือขอติดต่อกลับ Agent สร้าง ticket
  ผูก `participant_id`/`call_attempt_id` ได้โดยตรวจ org/event ownership ทั้งหมด
- Callback ticket ไม่เริ่มโทรกลับเอง; staff ต้องยืนยันเป็นงานโทรแยกพร้อม schedule/policy
- การ redial หลัง exhausted เป็น new run พร้อม confirmation เหตุผลและ audit ไม่ reset counter เดิม

DTO ที่เพิ่ม: `EventCallPolicyDto`, `StartCallRunRequestDto`, `CallRunDto`,
`CallRecipientDto`, `CallAttemptDto`, `CallRunControlRequestDto`

## 3. Journey: ตั้งค่า org credential + event credential

1. Owner/Admin สร้าง OrgApiCredential ใน org settings → copy secret ที่แสดงครั้งเดียว
2. เปิด Event settings → สร้าง EventApiCredential ที่อ้าง org credential นั้น
3. กำหนด scopes/expiry โดย event scopes ต้องไม่เกินสิทธิ์ parent
4. ติดตั้งทั้งสอง key ใน server-side Agent/integration secret store
5. ทุก external event API ส่งทั้งสอง credential; event ID/code อย่างเดียวไม่ถือเป็นสิทธิ์
6. Admin ดู last-used/expiry, rotate และ revoke ได้ พร้อม audit trail

```http
GET /event-confirm/api/agent/v1/events/{event_id}/faqs
Authorization: Bearer <org_credential>
X-Event-Credential: <event_credential>
```

ห้ามส่ง key ใน query string, URL, template, log หรือ localStorage
API docs/playground ใช้ placeholder; UI หลังสร้างแสดงเพียง prefix และ metadata
Browser business APIs ใช้ staff session/RBAC ไม่แจก machine secrets ให้ทุก browser request
Org/event keys นี้เป็น **credential ของระบบเรา** ไม่ใช่ Voice Bot provider token
provider token จัดเก็บแบบ encrypted server-side ใน VoiceProviderConnection แยกต่างหาก

### Credential verification contract

- Middleware hash/verify secret ทั้งคู่ ตรวจ active/expiry/revoked และจับ parent identity
- ต้องผ่าน `event_key.org_id == org_key.org_id`, `event_key.org_credential_id == org_key.id`
  และ `event_key.event_id == requested_event_id`; ไม่ใช้ชื่อ org/event จาก caller เพื่อเลือก tenant
- Effective scope เป็น intersection ของสอง keys; ผ่านแล้วจึงสร้าง trusted EventContext
- ขาด/หมดอายุ/ถูก revoke key ใด key หนึ่งตอบ generic 401; authenticated pair แต่ scope
  ไม่พอใช้ 403; event lookup ข้ามขอบเขตใช้ tenant-safe 404 โดยไม่เผยรายละเอียด record
- No Agent endpoint สำหรับ list ทุก Event ด้วย org key อย่างเดียว; event endpoint scoped
  ส่วนการ list/select Event สำหรับ setup ใช้ staff session
- Default scopes: `events:read`, `knowledge:read`, `tickets:create`
  `calls:create`/`calls:read`/`calls:result` ต้อง opt-in โดย Admin ไม่รวมอัตโนมัติเมื่อให้สิทธิ์อ่าน FAQ
- Credential rotation ต้องรักษา parent identity หรือ reissue child keys อย่าง explicit;
  ถ้ามี overlap window ต้องระบุ expiry และ audit ไม่ให้ old secret ใช้ได้ไม่สิ้นสุด
- Revoke org credential ทำให้ child event credentials ทุกตัวใช้ไม่ได้ทันที;
  revoke event credential กระทบเฉพาะ key/event binding นั้น
- Stored API secrets เป็น hash; provider connection secret เป็น encryption เพราะต้องส่ง upstream
- Idempotency scope รวม org + event + credential pair + operation; ไม่ replay ข้าม tenant/event

Provider callbacks ไม่ต้องส่งคู่นี้: ใช้ provider signature/secret protocol ของ adapter
และตรวจ stored ownership mapping ต่างหาก เพื่อไม่แจก org/event client credentials ให้ provider

## 4. APIs / frontend / backend deliverables

- Browser: download template, upload/preview/error-report/commit, list participants,
  read/update call policy, start/list/detail run, attempt history, pause/resume/cancel
- Machine: existing published Event/FAQ/ticket APIs + opt-in create/read call runs
  โดยทุก event endpoint ใช้ credential pair เดียวกัน
- Agent start-run body ใช้ saved participant IDs + expected event/policy version;
  ไม่รับ arbitrary phone list เพื่อ bypass import validation; require Idempotency-Key
- Start call run เป็น explicit action และคืน 202 + run ID; duplicate request คืน run เดิม
- Machine import/download ไม่อยู่ใน MVP; หากเพิ่มภายหลังต้องใช้ pair และ dedicated scopes
- Frontend modules: `participants`, `calling`, `agent-access` แยก DTO/hooks/services/components
- Backend modules: `imports`, `participants`, `calling`, `provider_adapter`, `agent_access`
  แยก transport/service/repository; code แต่ละไฟล์ยังไม่เกิน 300 บรรทัด
- Worker process ใช้ shared Rust modules กับ API, bounded concurrency, DB polling/lease,
  graceful shutdown และ reconciliation; ไม่เพิ่ม broker ใหม่ใน MVP โดยไม่จำเป็น
- Observability: import rejection count, attempt outcome, pending retry, unknown/reconcile,
  exhausted และ worker heartbeat; log มี IDs/request IDs ไม่เก็บเบอร์เต็มหรือ credentials

## 5. Acceptance checklist

- Download template มีครบทั้ง 6 fields และ Event/date ถูกต้อง; phone ไม่ถูกแปลงเป็นตัวเลข
- Invalid row, foreign Event, stale date/version, duplicate number/name conflict ต้องแก้ก่อน commit
- Upload และ retry commit ไม่โทรและไม่สร้าง participant ซ้ำ; cross-org import read/commit ถูกปฏิเสธ
- Staff เห็น retry count/เวลาครั้งถัดไป/เหตุผลที่หยุด และประวัติ attempts ทุกครั้ง
- Known retryable no-connection หรือ final not_confirmed สร้าง fail attempt เมื่อถึงเวลา/ผ่าน ratio
  confirmed หยุด retry; answered อย่างเดียวไม่ถือว่ายืนยัน
- ทั้งสอง lane พร้อมต้องได้ N N F สำหรับ 2:1 และ N N N N N F สำหรับ 5:1
- Groovy API tests ตรวจ restart/fallback/cooldown/late result และ persisted counters ตาม test plan
- Unknown, HTTP timeout, duplicate callbacks, worker crash ไม่สร้างสายซ้ำแบบเดาๆ
- Max attempts รวมสายแรก; allowed hours/cutoff/cancel/archive/opt-out ถูกบังคับใช้ฝั่ง server
- Key เดี่ยว, pair ผิด parent/org/event, expired/revoked หรือ scope ไม่พอเรียก API ไม่ได้
- Rotation/revoke ของ key สะท้อนใน queued external runs ตาม policy; browser login ยังแยกจาก keys
- Preview/mock tests ไม่โทรจริง; production calling gate ต้องมี approved test numbers,
  provider/result mapping และ controlled no-connection/not-confirmed retry test ก่อน enable outbound dispatch

## 6. Decisions ก่อน implementation

| เรื่อง | ข้อเสนอเริ่มต้น | จุดยืนยัน |
|---|---|---|
| จำนวนครั้ง/เวลารอ | 3 attempts รวมสายแรก, ห่าง 15 นาที | ก่อน UI policy default / เปิดโทรจริง |
| เวลาที่โทรได้ | staff กำหนดตาม event timezone; cutoff ก่อนเริ่มงาน | ก่อน start-run contract freeze |
| Template formats | CSV UTF-8 + XLSX, fixed schema v1 | ก่อน P3a parser/UI |
| Shared phone | unique phone ต่อ Event; ไม่รวมชื่อที่ขัดกันอัตโนมัติ | ก่อน Participant schema |
| ชื่อ/สกุล | required; nickname optional | ก่อน template freeze |
| Caller/provider mapping | use provider adapter เดิม; verify terminal no-connection และ final confirmation semantics | ก่อน P7a integration |
| Scope ของ dual credentials | external event APIs; browser session และ provider callbacks แยก | ก่อน middleware/OpenAPI |

## 2026-10-21 requirement update

See [Workspace operations update](WORKSPACE_OPERATIONS_UPDATE.md) and its
[JSON plan](WORKSPACE_OPERATIONS_UPDATE.json). This supersedes the earlier role names,
single assignee/three-stage board, template columns, dashboard and retry-policy UI.
The remaining backend phases must implement these contracts and Swagger route parity.
