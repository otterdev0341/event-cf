# Event Confirm — Frontend-first refactor และ implementation plan

> **อัปเดตผลการโทร:** ใช้ [CALL_OUTCOME_MODEL.md](CALL_OUTCOME_MODEL.md) เป็นข้อกำหนดล่าสุด: `confirm` / `decline` / `unknown` พร้อมเหตุผล แทน `not_confirmed` ในเอกสารนี้; confirm อาจมี ticket และ decline ไม่โทรซ้ำ

วันที่: 21 ตุลาคม 2026 · สถานะ: แผนสำหรับ implementation รอบถัดไป
เจ้าของ repository เป้าหมาย: `otterdev0341` · Base path: `/event-confirm/`

รอบนี้จัดทำแผนและกฎ repository เท่านั้น ยังไม่เปลี่ยน frontend/backend, database,
credentials หรือ repository visibility เป้าหมายคือระบบจัดการ Event Knowledge
และติดตามเรื่องที่ Agent ตอบไม่ได้/ลูกค้าขอติดต่อกลับ ภายใต้หลายองค์กร
รวมถึงนำเข้ารายชื่อผู้เข้าร่วม โทรยืนยัน Event และ retry เมื่อไม่รับสาย
รายละเอียดเพิ่มเติม: [Calling, templates และ credentials](CALLING_IMPORT_CREDENTIAL_PLAN.md)
ข้อกำหนดคิวล่าสุด: [New/Fail queue แบบ X:1 และ Groovy API tests](WEIGHTED_QUEUE_GROOVY_TEST_PLAN.md)
Queue/deployment decision: [PostgreSQL queue + worker และ Lightsail readiness](QUEUE_LIGHTSAIL_DESIGN.md)

## 1. สิ่งที่ตกลงจาก requirement และสมมติฐาน

**Requirement ที่ยืนยันแล้ว**

- Frontend: React + TypeScript + Vite + Tailwind CSS + Zustand
  (`zusland` ใน requirement ตีความเป็น Zustand)
- Reusable components, แยก DTO / hooks / services / state และ feature modules
- Backend: Rust + SeaORM, DTO แยกจาก database entity และ separation of concerns
- ทุกไฟล์ source code ไม่เกิน **300 physical lines** รวม comment และบรรทัดว่าง
- Event, FAQ แบบ question/answer, category และ external Agent API สำหรับอ่านข้อมูล
- Kanban สำหรับ unanswered question และ callback request; Agent สร้างงานได้ผ่าน API
- Email/password authentication และ multi-organization
- Download/upload template รายชื่อ: เบอร์โทร, ชื่อ, สกุล, ชื่อเล่น, รหัส Event, วันที่จัด Event
- สองคิวโทร: new จากรายชื่อ upload และ fail จากโทรไม่ติด/ไม่ยืนยัน
- ตั้งสัดส่วน X:1 เช่น 2:1 หรือ 5:1; new X attempts ก่อน fail 1 attempt
- API acceptance tests เขียน Groovy + Spock เรียก HTTP API และรันผ่าน Jenkins Groovy pipeline
- External event API ต้องมีทั้ง org credential และ event credential ที่สัมพันธ์กัน
- Design อิง Exa reference ที่ให้มา; ทำ frontend ก่อน backend integration
- Repository ต้องสามารถเป็น standalone private repo ภายใต้บัญชีผู้ใช้

**สมมติฐานสำหรับเริ่มออกแบบ ไม่ใช่การตัดสินใจที่ซ่อนอยู่**

- หนึ่ง user อยู่ได้หลาย org; มี role แยกตาม org และเลือก active org ใน UI
- Event เป็นของ org เดียว; category เป็นของ event; FAQ หนึ่งข้ออยู่ category เดียว
- มี Kanban ระดับ org พร้อม filter event; ticket ต้องผูก event เสมอ
- Knowledge มี draft/published/archived; Agent เห็นเฉพาะ published
- Agent API ใช้ org credential + event credential; browser ยังคงใช้ user session/RBAC
- ใช้ PostgreSQL และ Rust/ntex modular monolith; ยังไม่แยก microservices
- Auth เป้าหมายอยู่ใน Rust; Supabase เดิมเป็น legacy adapter ระหว่าง migration
- UI รองรับไทยเป็นหลักและข้อความอังกฤษ; วันเวลาแสดงตาม event timezone
- Calling/import/failed-or-unconfirmed retry อยู่ใน MVP ใหม่; reuse/migrate logic เดิมผ่าน provider adapter
- Legacy recordings และ recurring campaign schedules อยู่ใน phase แยก ไม่ลบทิ้งโดยอัตโนมัติ
- P1–P5 เป็น frontend preview; จะถือว่า production-ready หลังผ่าน P6–P8 เท่านั้น

## 2. Baseline และขอบเขตการเปลี่ยน

ดู [architecture ปัจจุบัน](../ARCHITECTURE.md) และ [deployment](../HOST_DEPLOYMENT.md)
แอปเดิมใช้ Vite อยู่แล้ว แต่ยังไม่มี Tailwind/Zustand และมี Supabase access จาก browser
ส่วน public deployment ปัจจุบันเป็น nginx readiness service ไม่ใช่แอปเดิมที่ใช้งานจริง

ไฟล์ที่เกิน 300 บรรทัดจาก inventory ก่อน refactor:

