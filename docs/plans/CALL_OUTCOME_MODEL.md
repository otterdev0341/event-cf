# ผลการโทรและ target architecture

สถานะ: ข้อกำหนดใหม่สำหรับ refactor ยังไม่ได้ implement
เอกสารนี้แทนที่คำว่า `not_confirmed` และ mapping ผลการโทรในแผนก่อนหน้า
ใช้ชื่อ API มาตรฐาน `confirm`, `decline`, `unknown` (จากคำว่า denine/unknow ใน requirement)

## ผลทางธุรกิจ 3 แบบ

| attendance_result | ความหมาย | โทรซ้ำอัตโนมัติ | Ticket |
|---|---|---|---|
| `confirm` | ยืนยันเข้าร่วม | หยุดและ cancel pending retries | ยังเปิดได้ถ้า AI ตอบคำถามไม่ได้ หรือมีคำขอติดต่อกลับ |
| `decline` | ไม่เข้าร่วม | หยุดและ cancel pending retries | เก็บ ticket ที่มีอยู่; ผลไม่บังคับปิด ticket |
| `unknown` | ยังสรุปการเข้าร่วมไม่ได้ ต้องมีเหตุผล | เข้า FAIL เฉพาะ terminal result ที่ผ่าน retry policy | เปิดจากคำถาม/คำขอติดต่อกลับได้ ไม่สร้างอัตโนมัติทุก missed call |

`unknown_reason` ที่ต้องรองรับ:

- `no_answer`: ไม่รับสาย แสดงจำนวนครั้งไม่รับ `no_answer_count` เช่น ไม่รับ 3 ครั้ง
- `noisy_audio`: รับสายแต่เสียงรบกวนจนสรุปไม่ได้
- `ai_cannot_infer`: รับสายแต่ AI ตีความการเข้าร่วมไม่ได้

จำนวนไม่รับคำนวณจาก terminal no_answer attempts ที่ไม่ซ้ำ แยกจาก attempt_count รวม
แต่ละ attempt เก็บ reason ของตัวเอง ไม่ overwrite ประวัติเมื่อเหตุผลเปลี่ยน
ถ้าจะรองรับ busy/unreachable เพิ่ม ให้เป็น reason ที่ประกาศใน contract และมี provider mapping
ห้ามเหมารวมเป็น no_answer หรือสร้าง reason จาก free text ที่ไม่ได้ตรวจสอบ

## แยก business result ออกจากสถานะระบบ

- `attendance_result` เป็น nullable ขณะยังไม่โทร/รอผล และมีเพียงสามค่าข้างต้นเมื่อมีผล
- `processing_state` เก็บ queued, in_flight, awaiting_result, reconciliation, completed
- `transport_outcome` เก็บหลักฐานจาก provider เช่น answered/no_answer; Agent ปลอม field นี้ไม่ได้
- HTTP timeout, missing webhook, ไม่ทราบว่า provider รับคำสั่งหรือไม่ เป็น reconciliation
  ไม่ใช่ business unknown และไม่เป็นเหตุให้โทรซ้ำโดยอัตโนมัติ
- `retry_state` แยก eligible/delayed/exhausted/stopped; exhausted ไม่ใช่ผลทางธุรกิจแบบที่สี่
- `unknown_reason` ต้องมีเมื่อ result=unknown และเป็น null เมื่อ confirm/decline
  พร้อม reason_detail ที่ผ่าน validation เพื่อให้เจ้าหน้าที่เข้าใจ โดยไม่เก็บ secret
- Agent ส่ง final result ผ่าน API เดิมที่ตรวจ org + event credentials, calls:result scope,
  attempt ID, revision และ idempotency; provider callback ใช้ authentication แยก
- ให้ ingest result และ ticket intent แบบ idempotent ใน transaction เดียว หรือ durable retry
  เพื่อไม่ให้ confirm สำเร็จแล้วคำถามที่ตอบไม่ได้สูญหายเมื่อ ticket creation ล้มเหลว

## Retry และ ticket

unknown หลังสายจบเข้า FAIL ตาม delay, max attempts, calling window และ event cutoff
confirm/decline ไม่เข้า FAIL แม้มี ticket; callback_requested ต้องใช้เวลานัด/การดำเนินงานของ staff
แทน immediate automatic retry ถ้ามี callback intent พร้อม unknown ให้ defer automatic retry
อัตรา X:1 คงเดิม: X NEW dispatches ที่ provider ยอมรับ ต่อ 1 FAIL dispatch
ตัวอย่าง 2:1 = NEW, NEW, FAIL; fallback เมื่ออีกคิวยังไม่พร้อม

Late confirm/decline ที่ตรวจสอบ attempt/revision ถูกต้องยกเลิก pending retries ใน transaction
callback เก่าห้ามลดผล confirm/decline กลับ unknown; correction ต้อง explicit + audit
หากสายถัดไปเริ่มแล้วให้แสดง in-flight จริง ไม่รับประกันยกเลิกสายที่ provider เริ่มไปแล้ว

ค่า N ครั้งสูงสุดและ delay ยังเป็น policy ที่ต้องกำหนด; ข้อเสนอเดิม 3 attempts/15 นาที
ไม่ใช่จำนวนที่ผู้ใช้ยืนยันแล้ว และจำนวน no_answer ไม่ reset เมื่อ restart หรือเปลี่ยน ratio

## เพิ่ม Groovy API acceptance cases

1. confirm + unanswered question: หยุด retry แต่สร้าง ticket หนึ่งใบ แม้ request ซ้ำ
2. decline: ไม่ enqueue FAIL และไม่ปิด ticket ที่ค้างโดยอัตโนมัติ
3. unknown/no_answer: เพิ่ม no_answer_count ครั้งเดียว; retry จนครบ policy แล้วแสดง N ครั้ง
4. unknown/noisy_audio และ unknown/ai_cannot_infer: แสดงเหตุผลถูกต้องและเข้า FAIL ตามเวลา
5. unknown ไม่มี reason หรือ confirm แนบ unknown_reason: reject ตาม validation contract
6. provider timeout/missing result: reconcile โดยไม่มี speculative FAIL dispatch
7. late confirm/decline และ duplicate/out-of-order results: ไม่โทรซ้ำ/ไม่ downgrade ผล
8. callback intent + unknown: defer auto retry; ticket/scheduled follow-up ไม่เกิดสายซ้ำ

ใช้ fake provider และ test clock ตาม WEIGHTED_QUEUE_GROOVY_TEST_PLAN.md ไม่โทรจริงใน CI

## Diagrams

- [Target architecture JPG](../diagrams/target-architecture.jpg)
- [Target architecture PlantUML](../diagrams/target-architecture.puml)
- [Call outcome flow JPG](../diagrams/call-outcome-flow.jpg)
- [Call outcome flow PlantUML](../diagrams/call-outcome-flow.puml)

Frontend-first: reusable components → hooks → services → DTO; Vite/Tailwind/Zustand
Backend: Rust/ntex modular monolith + SeaORM/PostgreSQL; worker แยก process ใช้ domain services ร่วม
Lightsail: Compose บน instance เดียวและ off-host backups; ยังไม่ใช่ HA
Production ปัจจุบันยังเป็น deployment foundation ไม่ใช่ target architecture ในภาพ
