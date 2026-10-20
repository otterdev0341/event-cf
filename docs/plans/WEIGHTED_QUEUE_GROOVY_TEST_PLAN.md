# Two-lane calling queue + Groovy API acceptance tests

> **อัปเดตผลการโทร:** ใช้ [CALL_OUTCOME_MODEL.md](CALL_OUTCOME_MODEL.md) เป็นข้อกำหนดล่าสุด: `confirm` / `decline` / `unknown` พร้อมเหตุผล แทน `not_confirmed` ในเอกสารนี้; confirm อาจมี ticket และ decline ไม่โทรซ้ำ

วันที่: 21 ตุลาคม 2026 · สถานะ: แผน ยังไม่ implementation
Requirement ล่าสุดแทนที่ข้อกำหนดเดิมที่ retry เฉพาะ no_answer และหยุดเมื่อ answered
อ้างอิง [แผนหลัก](REFACTOR_IMPLEMENTATION_PLAN.md), [calling](CALLING_IMPORT_CREDENTIAL_PLAN.md)
และ [Lightsail queue](QUEUE_LIGHTSAIL_DESIGN.md)

## 1. สอง logical queues บน PostgreSQL เดียวกัน

| Lane | รายการที่อยู่ในคิว | ลำดับภายใน lane |
|---|---|---|
| `new` | รายชื่อที่ import/commit และยืนยันเริ่ม run แล้ว ยังไม่เคย dispatch | FIFO ตาม enqueue sequence; รักษาลำดับแถวในแต่ละ batch |
| `fail` | attempt ที่จบแล้วโทรไม่ติด หรือผลยืนยันเป็น not_confirmed และยัง retry ได้ | due `available_at` ก่อน แล้ว enqueue sequence |

ไม่ต้องเพิ่ม broker/database สองตัว: ตาราง `call_jobs` เดิมเพิ่ม `lane=new|fail`
เฉพาะ dispatch jobs ส่วน `reconcile_call` เป็น control work ไม่ใช่ lane โทรที่สาม
การ upload ยังไม่เริ่มโทร; start run เป็นจุด enqueue new recipients
ใช้ worker เดียวและ sequential dispatch ใน MVP พร้อม existing active-call limits

## 2. Weighted scheduling: X new ต่อ 1 fail

ตั้งค่า `new_to_fail_ratio=X` เป็นจำนวนเต็มบวก เช่น 2 หรือ 5 โดย denominator คงที่ 1
สัดส่วนนี้คือ **จำนวน call dispatch ที่ provider รับแล้ว** ไม่ใช่จำนวนสำเร็จหรือจำนวนรอบ polling
สมมติฐาน scope: ต่อ `(org_id,event_id)` ครอบคลุม active runs ของ Event เดียวกัน
ไม่มี counter กลางร่วมทุก org และไม่มีการเพิ่มอัตราเพียงเพราะเปิดหลาย runs

ตัวอย่างเมื่อทั้งสองคิวมีรายการที่พร้อมโทรตลอด:

- `2:1` → `N1 → N2 → F1 → N3 → N4 → F2`
- `5:1` → `N1 → N2 → N3 → N4 → N5 → F1 → N6 ...`
- สาย new ที่ไม่ติดก็ยังนับเป็นหนึ่ง dispatch ฝั่ง new แล้วค่อย enqueue retry ใน fail
- สาย fail ที่ยังไม่ยืนยันและมีโควตาเหลือกลับไปท้ายลำดับตาม next available_at ใน fail
- เบอร์เดิมไม่วนกลับ new; retry แต่ละครั้งอยู่ fail จน confirmed/stop/exhausted

### Durable counter และ atomic scheduling

เพิ่ม `EventQueueState(org_id,event_id,new_since_fail,policy_version,pending_turn_id,version)`
และ `EventQueuePolicy(new_to_fail_ratio,version)`; default proposal 2:1 แต่ผู้ใช้เปลี่ยนได้
CallRun snapshot เก็บ retry limits/delay; ratio เป็น EventQueuePolicy แยก ไม่ให้แต่ละ run ขัดกัน

1. Lock queue-state row ของ Event และเลือก eligible job ภายใต้ transaction เดียว
2. ถ้า counter < X และ new พร้อม → เลือก new
3. ถ้า counter >= X และ fail พร้อม → เลือก fail
4. ถ้าคิวที่ควรได้ turn ว่างหรือยังไม่ถึงเวลา → ใช้อีกคิวที่พร้อม ไม่ปล่อย worker idle โดยไม่จำเป็น
5. บันทึก pending turn + job/attempt reservation + lease; commit ก่อนเรียก provider
6. เมื่อยืนยัน provider accepted แล้ว update counter เพียงครั้งเดียวด้วย turn ID/version:
   new → `min(X,new_since_fail+1)`; fail → `0`; clear pending turn