| ไฟล์ | บรรทัด | แนวทาง |
|---|---:|---|
| `src/styles.css` | 5951 | แยก tokens/base และย้าย styling เป็น Tailwind ตาม feature |
| `src/ui-refinement.css` | 507 | ยุบ duplicate rules และแยก component styles |
| `src/minimal-workspace.css` | 352 | แยกเฉพาะ rules ที่ยังใช้; เลิก override cascade ซ้อน |

ไม่รวมการย้าย production data/เปลี่ยน auth แล้วเสร็จใน frontend phase ไม่เพิ่ม semantic
search, vector database, auto-answer LLM, telephony engine ใหม่ หรือ realtime sockets ใน MVP
แต่มี orchestration สำหรับโทรผ่าน provider เดิม, durable retry worker และ import รายชื่อใน MVP

## 3. Frontend architecture ที่จะใช้

Dependency direction:

`Page → feature component → hook → service → HTTP client → API`

`DTO/schema → mapper → domain/view model` และ `Zustand → UI workflow state`

| Layer | ทำหน้าที่ | สิ่งที่ห้ามผสม |
|---|---|---|
| Page | ประกอบหน้าจอจาก feature components | ไม่ fetch API หรือแปลง DTO ยาวๆ ใน JSX |
| Shared UI | Button, Input, Dialog, Table, Menu, Badge, Skeleton | ไม่รู้จัก Event service หรือ org permission |
| Feature component | EventForm, FaqEditor, TicketCard, TicketDrawer | ไม่ import backend entities หรือ fetch โดยตรง |
| Hook | orchestration, query/mutation lifecycle, permission state | ไม่กลายเป็น global store ของทุก feature |
| Service | endpoint, request DTO, response parsing, cancellation | ไม่ import React, Zustand หรือ render toast |
| DTO/schema | รูปแบบ wire และ validation ข้อมูลที่ boundary | ไม่ส่ง SeaORM model ตรงไป frontend |
| Mapper/model | แปลง wire → UI model เช่น UTC date และ enum labels | ไม่ซ่อน network side effects |
| Zustand | active org, board filters, selected ticket, local drafts | ไม่ persist password/token หรือ duplicate server cache |
| Query cache | ใช้ TanStack Query เป็นข้อเสนอสำหรับ server state | query key ต้องมี orgId และ event/filter ที่เกี่ยวข้อง |

Zustand ใช้ store ต่อ concern และ selectors; คงแค่ UI preference ที่ไม่ sensitive
ใน persistence ส่วน async server data ให้ hook/query cache ดูแล ลด stale data สองชุด
Form state อยู่ใน form component/hook; ไม่ใส่ทุก keystroke ลง global store

### Folder structure

```text
frontend/
  src/
    app/                 # bootstrap, providers, router, error boundary
    layouts/             # AuthLayout, WorkspaceLayout, OrgShell
    components/ui/       # reusable presentation primitives
    features/
      auth/              # pages, components, dto, schemas, hooks, services
      organizations/     # switcher, memberships, invitations
      events/            # event list/detail/form
      knowledge/         # categories, FAQ editor/search/publish
      tickets/           # kanban, details, comments, activity
      participants/      # template download, import preview, recipient list
      calling/           # call runs, new/fail lanes, ratio policy, attempt timeline
      agent-access/      # org/event credential pairs, scopes, examples
    shared/
      api/               # HTTP client, errors, pagination, request context
      contracts/         # API-generated models split by module
      lib/               # date, formatting; no domain dumping ground
    stores/              # session-view, organization, UI preferences
    styles/              # tokens.css, base.css; <=300 lines each
    mocks/               # development/test handlers only
  tests/                 # browser journeys + contract tests
backend/
  crates/api/            # bootstrap and HTTP server
  crates/core/           # shared identifiers, errors and context only
  crates/modules/        # auth, orgs, events, knowledge, tickets, agents, imports, calling
  crates/persistence/    # connection, SeaORM entities, repository implementations
  crates/migration/      # ordered schema migrations
contracts/               # versioned OpenAPI split by module
tests/api/               # Groovy/Spock HTTP acceptance suite + Gradle Wrapper
scripts/checks/          # source-line and architecture checks
```

แต่ละ feature เปิด public exports ที่ `index.ts`; ห้าม deep-import internal ของ feature อื่น
แชร์เฉพาะ component ที่มี semantic ตรงกันจริง ไม่ทำ mega-form/mega-table ที่ควบคุมด้วย flag มากมาย
หน้าที่ใหญ่ให้แยกตามพฤติกรรม ไม่ย้ายทั้งก้อนเข้า `useEverything` เพื่อเลี่ยงกฎ 300 บรรทัด

## 4. UX scope และ design direction

อิงข้อความ Exa ที่ผู้ใช้ให้เป็น visual source of truth ไม่คัดลอก marketing homepage มาเป็น dashboard
เก็บรายละเอียด tokens และ component states ใน [DESIGN.md](../../DESIGN.md)

### หน้าจอและเส้นทาง

ทุก path ต่อไปนี้อยู่ใต้ `/event-confirm/`; refresh/deep link ต้องทำงาน

