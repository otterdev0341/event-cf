# เชื่อมระบบรับผลจากเว็บ Voice Confirm

เปิดหน้า Agent / บทสนทนา หรือขั้นตอนเลือก Agent แล้วเลือกบอท กด **เชื่อมระบบรับผล** ตรวจชื่อบอทและยืนยัน

เซิร์ฟเวอร์ตรวจบัญชีและสิทธิ์ผู้ดูแล สร้างหรือใช้ HTTP Tool สำหรับ Agent นี้ ผูก Tool และเพิ่มส่วนคำสั่งส่งผลใน Prompt แล้วอ่านการตั้งค่ากลับเพื่อยืนยัน ไม่ได้เริ่มโทรจากปุ่มนี้

## ตั้งค่าฝั่ง server

- ติดตั้ง `supabase/migrations/202610120001_agent_result_setup.sql` ใน Supabase เดียวกัน
- `VOICE_ADMIN_EMAILS`: อีเมลผู้ดูแลที่ยืนยันแล้ว คั่นด้วย comma หรือ `VOICE_ADMIN_USER_IDS`: UUID ผู้ดูแลจาก Supabase
- `VOICE_RESULT_CALLBACK_URL`: URL แบบ HTTPS ของ receiver เช่น `https://voice-confirm-two.vercel.app/api/voice-result`
- ใช้ `VOICE_BOT_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `VOICE_RESULT_CALLBACK_SECRET` และ Supabase URL เดิม
- ค่าทั้งหมดนี้อยู่เฉพาะเซิร์ฟเวอร์ ห้ามใส่คีย์ลับในตัวแปร `VITE_`

สมาชิกทุกคนอ่านสถานะการเชื่อมต่อได้ แต่ POST เชื่อมระบบทำได้เฉพาะผู้ดูแลที่เซิร์ฟเวอร์กำหนด ระบบไม่อ่านสิทธิ์จาก user_metadata ที่สมาชิกแก้เองได้ ไม่มีผู้ดูแลที่กำหนด = ไม่มีใครแก้ Agent ผ่านเว็บได้

## การเก็บข้อมูลและคำขอซ้ำ

- เก็บ config ก่อนแก้และผู้ดำเนินการใน `voice_agent_setup_audits` ตารางนี้ให้เฉพาะ service_role เข้าถึง ไม่มี RLS policy สำหรับสมาชิก
- ใช้ lock ในฐานข้อมูลแยกตาม Agent มีอายุ 120 วินาที ป้องกันการสร้าง Tool ซ้อนกันจากหลายเครื่อง
- Tool ใช้ชื่อกำหนดจาก Agent ID และตรวจ URL/schema/auth ก่อนใช้ หากมี Tool ที่ตั้งชื่อตรงกันแต่ค่าอื่นไม่ตรง จะหยุดให้ผู้ดูแลตรวจ
- ไม่ลอง POST สร้าง Tool ซ้ำทันทีเมื่อ timeout ครั้งถัดไปจะอ่าน Tool ที่มีอยู่ก่อน
- ตรวจ revision จาก preview และตรวจซ้ำก่อนบันทึก Agent หากถูกแก้จะหยุด การตรวจนี้ยังไม่ใช่ atomic compare-and-swap ของ Voice Bot จึงควรหลีกเลี่ยงแก้ Agent ใน Voice Bot พร้อมกับกดเชื่อม
- Prompt, เสียง, การโอนสาย และ Tool อื่นถูกเก็บไว้ เพิ่มเฉพาะคำสั่งส่งผลและ Tool รับผล
- ค่า “เชื่อมแล้ว” ยืนยันการตั้งค่าเท่านั้น ต้องทดสอบสายจริงสำหรับ Agent ใหม่ หากผู้รับวางสายก่อน Tool ทำงานอาจไม่มีผลตอบรับ

GET/POST `/api/voice?path=/workspace/agents/<agent_id>/result-setup` รับเฉพาะ `confirm` และ `expected_revision` ไม่รับ URL, key, prompt หรือ config ตามที่ browser ส่งมา