7. หาก provider ปฏิเสธก่อนเกิดสายอย่างแน่นอน ไม่ consume turn; classification จัดการ failed item
8. หาก dispatch ambiguous ให้ค้าง pending turn ของ Event และ reconcile ก่อนเลือก turn ถัดไป
   ไม่ block Event อื่นที่ยังผ่าน provider capacity; ห้ามถือว่า lease หมดแล้วสามารถส่งซ้ำ

Counter saturate ที่ X ไม่สะสมหนี้ เช่น new วิ่ง 100 ครั้งขณะ fail ยังไม่ due
เมื่อ fail พร้อมให้โทร fail 1 ครั้ง แล้วกลับไปรอบ X:1 ปกติ ไม่ชดเชย fail 50 ครั้งติด
ถ้า new หมดแล้ว fail พร้อม โทร fail ต่อเนื่องได้ตาม delay/active-call limits
ถ้า fail หมดหรือยังไม่ due โทร new ต่อได้; ทั้งสองคิวไม่มี eligible job จึงรอ
Ratio ไม่ override cooldown, cutoff, max_attempts, revoke, suppression หรือ active call

Queue state และ counter ต้องอยู่ใน DB; restart/redeploy ไม่ reset รอบ
SKIP LOCKED ใช้เลือก jobs แต่ห้ามข้าม lock ของ EventQueueState จนเกิด ratio race
การ submit/finalize เก็บ turn identity unique เพื่อไม่เพิ่ม counter ซ้ำจาก callback/retry
Technical job retry/reconcile callback ไม่กิน quota ของ new/fail

Ratio change: pause การจองใหม่ของ Event → resolve pending dispatch → update ด้วย
expected_version → reset counter เป็น 0 และ audit → resume; สาย in-flight ไม่ถูกยกเลิกเอง
Cross-event order เป็น FIFO ของ eligible event heads ใน MVP ภายใต้ quota/capacity;
ratio ภายใน Event ไม่ใช่การรับประกัน fairness ระหว่าง Event ซึ่งต้องเพิ่มภายหลังถ้าพบ starvation

## 3. กติกาเข้า fail queue

แยก `transport_outcome` ออกจาก `confirmation_status` เสมอ

| ผลที่ตรวจสอบได้ | การทำงาน |
|---|---|
| terminal no_answer | fail เมื่อถึงเวลารอและยังมี attempts เหลือ |
| terminal busy / temporarily_unreachable | fail เมื่อ provider adapter ระบุว่า retryable อย่างชัดเจน |
| call ended + final not_confirmed | fail แม้เคยรับสายแล้ว; หยุดที่ max_attempts/cutoff |
| confirmed | จบสำเร็จและ cancel pending retries ของ participant/Event; audit |
| explicitly_declined / do_not_call / invalid_number | default ไม่ retry อัตโนมัติ; แสดงเหตุผลหยุด |
| callback_requested | defer ไป callback ticket/explicit scheduled follow-up ไม่ตีเป็น immediate fail retry |
| missing/pending result หรือ ambiguous transport | reconcile/review; ไม่สร้าง fail job จากการไม่มีข้อมูล |

ข้อเสนอสำหรับคำว่า “ไม่ยืนยัน”: หมายถึง final `not_confirmed` หลังสายจบ ไม่รวม
การปฏิเสธชัดเจน/ขอไม่ให้โทรและไม่รวมผลที่ยังส่งมาไม่ครบ ต้องยืนยัน mapping นี้ก่อน implementation
Provider final transport และ Agent final business result อาจมาคนละเวลา จึงมี
`awaiting_result` state; overdue result ต้อง reconcile/flag review ไม่แปลงเป็น not_confirmed เงียบๆ

Agent ส่ง final confirmation ผ่าน event-scoped result API พร้อมทั้ง org/event credentials,
`calls:result` scope, attempt ID, result revision และ idempotency key; ตรวจ source/account/event
ไม่อนุญาตให้ Agent ปลอม provider transport status เพื่อทำให้สายที่กำลังโทรจบก่อนจริง
Provider callbacks ยังใช้ signature/secret ของ adapter แยกต่างหาก

หนึ่ง attempt ที่ทั้งไม่ติดและไม่ยืนยันสร้าง fail job ได้สูงสุดหนึ่งตัว
ใช้ unique transition/dedupe key ของ `(org,event,recipient,run,next_attempt_no)`
Late confirmed result จาก attempt ที่ correlate ถูกต้องต้อง cancel pending retries
ใน transaction; ถ้าสายถัดไปถูก dispatch ไปแล้วแสดง in-flight ตามจริง ไม่สัญญาว่าดึงสายกลับได้
Stale callback ห้ามย้อน confirmed เป็น not_confirmed; correction ต้อง explicit/versioned/audited