| เส้นทาง | หน้าที่และ states สำคัญ |
|---|---|
| `login`, `forgot-password`, `reset-password` | email/password, validation, pending, generic failure, expired token |
| `organizations` | เลือก org, รับ invitation, no membership, create org |
| `orgs/:orgId/events` | รายการ event, search/status filters, empty/error/loading |
| `orgs/:orgId/events/new` | event name, description, venue, schedule, timezone |
| `orgs/:orgId/events/:eventId` | overview, visibility/status, edit/archive |
| `orgs/:orgId/events/:eventId/knowledge` | FAQ/category management, search, preview, publish |
| `orgs/:orgId/events/:eventId/participants` | download template, upload/preview/confirm, row errors, recipients |
| `orgs/:orgId/events/:eventId/calls` | new/fail queues, X:1 ratio, call runs, retry/outcomes, pause/cancel |
| `orgs/:orgId/events/:eventId/settings/credentials` | event credential, paired org credential, revoke/rotate |
| `orgs/:orgId/tickets` | Kanban + list view, filter event/type/assignee, keyboard move |
| `orgs/:orgId/tickets/:ticketId` | detail drawer/page, contact, question, notes, audit history |
| `orgs/:orgId/settings/members` | roles, invites, remove membership |
| `orgs/:orgId/settings/agent-access` | create/revoke org keys, paired event keys, scopes, usage metadata |

Workspace ใช้ sidebar แบบกระชับ + org switcher + content header + contextual toolbar
Event detail มี Overview / Participants / Calls / Knowledge / Tickets tabs และคง breadcrumbs สำหรับ deep links
หน้าที่ไม่อนุญาตต้องแสดง forbidden state; การซ่อนปุ่มไม่ใช่ backend authorization

### Components และ interactions ที่ต้องส่งมอบ

- Shared: Button, IconButton, TextField, Textarea, Select, SearchField, Dialog,
  ConfirmDialog, DropdownMenu, Tabs, DataTable, Pagination, Badge, Toast, EmptyState,
  ErrorState, Skeleton, FormField, PageHeader และ PermissionGate
- Events: EventCard/Row, EventForm, EventStatusBadge, ScheduleFields, EventSummary
- Knowledge: CategorySidebar, CategoryForm, FaqList, FaqEditor, PublishControl,
  KnowledgePreview; เริ่ม plain text ที่เก็บ line breaks ก่อน rich text
- Tickets: KanbanBoard, KanbanColumn, TicketCard, TicketDrawer, AssignmentPicker,
  MoveTicketMenu, ContactSummary, TicketActivity; mobile มี list view
- Auth/org: LoginForm, ResetPasswordForm, OrgSwitcher, InviteForm, MemberRoleSelect
- Imports: TemplateDownload, ImportDropzone, ImportPreviewTable, ImportErrorReport, ImportConfirm
- Calling: CallRunForm, RetryPolicyForm, QueueRatioForm, QueueLaneTabs, QueueStateSummary,
  CallStatusBadge, ConfirmationStatusBadge, AttemptTimeline, CallRunControls
- Credentials: OrgCredentialForm, EventCredentialForm, CredentialPairExample; แสดง secret ครั้งเดียว
- ทุก mutation มี pending/error/retry; destructive operation มีข้อความผลกระทบชัดเจน
- Kanban drag/drop มี keyboard/menu equivalent, optimistic update + rollback และ
  version conflict แจ้งผู้ใช้; ไม่แสดง success ถ้า request ล้มเหลว
- สลับ org ต้อง cancel requests เดิม, clear org-scoped selections/drafts และ cache
  ที่เป็น sensitive; response ของ org เก่าห้ามไปเติม state ของ org ใหม่

## 5. Domain model เป้าหมาย

| Entity | Fields/constraints หลัก |
|---|---|
| User | id, normalized_email unique, password_hash, verified_at, disabled_at |
| Session | token_hash, user_id, expires_at, revoked_at; server-side session store |
| Organization | id, name, slug, status |
| Membership | org_id + user_id unique, role, status |
| Invitation | org_id, normalized_email, role, token_hash, expiry, accepted_at |
| Event | id, org_id, event_code unique per org, slug, name, description, venue, starts_at, ends_at, timezone, status, version |
| Participant | id, org_id, event_id, phone_normalized, first_name, last_name, nickname, source_import_id, version |
| ImportBatch / ImportRow | org/event scope, schema_version, event_version, file_hash, row values/errors, status, committed_at |
| CallRun / CallRecipient | org/event, recipient snapshot, event/policy version, status, created_by; durable run and per-recipient work |
| CallAttempt | run/recipient, attempt_no, lane, provider_call_id, transport_outcome, confirmation_status, next_attempt_at, retry_reason, timestamps |
| EventQueuePolicy / EventQueueState | org/event, new_to_fail_ratio, new_since_fail, pending_turn_id, policy_version; durable weighted scheduling |
| EventCallPolicy | org/event, max_attempts, retry_delay, allowed_hours, cutoff_at, timezone, version |
| CallDispatch / ProviderCallbackReceipt | transactional dispatch reservation/lease และ callback deduplication |
| VoiceProviderConnection | org/event binding, encrypted provider token, configured agent, status; แยกจาก external API keys |
| FaqCategory | id, org_id, event_id, name, sort_order, version; unique name per event |
| Faq | id, org_id, event_id, category_id, question, answer, status, version, published_at |
| FaqPublication | org_id, faq_id, event_id, category_id, published question/answer, revision; snapshot สำหรับ Agent |
| Ticket | id, org_id, event_id, type, status, priority, question, contact fields, assignee_id, due_at, source, version |
| TicketComment | id, org_id, ticket_id, author_id, body, visibility, created_at |
| TicketActivity | id, org_id, ticket_id, actor, action, before/after metadata, created_at |
| OrgApiCredential | id, org_id, key_prefix, key_hash, scopes, expiry, revoked_at |
| EventApiCredential | id, org_id, event_id, org_credential_id, key_prefix, key_hash, scopes, expiry, revoked_at |
| IdempotencyRecord | org_id, org_credential_id, event_credential_id, operation, key, request_hash, response, expiry |
| AuditLog | org_id, actor, action, resource, request_id, timestamp; no raw secrets |

