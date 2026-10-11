# เปิดใช้ Backend และฐานข้อมูล Voice Confirm

## สถานะงาน

ระบบใช้ Supabase Auth และติดตั้งตารางในโปรเจกต์เดิมแล้ว เมื่อ 11 ตุลาคม 2026 โหมดปกติให้สมาชิกที่ล็อกอินและยืนยันอีเมลแล้วใช้ Voice Bot ได้อัตโนมัติ

## 1. ติดตั้งตารางใน Supabase โปรเจกต์เดิม

เปิด SQL Editor ด้วยบัญชีเจ้าของโปรเจกต์ แล้วรันไฟล์ `supabase/migrations/202610090001_voice_workspace.sql` หนึ่งครั้ง

- `voice_campaigns`: เก็บฉบับร่าง รายชื่อ CSV, mapping และข้อมูลแคมเปญใน JSONB ต้นฉบับ
- RLS จำกัดข้อมูลตาม `auth.uid()` ผู้ใช้รายอื่นอ่าน/ลบแคมเปญไม่ได้
- `save_voice_campaign`: บันทึกแบบ transaction พร้อมตรวจเวอร์ชันข้อมูล ป้องกันการแก้ทับข้ามอุปกรณ์
- `voice_call_requests`: เก็บคำขอโทรและ Call ID ของผู้ส่ง
- `reserve_voice_call`: จอง request UUID ก่อนส่ง API ป้องกันส่งซ้ำด้วย UUID เดิม จำกัด 5 คำขอต่อนาทีต่อผู้ใช้
- ไม่ต้องใช้ service-role key ในเว็บหรือ Vercel Function

การสร้างตารางไม่ลบข้อมูลเดิม และโค้ดไม่ย้าย localStorage เข้าบัญชีโดยเงียบๆ หน้าแคมเปญมีปุ่มนำเข้าข้อมูลเดิมให้ตรวจเจ้าของก่อน ยังคงข้อมูลเดิมในเครื่องไว้

## 2. Environment Variables บน Vercel

ตั้งทั้ง Preview/Production ตาม environment ที่ใช้ แล้ว redeploy commit ใหม่

| ชื่อ | ค่า |
|---|---|
| `VITE_SUPABASE_URL` | URL โปรเจกต์ Supabase เดิม |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key เดิม |
| `VOICE_BOT_BASE_URL` | `https://api-voicebot-stg.botnoigroup.com` |
| `VOICE_BOT_ACCESS_TOKEN` | Token Voice Bot เดิม ตั้งเป็น server secret |
| `VOICE_ACCESS_MODE` | `members` (ค่าเริ่มต้น) เปิดให้สมาชิกที่ยืนยันอีเมลแล้ว หรือ `allowlist` จำกัดตามรายชื่อ |
| `VOICE_ALLOWED_EMAILS` | อีเมล Supabase Login ที่อนุญาต คั่นด้วย comma; ต้องยืนยันอีเมลแล้ว |
| `VOICE_ALLOWED_USER_IDS` | ทางเลือกที่มั่นคงกว่า: UUID ผู้ใช้ Supabase คั่นด้วย comma |

ในโหมด `members` ไม่ต้องเพิ่มสิทธิ์รายอีเมล และรายชื่อ allowlist เดิมไม่มีผล โหมด `allowlist` เท่านั้นที่ใช้ `VOICE_ALLOWED_EMAILS` / `VOICE_ALLOWED_USER_IDS` และปฏิเสธทุกบัญชีหากทั้งสองว่าง ค่าโหมดอื่นจะถูกปฏิเสธ สมาชิกใช้ Agent, คู่สาย และโควตาของบัญชี Voice Bot กลางร่วมกัน รวมถึงรายงานและบันทึกสนทนาที่อ่านจากบัญชีกลาง ส่วนแคมเปญ รายชื่อ CSV และประวัติคำขอโทรใน Supabase ยังแยกตามผู้ใช้ด้วย RLS

ลบ `VITE_VOICE_BOT_ACCESS_TOKEN` และ `VITE_VOICE_BOT_BASE_URL` จาก Vercel หลังตั้งค่าชื่อใหม่แล้ว เพราะ `VITE_*` เป็นค่าที่เผยแพร่ไปยังเบราว์เซอร์ Token เก่าที่เคยเผยแพร่ใน bundle ควรเปลี่ยนที่ผู้ให้บริการ และใส่ค่าใหม่เฉพาะตัวแปร server

## 3. Build และ deploy

- Install: `npm ci`
- Build: `npm run build`
- Output: `dist`
- ใช้ Git deployment ของทั้ง repository เพื่อให้ Vercel สร้าง `/api/voice` ด้วย การอัปโหลดเฉพาะ `dist` ไม่รวม Backend
- local: `npm run dev` ใช้ handler เดียวกันผ่าน Vite middleware
- `npm run preview` แสดงเฉพาะ static build ไม่ใช่ API server
- ตั้ง Supabase Auth Site URL/Redirect URLs ให้มี URL ของเว็บจริง และ localhost ที่ใช้พัฒนา

## 4. ตัวแปรรายคน

หน้าโทรทดสอบอ่านตัวแปรจาก Prompt จริง เลือกแถว CSV เพื่อเติมค่า แก้ไขและตรวจข้อมูลก่อนโทรได้ การเลือกแถวไม่เปลี่ยนเบอร์ทดสอบอัตโนมัติ

คำขอส่ง `destination`, `agent_id`, `metadata: { variables, campaign_id?, contact_row? }` ตาม schema API ที่อนุญาต metadata เป็น object ตรวจฟิลด์และสิทธิ์ที่เซิร์ฟเวอร์ซ้ำก่อนโทร ไม่แก้ Prompt กลางของ Agent

**ข้อจำกัดผู้ให้บริการ:** เอกสารระบุ metadata แต่ยังไม่ได้ยืนยัน convention `metadata.variables` ว่าจะถูกนำไปแทนตัวแปรใน Prompt จริง ต้องให้ผู้ดูแล Voice Bot ยืนยันการเชื่อมข้อมูลก่อนถือว่าการพูดชื่อ/วันงานเฉพาะบุคคลพร้อมใช้ เอกสาร: https://voicebot-stg.botnoigroup.com/docs/post-v1-provisioning-tenants-tenant_id-calls

## ก่อนใช้จริง

ติดตั้ง migration และตรวจเปิด RLS ในโปรเจกต์ระยะไกลแล้ว แต่ยังไม่ได้โทรจริงจาก backend ใหม่นี้ งานรอบนี้ไม่รวมคิวโทรทั้งแคมเปญ ตั้งเวลา webhook หรือผลตอบรับรายคน

เมื่อคำขอ timeout เซิร์ฟเวอร์บันทึก unknown และหน้าเว็บหยุดส่งซ้ำ ต้องตรวจคำขอ/Call ID ในหน้าตั้งค่าก่อนโทรใหม่ การป้องกันซ้ำครอบคลุม UUID เดิมเท่านั้น ไม่ใช่การรับประกัน exactly-once ของ API ผู้ให้บริการ

## CSV campaign calling

Campaign data now stores optional variableBindings (CSV column or explicit output). The batch call endpoint reads the saved CSV under owner RLS and rejects a stale campaign_version. No additional SQL migration is needed. The browser queue uses existing voice_call_requests history and request reservations. Keep the browser open; scheduling and background execution are not implemented. Output classification omits those inputs, but does not implement provider result extraction.