Retry max_attempts และ delay เดิมยังใช้ทั้ง no-connection และ not_confirmed
Proposal 3 attempts รวมสายแรก และ 15 นาทีหลัง terminal/result eligibility; ไม่ reset counter
จำนวนครั้งเมื่อเปลี่ยน fail reason, requeue job หรือ restart worker

## 4. DTO, API และ frontend ที่เพิ่ม

- `EventQueuePolicyDto`: new_to_fail_ratio, version
- `EventQueueStateDto`: new/fail eligible counts, delayed fail count, new_since_fail,
  pending_turn_id, next_lane (advisory), paused/blocked reason
- `CallAttemptDto`: lane, transport_outcome, confirmation_status, retry_reason,
  attempt_no, available_at, turn_id
- Browser `GET/PATCH /orgs/{org_id}/events/{event_id}/queue-policy`
  และ `GET /orgs/{org_id}/events/{event_id}/queue-state`
- External `POST /events/{event_id}/call-attempts/{attempt_id}/results`
  ใช้ `calls:result` scope, dual credentials และ idempotency/version checks
- UI แสดง New queue / Fail queue, พร้อมโทร/รอ cooldown, ratio selector 2:1/5:1/custom X:1
- Preview ลำดับเช่น N N F เป็นคำอธิบาย policy ไม่รับประกันรายการถัดไปจนถึง dispatch
- แสดง transport outcome แยกจาก confirmed/not_confirmed และ stop/reconcile reason
- เพิ่ม policy change confirmation + queue pause/resume semantics และ attempt history

## 5. Groovy API test suite สำหรับ Jenkins

ใช้ **Groovy + Spock + Gradle Wrapper** เป็น HTTP acceptance tests ของ Rust API
Jenkinsfile ทำ orchestration; business assertions อยู่ใน test files ไม่ยัดลง pipeline script
Groovy runner เป็น test-only dependency ไม่เพิ่ม JVM เข้า production/Lightsail containers
Frontend unit/component/Playwright และ Rust unit/DB tests ยังอยู่ ไม่แทนทั้งหมดด้วย API tests

```text
tests/api/
  build.gradle
  settings.gradle
  gradlew + gradle/wrapper/
  src/test/groovy/eventconfirm/
    support/ApiClient.groovy
    support/FixtureFactory.groovy
    support/ProviderStubClient.groovy
    support/QueueAssertions.groovy
    auth/AuthSpec.groovy
    auth/CredentialPairSpec.groovy
    imports/ParticipantImportSpec.groovy
    calling/NewQueueSpec.groovy
    calling/WeightedQueueSpec.groovy
    calling/ConfirmationRetrySpec.groovy
    calling/QueueRecoverySpec.groovy
    tickets/TicketSpec.groovy
```

ทุก `.groovy`/Gradle/script/test file <=300 physical lines รวม helpers
Pin compatible Groovy/Spock/Gradle/JDK versions ตอน implementation และตรวจ dependency lock
ใช้ HTTP client ภายใน suite ผ่าน real API; fixtures สร้าง org/event/participants ผ่าน API
assert จาก run/attempt/history API และ provider stub dispatch journal ไม่อ่าน counter ภายในอย่างเดียว

### Test environment

- Isolated Rust API + worker + real PostgreSQL + fake provider ใน CI network ของ build นั้น
- Provision disposable users/orgs/keys ไม่มี production secret/phone/SMTP; จำกัด egress ไม่ออก provider จริง
- Fake provider เลือกผล no_answer/busy/answered, accepted-then-timeout, final not_confirmed/confirmed
  และส่ง authenticated duplicate/out-of-order callbacks ได้
- ใช้ injected Clock/shared test clock ให้ API+worker เห็นเวลาเดียวกัน เพื่อ advance cooldown
  ไม่ sleep 15 นาที; assert ผ่าน bounded polling ของ API จนได้ expected condition
- Test control/clock endpoints อยู่เฉพาะ test build และ private CI network; production build ไม่มี route เหล่านี้
- Restart worker test ต้องใช้ persisted queue/counter เดิมจริง ไม่ reseed จน state หาย
- IDs/Compose project/temporary resources แยกต่อ build; sequential tests เริ่มต้นเพื่อจำกัด CPU/RAM

### Acceptance matrix