Event/FAQ status: `draft → published → archived`; archived สามารถ restore เป็น draft
FAQ ที่เคย publish แล้วแก้ไขจะเก็บ draft แยกจาก published snapshot; Agent ยังเห็น
revision ที่ publish ล่าสุดจนกด publish อีกครั้ง การ publish แทน snapshot แบบ atomic
และการ archive ต้องทำให้ Agent อ่านไม่ได้ทันที รวมถึง invalidate published-response cache
Ticket type: `unanswered_question | callback_request`
Kanban status: `new → in_progress ↔ waiting → resolved → closed`; reopen ไป `in_progress`
การปิด ticket ต้องมี resolution summary และผู้กระทำ; MVP ใช้ fixed columns ก่อน configurable board
`callback_request` ต้องมีช่องทางติดต่ออย่างน้อยหนึ่งช่อง; `unanswered_question` ต้องมี question

ทุก tenant entity มี `org_id` ที่ backend ตรวจ พร้อม composite FK/unique constraints
เพื่อห้าม FAQ อ้าง category/event ข้าม org และ ticket อ้าง event/assignee ผิด org
Event end ต้องไม่ก่อน start; เก็บ timestamp เป็น UTC และ IANA timezone สำหรับ display
ไม่เปิด hard delete event/category ที่มี references: archive หรือย้าย FAQ อย่างชัดเจน
Assignee ต้องเป็น active membership ของ org; การถอนสมาชิกจัดการงานค้างแบบ transaction

## 6. Auth และ multi-org boundaries

- ใช้ email/password ผ่าน Rust auth service; Argon2id hash และ opaque session cookie
  แบบ HttpOnly/Secure/SameSite; ไม่เก็บ bearer session ใน localStorage
- Login/register/reset จำกัดอัตรา, generic account-discovery responses; invitation-first
  สำหรับสมาชิก ส่วน create org เป็น explicit onboarding ของ owner
- Registration/email verification/reset มี one-time expiring tokens และ email adapter;
  frontend phase mock delivery เท่านั้น ไม่แกล้งแสดงว่าส่งเมลจริง
- CSRF protection สำหรับ cookie-auth mutation, same-origin policy และ session rotation
  หลัง login/เปลี่ยนสิทธิ์; revoke sessions หลัง reset password
- Browser เลือก org ผ่าน URL; backend resolve authenticated user + active membership
  เป็น `OrgContext` ทุก request ห้ามเชื่อ `org_id` ใน body/header โดยไม่มี membership check
- External Agent principal มาจาก org + event credential pair; ตรวจ parent, org, event,
  scopes, expiry/revocation ทั้งคู่ แล้วสร้าง EventContext; ID ใน URL/body ไม่ใช่ credential
- Role proposal: owner (ownership/settings), admin (members/keys/content), editor
  (events/FAQ/tickets), viewer (read-only); owner คนสุดท้ายห้ามถูกลบหรือลดสิทธิ์
- Agent อ่านได้เฉพาะ published knowledge และสร้าง ticket; ไม่มี member admin,
  draft access, board-wide contact listing หรือ ticket transition โดย default
- สิทธิ์ `calls:create` / `calls:read` / `calls:result` เปิดให้ machine integration แยกต่างหากแบบ opt-in;
  การให้ Agent อ่าน FAQ ไม่ได้ให้สิทธิ์โทรหรืออ่านรายชื่อทั้งหมด
- Repository methods บังคับรับ tenant context; cross-org ID ตอบ 404 ไม่เผยว่ามี record
- ใช้ transaction สำหรับ invite acceptance, role change, ticket movement/audit และ publish
- Test org A/B สำหรับ list/get/create/update/delete/search/export/cache ทั้ง user และ agent

## 7. API contracts ก่อนเริ่ม frontend feature

Public browser prefix: `/event-confirm/api/v1`
Agent prefix: `/event-confirm/api/agent/v1`
DTO ใช้ snake_case บน wire, mapper เปลี่ยนเป็น camelCase ใน UI; UUID, ISO-8601 UTC,
explicit enums, cursor pagination และ typed validation errors

ตัวอย่าง browser endpoints:

| Endpoint | หน้าที่ |
|---|---|
| `POST /auth/login`, `/auth/logout`, `/auth/register` | auth และ session |
| `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email` | account recovery |
| `GET /me`, `GET /organizations`, `POST /organizations` | identity และ org onboarding |
| `/orgs/{org_id}/members`, `/invitations` | role/membership lifecycle |
| `/orgs/{org_id}/events` และ `/{event_id}` | event CRUD/archive |
| `/orgs/{org_id}/events/{event_id}/categories` | category CRUD/reorder |
| `/orgs/{org_id}/events/{event_id}/faqs` | FAQ CRUD/query/publish/archive |
| `/orgs/{org_id}/tickets` และ `/{ticket_id}` | board queries/create/detail |
| `POST /orgs/{org_id}/tickets/{ticket_id}/transitions` | status/rank change พร้อม expected_version |
| `/orgs/{org_id}/tickets/{ticket_id}/comments` | internal notes/history |
| `/orgs/{org_id}/org-credentials` | issue/rotate/revoke org credential |
| `/orgs/{org_id}/events/{event_id}/event-credentials` | issue/rotate/revoke event credential ที่ผูก org credential |
| `GET /orgs/{org_id}/events/{event_id}/participant-template?format=csv|xlsx` | template เวอร์ชันปัจจุบันพร้อม event_code/event_date |
| `POST /orgs/{org_id}/events/{event_id}/imports` | upload → validate/preview; ยังไม่ import หรือโทร |
| `POST /orgs/{org_id}/events/{event_id}/imports/{import_id}/commit` | confirm valid batch แบบ idempotent |
| `GET /orgs/{org_id}/events/{event_id}/participants` | participant list/filter |
| `/orgs/{org_id}/events/{event_id}/call-policy` | read/update retry policy |
| `/orgs/{org_id}/events/{event_id}/queue-policy`, `/queue-state` | X:1 policy และ durable lane/counter state |
| `/orgs/{org_id}/events/{event_id}/call-runs` | create/list runs; detail/attempts และ pause/resume/cancel subroutes |

