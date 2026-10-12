# เชื่อมระบบรับผลจากเว็บ Voice Confirm

เปิดหน้า Agent / บทสนทนา หรือขั้นตอนเลือก Agent แล้วเลือกบอท กด **เชื่อมระบบรับผล** ตรวจชื่อบอทและยืนยัน

เซิร์ฟเวอร์ตรวจ Session JWT ส่วนตัวและสิทธิ์ในบัญชี Voice Bot สร้างหรือใช้ HTTP Tool สำหรับ Agent นี้ ผูก Tool และเพิ่มส่วนคำสั่งส่งผลใน Prompt แล้วอ่านการตั้งค่ากลับเพื่อยืนยัน ไม่ได้เริ่มโทรจากปุ่มนี้

## ตั้งค่าฝั่ง server

- ติดตั้ง `supabase/migrations/202610120001_agent_result_setup.sql` ใน Supabase เดียวกัน
- ติดตั้ง `202610120002_voice_connections.sql` และตั้ง `VOICE_CONNECTION_ENCRYPTION_KEY` ตาม `PERSONAL_VOICE_BOT_CONNECTION.md`
- `VOICE_RESULT_CALLBACK_URL`: URL แบบ HTTPS ของ receiver เช่น `https://voice-confirm-two.vercel.app/api/voice-result`
- ใช้ JWT ที่แต่ละผู้ใช้เชื่อมในหน้าตั้งค่า พร้อม `SUPABASE_SERVICE_ROLE_KEY`, `VOICE_RESULT_CALLBACK_SECRET` และ Supabase URL เดิม
- ค่าทั้งหมดนี้อยู่เฉพาะเซิร์ฟเวอร์ ห้ามใส่คีย์ลับในตัวแปร `VITE_`

สมาชิกที่ยืนยันอีเมลและเชื่อม JWT แล้วจัดการเฉพาะ Agent ในบัญชี Voice Bot ที่ Token ของตนมีสิทธิ์ได้ ไม่มีการใช้ Token กลางแทนบัญชีที่ยังไม่เชื่อม หากหลายคนเชื่อมบัญชี Voice Bot เดียวกัน การแก้ Agent จะมีผลกับผู้ใช้บัญชีนั้นด้วย

## การเก็บข้อมูลและคำขอซ้ำ

- เก็บ config ก่อนแก้และผู้ดำเนินการใน `voice_agent_setup_audits` ตารางนี้ให้เฉพาะ service_role เข้าถึง ไม่มี RLS policy สำหรับสมาชิก
- ใช้ lock ในฐานข้อมูลแยกตามบัญชี Voice Bot และ Agent มีอายุ 120 วินาที ป้องกันการสร้าง Tool ซ้อนกันจากหลายเครื่อง
- Tool ใช้ชื่อกำหนดจาก Agent ID และตรวจ URL/schema/auth ก่อนใช้ หากมี Tool ที่ตั้งชื่อตรงกันแต่ค่าอื่นไม่ตรง จะหยุดให้ผู้ดูแลตรวจ
- ไม่ลอง POST สร้าง Tool ซ้ำทันทีเมื่อ timeout ครั้งถัดไปจะอ่าน Tool ที่มีอยู่ก่อน
- ตรวจ revision จาก preview และตรวจซ้ำก่อนบันทึก Agent หากถูกแก้จะหยุด การตรวจนี้ยังไม่ใช่ atomic compare-and-swap ของ Voice Bot จึงควรหลีกเลี่ยงแก้ Agent ใน Voice Bot พร้อมกับกดเชื่อม
- Prompt, เสียง, การโอนสาย และ Tool อื่นถูกเก็บไว้ เพิ่มเฉพาะคำสั่งส่งผลและ Tool รับผล
- ค่า “เชื่อมแล้ว” ยืนยันการตั้งค่าเท่านั้น ต้องทดสอบสายจริงสำหรับ Agent ใหม่ หากผู้รับวางสายก่อน Tool ทำงานอาจไม่มีผลตอบรับ

GET/POST `/api/voice?path=/workspace/agents/<agent_id>/result-setup` รับเฉพาะ `confirm` และ `expected_revision` ไม่รับ URL, key, prompt หรือ config ตามที่ browser ส่งมา