| ID | Scenario | Expected |
|---|---|---|
| Q01 | upload/commit แต่ยังไม่ start | provider journal ไม่มี calls |
| Q02 | new lane หลายเบอร์ | FIFO, หนึ่ง active call ตาม policy, ไม่ duplicate |
| Q03 | ทั้งสอง lane พร้อม; ratio 2:1 | N N F N N F ตาม provider-accepted dispatch |
| Q04 | ทั้งสอง lane พร้อม; ratio 5:1 | N N N N N F แล้วรอบใหม่ |
| Q05 | fail ว่าง/ยังไม่ due | new เดินต่อ; counter saturate X |
| Q06 | fail due หลังสะสม new | fail 1 แล้วเริ่มรอบใหม่ ไม่ชดเชย fail เป็น burst |
| Q07 | new ว่าง | eligible fail เดินต่อ ไม่รอ new ใหม่ |
| Q08 | terminal no_answer/busy ที่ retryable | enqueue fail หนึ่งครั้งหลัง cooldown |
| Q09 | answered + final not_confirmed | เข้า fail; answered อย่างเดียวไม่จบ journey |
| Q10 | confirmed/declined/do_not_call | confirmed จบ; explicit stop ไม่ retry |
| Q11 | missing result / accepted-then-timeout | awaiting_result/unknown, ไม่เดาโทรซ้ำ |
| Q12 | callbacks ซ้ำ/ย้อนลำดับ/late confirmed | ไม่เพิ่ม fail/counter ซ้ำ; cancel pending retry ถูกต้อง |
| Q13 | restart หลัง N1 ของ ratio 2:1 | ทำ N2 แล้ว F ต่อ ไม่ reset เป็น N1 |
| Q14 | concurrent workers/claim, same Event | pending turn เดียว, counter และ attempts ไม่ถูกนับซ้ำ |
| Q15 | pause/cancel/archive/revoke/cutoff/max attempts | ไม่มี pending dispatch ที่ละเมิดเงื่อนไข |
| Q16 | เปลี่ยน ratio ขณะมี pending turn | reject/block จน reconcile แล้วจึง versioned reset |
| Q17 | org A/B และ Event ต่างกัน | counters, jobs, credentials, API data ไม่ปนกัน |
| Q18 | duplicate start/import/result API requests | คืนผลเดิมหรือ conflict ตาม contract ไม่ส่งสายเพิ่ม |

Fixtures สำหรับ Q03/04 ต้องมี eligible fail jobs ตั้งต้นจาก flow API จริงด้วย stub
จากนั้นเริ่มช่วงวัดด้วย EventQueueState ที่มี counter=0 ผ่าน policy pause/reset action ที่รองรับ
และ assert dispatch subsequence หลัง checkpoint; ไม่สมมติว่าคิว fail มีเองก่อนโทรครั้งแรก

### Jenkins flow และ reports

1. Build/test frontend + Rust; start isolated API-test stack และ wait readiness
2. Run `cd tests/api && ./gradlew test --no-daemon --max-workers=1`
   ใช้ Gradle Wrapper ภายใน tests/api ตาม structure ข้างต้น
3. Test runner ใช้ heap/CPU/PID limits และ `maxParallelForks=1`; keep shared build lock/governance
4. Publish `tests/api/build/test-results/test/*.xml` ด้วย Jenkins `junit` ใน always path
   พร้อม sanitized API/stub logs; report missing/test runner error ต้อง fail ไม่กลบเป็น success
5. Test failure ต้อง block deploy; publish reports ก่อน cleanup หลัง success/failure/abort
   abort ที่ไม่มี report รักษาผล aborted และเก็บ diagnostics ที่มี ไม่อ้างว่าทดสอบผ่าน
6. Cleanup เฉพาะ resources ของ build และ generated test paths หลัง publish เสร็จ
   เช่น `tests/api/build` / project-local `.gradle`; preserve runtime volumes/shared caches

อ้างอิง: [Spock specifications](https://spockframework.org/spock/docs/2.4/spock_primer.html),
[Gradle testing](https://docs.gradle.org/current/userguide/java_testing.html),
[Jenkins JUnit reports](https://www.jenkins.io/doc/pipeline/steps/junit/)

## 6. Implementation placement

- P0: freeze lane semantics, final-result mapping, ratio scope, provider acceptance definition
- P3a/FE-12: queue tabs, ratio selector/state, confirmation result, cooldown/stop explanations
- P5: add opt-in `calls:result` scope and examples for dual credentials
- P7a: EventQueuePolicy/State, atomic weighted claim, result ingestion, durable counters/retries
- P7b: Groovy API suite + fake-provider scenarios + Jenkins report/cleanup wiring
- P8: deploy gate ต้องผ่าน P7a/P7b; still no real calls from normal CI

ยังต้องยืนยัน product defaults: ratio default 2:1 หรือ 5:1, นิยาม not_confirmed กับ
explicitly_declined, max attempts/delay และ business fairness ระหว่าง Events

## 2026-10-21 requirement update

See [Workspace operations update](WORKSPACE_OPERATIONS_UPDATE.md) and its
[JSON plan](WORKSPACE_OPERATIONS_UPDATE.json). This supersedes the earlier role names,
single assignee/three-stage board, template columns, dashboard and retry-policy UI.
The remaining backend phases must implement these contracts and Swagger route parity.