### External Agent API

| Endpoint | Scope | Contract |
|---|---|---|
| `GET /events/{event_id}` | `events:read` | เฉพาะ event ที่ credential pair ผูกไว้และ published |
| `GET /events/{event_id}/categories` | `knowledge:read` | categories ที่มี published FAQ |
| `GET /events/{event_id}/faqs?q=&category_id=&cursor=` | `knowledge:read` | published Q/A พร้อม ids, version, updated_at |
| `POST /events/{event_id}/tickets` | `tickets:create` | unanswered/callback ticket + external reference |
| `POST /events/{event_id}/call-runs` | `calls:create` | explicit opt-in; call saved participant IDs, policy version, Idempotency-Key |
| `POST /events/{event_id}/call-attempts/{attempt_id}/results` | `calls:result` | final confirmation result; dual credentials + idempotency/version checks |
| `GET /events/{event_id}/call-runs/{run_id}` | `calls:read` | scoped run/attempt summary; no internal notes |

Key แสดงครั้งเดียวตอนสร้าง เก็บ hash, prefix, expiry, last_used_at และ revoke ได้
ทุก event API ใช้ `Authorization: Bearer <org_credential>` และ
`X-Event-Credential: <event_credential>`; derive org/event จาก pair ไม่เชื่อ tenant override
ไม่มี org-only enumeration ของ Events ใน Agent API; staff ใช้ browser API เพื่อ list
Effective scopes คือ intersection ของ credential ทั้งคู่; การ revoke org key ทำให้ลูกทุก event ใช้ไม่ได้
Agent API response ใช้ DTO projection แยกจาก staff DTO ไม่เปิด contact/internal notes
FAQ search เริ่ม exact/substring + normalization สำหรับไทย/อังกฤษ พร้อม pagination;
ถ้าไม่พบคืน empty result ไม่สร้างคำตอบเอง การค้นแบบ semantic อยู่หลัง MVP
ตอบ `Cache-Control: no-store` ใน MVP เพื่อให้ revoke/archive มีผลทันที; ถ้าเพิ่ม cache
ภายหลังต้องผูก credential/org/event/revision และกำหนด invalidation ให้ครบ

Agent ticket write ต้องใช้ `Idempotency-Key`: unique ต่อ org/event/credential pair/operation,
request hash ตรงกันจึงคืน response เดิม; payload เปลี่ยนใช้ key เดิมตอบ 409
insert ticket + activity + idempotency record ใน transaction เดียว ป้องกัน concurrent retries
กำหนด retention ขั้นต้น 24 ชั่วโมงและบอก client ชัดเจน; external_reference เป็น correlation
ไม่ใช้ contact phone เป็น ticket dedup identity และมี payload size/rate limits
CallRun/CallAttempt มี durable unique reservation ตลอดอายุ run เพิ่มจาก idempotency cache;
transport retry ไม่ใช่การสร้าง attempt ใหม่ ดู [calling contract](CALLING_IMPORT_CREDENTIAL_PLAN.md)

Error contract: `{ error: { code, message, field_errors?, request_id } }`
HTTP 400/422 validation, 401 auth, 403 permissions, 404 tenant-safe lookup,
409 version/idempotency conflict, 429 rate limit และ 5xx ไม่มี internal stack/secret
Update DTO รับ `expected_version`; board move ตอบ version ใหม่หรือ 409 เพื่อ reload

## 8. Rust + SeaORM separation of concerns

`router/middleware → handler → request DTO → service/use case → repository → SeaORM → PostgreSQL`

- Handler แปลง HTTP/context/DTO และ status เท่านั้น; ไม่ query database โดยตรง
- Service เก็บ business rules, permissions, transaction boundary และ domain errors
- Repository ใช้ typed tenant context, pagination และ query constraints;
  SeaORM `Model`/`ActiveModel` เป็น persistence detail ไม่ serialize เป็น response
- Response DTO เลือก fields ที่อนุญาตโดย explicit mapper; Agent DTO แยกจาก staff DTO
- Module `auth`, `organizations`, `events`, `knowledge`, `tickets`, `agent_access`,
  `participants`, `imports`, `calling`, `provider_adapter`, `audit` มี public interface ชัด;
  ไม่อ่านตารางอีก module โดย bypass service/repository
- เริ่ม modular monolith พร้อม durable calling worker แยก process จาก codebase เดียวกัน
  ใช้ PostgreSQL queue/lease/reservation ใน MVP ไม่ใช้ browser timer สำหรับ retry
- Queue MVP ใช้ `call_jobs` ใน database เดิม โดย dispatch มี lane=new/fail และ ratio X:1
  พร้อม EventQueueState แบบ persisted + worker หนึ่งตัว; API/worker ใช้ image เดียวกัน
  แต่คนละ command ไม่เพิ่ม broker; ย้ายไป Lightsail ได้โดยคง queue เดิม
- Shared errors/config/clock/IDs มีขนาดเล็ก; หลีกเลี่ยง generic repository framework
- Connection pool, request timeout/body limit และ password-hash concurrency มีเพดาน
- SeaORM migrations แยกเป็นไฟล์ตามการเปลี่ยน; production ใช้ ordered migrations
  และ deployment lock ไม่ใช้ schema sync ตอน startup
- OpenAPI เป็น contract versioned; generate TypeScript types แบบแยก module
  และตรวจ drift/schema validation ไม่ใช้ generated monolith เกิน 300 บรรทัด

## 9. ลำดับ implementation — frontend ก่อน

รายละเอียดงาน dependencies และ async acceptance gates อยู่ใน
[IMPLEMENTATION_PHASES.md](IMPLEMENTATION_PHASES.md) ใช้ phase IDs เดิมด้านล่าง
Backend ใช้ **ntex + Tokio + SeaORM** โดย I/O async ตลอดเส้นทาง;
CPU-heavy hashing/parsing แยก bounded blocking pool ไม่รันบน executor thread


| Phase | งานที่ทำ | Definition of done / dependency |
|---|---|---|
| P0 — Baseline/contracts | ยืนยัน domain/roles, API schemas, inventory legacy, data mapping, repo-private path | reviewed contract + migration inventory; ยังไม่ deploy replacement |
| P1 — Frontend foundation | `frontend/`, Vite base, Tailwind tokens, router, providers, Zustand slices, HTTP abstraction, line gate | build/typecheck ผ่าน, deep link `/event-confirm/`, org-aware shell |
| P2 — UI primitives/auth/org | reusable components, login/reset/invite screens, org switcher, permission states | keyboard/mobile/validation ผ่านด้วย mock contracts; ไม่อ้างว่า auth จริงพร้อม |
| P3 — Event + knowledge | event list/form/detail, categories, FAQ editor/search/publish | CRUD journeys ต่อ mock API ครบ; drafts ไม่อยู่ใน Agent preview |
| P3a — Participants + calling UI | template download/upload/preview/commit, participants, call runs, retry policy/timeline + queue ratio | invalid rows ไม่ commit, upload ไม่โทร, new/fail X:1 journey ผ่าน mock |
| P4 — Kanban | board/list, create ticket, drawer, assignment/comments, filters, drag/menu move | rollback เมื่อ save fail; 409 handling; org switch ไม่ปนข้อมูล |
| P5 — Agent access UX | org/event credential pair screens, scopes, revoke/rotate, endpoint examples | key-once display, pair mismatch errors, no real secrets, contract fixtures ผ่าน |
| P6 — Rust core | ntex/Tokio/SeaORM, auth/session, organizations, migrations, events/FAQ services | real Postgres tests + tenant isolation; connect P2/P3 ด้วย HTTP service เดิม |
| P7 — Tickets + Agent API | transitions/audit, credential pair/scopes, published reads, idempotent writes | missing/mismatched/revoked pair, cross-org/event และ permission tests ผ่าน |
| P7a — Import + calling worker | CSV/XLSX parser, atomic commit, provider adapter, weighted new/fail scheduling, final result/retry/reconciliation | durable ratio/counter, eligible business unknown retry, ambiguous dispatch reconcile, isolation |
| P7b — Groovy API tests | Groovy/Spock HTTP suite, fake provider, queue scenarios, Jenkins JUnit reports | ratio 2:1/5:1, recovery, dual credentials และ confirmation tests ผ่าน |
| P8 — Cutover/deploy | remove mocks, migrate data, provider readiness, API/worker budgets, Jenkins tests/smoke | real auth, dual credentials, import + controlled call/retry acceptance; P7a/P7b must pass |
| P9 — Remaining legacy | recurring schedules/recordings และ flow เก่านอก calling MVP | parity tests หรือ explicit removal decision ก่อนหยุด legacy |

### Frontend tickets ที่เริ่มได้หลังยืนยันแผน

1. FE-01: ย้าย app entry/build เป็น `frontend/`; route basename + asset paths + shared error boundary
2. FE-02: `DESIGN.md` → Tailwind tokens + Button/Input/Dialog/Tabs + state samples
3. FE-03: DTO/schema + HTTP client + error mapper + development-only mock handlers
4. FE-04: Zustand org/UI slices + query-key convention + request cancellation tests
5. FE-05: Login/reset/org-selection journeys และ workspace shell
6. FE-06: Event create/edit/list/detail + status and date validation
7. FE-07: Category management + FAQ editor/search/publish + event knowledge preview
8. FE-08: Kanban/list + detail drawer + movement/assignment/comments + conflict recovery
9. FE-09: Org/event credential pair management UI + sample requests using fake keys only
10. FE-10: keyboard/mobile/accessibility + Playwright acceptance + real-adapter integration readiness

11. FE-11: Event template download + CSV/XLSX upload/preview/errors/confirm + participants table
12. FE-12: New/fail queue views + X:1 selector/counter + run/retry/outcome timeline + pause/cancel/exhausted

FE-01/02/03 มาก่อน feature work; FE-04/05 มาก่อน FE-06–09; FE-06 มาก่อน FE-11
และ FE-11 มาก่อน FE-12; FE-10 ครอบคลุมทั้งสอง journey ใหม่ เป็น gate ก่อน backend cutover
ใช้ MSW หรือเทียบเท่าสำหรับ dev/test ผ่าน service contract เดียวกับ production
mock mode ต้องเปิดแบบ explicit เฉพาะ dev/test; production build fail หากเปิด mock flag
frontend preview ต้องติดป้ายว่า preview ไม่ใช้ credentials/contacts จริง

## 10. Validation และกฎ 300 บรรทัด

- เพิ่ม checker ที่นับ physical lines ของ tracked first-party code ทั้ง TS/TSX,
  JS/MJS, Rust, SQL migrations, CSS, Python, shell, Groovy/Gradle, Dockerfile และ Jenkinsfile
- Tests และ generated first-party DTO/entities ต้องผ่านด้วย; generator ต้อง split output
- Dependency/vendor binaries, lockfiles, build output และ documentation ไม่ใช่ source ที่ gate นี้นับ
- กฎคือ `<=300`; ทุกไฟล์ที่เพิ่ม/แก้ต้องผ่านทันที และ full-tree gate ต้องผ่านก่อนจบ P1
- ไฟล์ CSS legacy 3 ไฟล์ต้องถูกแยก/แทนที่ใน P1; ไม่เพิ่ม exemption ถาวรหรือ minify เพื่อเลี่ยง
- เพิ่ม formatter/lint/import-boundary checks; format ก่อนนับ ห้ามลดบรรทัดด้วยหลาย statement
- Unit: mappers, validation, selectors, transition rules และ pure domain rules
- Component: form states, dialogs/focus, keyboard move, publish guard, empty/error UI
- E2E: login → org → event → category → FAQ → publish → ticket → resolve
- E2E เพิ่ม: download template → upload → validate/commit → select participants → start call
  → no_connection หรือ final not_confirmed → fail lane → weighted next attempt → confirmed/stop/exhausted
- Import: preserve phone leading zero, date/event mismatch, duplicate phone/file/commit,
  expired/stale preview, cross-tenant batch, CSV formula cells และ malformed XLSX
- Calling: duplicate/out-of-order callbacks, worker restart/lease expiry, timeout ambiguity,
  concurrent start/retry, pause/cancel/archive, policy cutoff และ retry limit
- Credentials: missing either key, org/event mismatch, different parent, scope intersection,
  rotation/revoke while queued, expired key, no secrets in templates/logs/client persistence
- Boundary: org A/B leakage, pending request ตอน org switch, viewer mutation denial,
  draft FAQ access, draft edits ไม่เปลี่ยน published snapshot, archive/revoke visibility,
  expired/revoked credential pair, event binding และ unauthenticated APIs
- Groovy/Spock HTTP acceptance: verify 2:1/5:1, lane fallback, cooldown, persisted counters,
  final confirmation, restart/concurrent claim และ credential scope; Jenkins publish JUnit XML
- DB: real PostgreSQL integration สำหรับ composite FK, transactions, concurrency,
  idempotency และ optimistic version checks; SQLite ไม่แทน behavior เหล่านี้
- Preview tests ต้องไม่ส่งโทรศัพท์, email หรือ provider request จริง

## 11. Migration, CI และ deployment

เริ่มทำงานบน refactor branch; main คง foundation จน production gate ผ่าน
UI preview แยกจาก live deployment ไม่ให้ main pollSCM deploy mock app ไปแทน readiness เงียบๆ

Legacy `owner_id` ไม่เท่ากับ `org_id`: ต้องมี mapping user → org ที่ตรวจและอนุมัติ
ไม่รวมข้อมูลผู้ใช้หลายคนเข้าบริษัทเดียวจาก email domain โดยอัตโนมัติ
ข้อมูล event/inbound JSON เดิมต้อง map เป็น Event/FAQ พร้อม source reference และ reconciliation
เลือก cutover window + backup + dry-run import; หลีกเลี่ยง dual writes หากยังไม่มี reconciliation
Cutover calling: หยุด producer/worker เก่า, reconcile in-flight calls, map participant/run/attempt
พร้อม provider IDs ก่อนเปิด worker ใหม่; ห้ามรัน legacy/new dispatcher ซ้ำบนรายชื่อชุดเดียวกัน
Supabase password hashes/session ไม่ถูกถือว่า portable; วาง invite/reset-password flow
และรักษา legacy auth ชั่วคราวจน migration ของสมาชิกพร้อม

Jenkins: format/lint/line-limit → frontend tests/build → Rust tests/clippy → Postgres integration → Groovy API acceptance
→ publish reports/artifacts → immutable images → migrate → deploy → local/public smoke → cleanup
Rust `CARGO_BUILD_JOBS=1`; shared builder/lock เดิม; pool และ runtime budgets วัดจาก load test
64 MiB ของ nginx foundation ไม่ใช่ budget ของ Rust/Postgres/calling worker; ตั้ง limits แยกราย service
Worker ใช้ bounded concurrency/lease และ heartbeat; health/smoke ไม่ dispatch calls จริง
เก็บ import staging แบบมี TTL และ ownership; เป็น application retention ไม่ใช่ Docker volume prune
cleanup เพิ่มเฉพาะ verified project `frontend/node_modules`, `frontend/dist`, `backend/target`
รวม `tests/api/build` และ project-local Gradle cache หลัง publish JUnit reports
และ disposable caches หลัง consumers เสร็จ รักษา deployed/rollback images และ data volumes
DB rollback ใช้ backward-compatible expand/contract migrations; revert image ไม่เท่ากับ revert schema

## 12. Repository ownership และ private readiness

ตรวจ GitHub ณ วันวางแผน: `otterdev0341/event-cf` มี ADMIN access, `isPrivate=false`,
`isFork=true`, parent คือ `pannawat1233/voice-confirm`; metadata ไม่ระบุ license
และ checkout ไม่พบ LICENSE/NOTICE ที่ tracked ไว้
`package.json: private=true` ป้องกัน npm publish ไม่ได้ทำให้ GitHub repo เป็น private

การ rewrite code ไม่ได้เปลี่ยน fork relationship หรือสิทธิ์ใน source เดิมโดยอัตโนมัติ
ตรวจสิทธิ์ใช้ source/assets/fonts ที่จะคงไว้ก่อนกำหนด license ของโครงการใหม่

แนวทางหลัก: backup Git refs และ repository settings/metadata → ตรวจ eligibility ของ
GitHub “Leave fork network” → detach → verify `isFork=false` → เปลี่ยน visibility เป็น private
ตาม [GitHub detaching guide](https://docs.github.com/en/pull-requests/how-tos/work-with-forks/detaching-a-fork)
การ detach เป็น permanent และมีผลต่อ issue/PR/wiki/metadata ต้องตรวจผลกระทบก่อนดำเนินการ

ถ้า detach ไม่พร้อมใช้: สร้าง standalone private repo ชื่อใหม่ใน `otterdev0341`,
คัดลอก branches/tags ที่ต้องการโดยรักษา history, ตรวจ refs แล้วเปลี่ยน local origin/Jenkins
เก็บ repo เดิมไว้จนยืนยันครบ ไม่ใช้ delete-and-recreate เป็นขั้นตอนอัตโนมัติ

Private readiness acceptance:

- owner ถูกต้อง, `isFork=false`, `isPrivate=true` หลังเปลี่ยนจริง
- Jenkins ใช้ deploy key/GitHub App credential ที่มีสิทธิ์อ่าน private repo และ checkout สำเร็จ
- ไม่ฝัง PAT/SSH private key ใน remote URL, repo, image หรือ build log
- แก้ repo URL/docs/webhook/polling หากเปลี่ยนชื่อ; ตรวจ branch/tag/commit continuity
- Backup metadata ที่ต้องเก็บก่อน detach; visibility ไม่ลบสำเนาที่เคยถูกเผยแพร่
- Private source repo ไม่ได้ทำให้ public website เป็น private; คง public login/Agent endpoints
  ตาม policy ที่กำหนด แต่ทุก business data request ต้องผ่าน auth

รอบวางแผนนี้ **ยังไม่ detach, สร้าง repo ใหม่ หรือเปลี่ยน visibility**
ดู [GitHub visibility guide](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)

## 13. Decisions ที่ต้องยืนยันก่อน phase ที่เกี่ยวข้อง

| ประเด็น | Default ในแผน | ต้องยืนยันก่อน |
|---|---|---|
| Calling scope | import, initial calls, no-connection/not-confirmed retry อยู่ใน MVP; recordings/recurrence แยก | P0 / P7a parity |
| Queue ratio | X:1 ต่อ org/event; 2:1 เป็นค่าเสนอ; persisted counter + eligible-lane fallback | P3a/P7a |
| Not confirmed | final not_confirmed เข้า fail; explicit decline/opt-out ไม่ retry โดย default | P0/P7a result mapping |
| API tests | Groovy + Spock + Gradle Wrapper; isolated provider stub | P7b ก่อน deploy |
| Retry defaults | ข้อเสนอ 3 attempts รวมสายแรก, เว้น 15 นาที, เปิดด้วย explicit confirmation | P3a/P7a ก่อนโทรจริง |
| Template | CSV UTF-8 + XLSX, 6 columns, event เดียวต่อไฟล์ | P3a contract freeze |
| Duplicate phone | หนึ่ง participant ต่อ normalized phone/event; ชื่อขัดกันให้แก้ก่อน commit | P3a ก่อนล็อก schema |
| Auth ownership | Rust-managed sessions + email/password | P6 schema + account migration |
| Org onboarding | create org โดย owner; สมาชิกจาก invitation | P2/P6 |
| Category scope | ต่อ event; หนึ่ง category ต่อ FAQ | P3 contract freeze |
| Kanban | fixed columns, org board + event filter | P4 |
| Credentials | org + event pair, intersection scopes, calls opt-in | P5/P7/P7a |
| Font assets | ใช้ fallback ที่มีสิทธิ์ชัดเจนก่อน ไม่ bundle proprietary font | P1 design tokens |
| Repo path | detach ที่เดิมก่อน; ชื่อใหม่เป็น fallback | ขั้นตอน private migration |
| Contact data retention | จำกัด field/access; ระยะเวลารอ product decision | ก่อน P8 เก็บข้อมูลจริง |

## 14. References

- [Tailwind + Vite official integration](https://tailwindcss.com/docs/installation/using-vite)
- [Zustand slices](https://zustand.docs.pmnd.rs/learn/guides/slices-pattern.html)
- [ntex runtime and handlers](https://docs.ntex.rs/api/ntex/index.html)
- [SeaORM connection management](https://www.sea-ql.org/SeaORM/docs/install-and-config/connection/)
- Visual reference: Exa design specification ที่ผู้ใช้ให้ใน conversation (ไม่อ้างว่าได้ audit live Exa dashboard)

## 2026-10-21 requirement update

See [Workspace operations update](WORKSPACE_OPERATIONS_UPDATE.md) and its
[JSON plan](WORKSPACE_OPERATIONS_UPDATE.json). This supersedes the earlier role names,
single assignee/three-stage board, template columns, dashboard and retry-policy UI.
The remaining backend phases must implement these contracts and Swagger route parity.
