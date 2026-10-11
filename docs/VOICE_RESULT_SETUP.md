# เชื่อมผลตอบรับจาก Agent เข้า Voice Confirm

## สถานะ

โค้ดฝั่งรับผลพร้อมทดสอบ: `POST /api/voice-result` ใช้ได้ทั้ง Vercel Function และ Vite middleware ไม่มีการเปลี่ยน Agent หรือ deploy จากการเพิ่มไฟล์นี้

ยังต้องมี URL ของ **Voice Confirm บน Vercel** เช่น `https://<your-project>.vercel.app` ลิงก์ `https://voicebot-stg.botnoigroup.com/home` คือฝั่งผู้ส่ง ไม่ใช่ปลายทางรับผล

## 1. ตั้งค่าที่ Vercel และ deploy

เพิ่ม Environment Variables เฉพาะฝั่ง server:

- `SUPABASE_SERVICE_ROLE_KEY`: service_role ของโปรเจกต์ Supabase เดียวกับข้อมูลแคมเปญ เก็บใน Vercel เท่านั้น ห้ามใส่ใน Agent, Git, หน้าเว็บ หรือชื่อที่ขึ้นต้น `VITE_`
- `VOICE_RESULT_CALLBACK_SECRET`: สุ่มรหัสลับอย่างน้อย 32 ตัวอักษร (แนะนำ random 32 bytes แปลงเป็น hex) ใช้ร่วมกันเฉพาะ receiver กับ HTTP Tool
- ใช้ Supabase URL และ Voice Bot access token เดิม

Receiver ปิดด้วย HTTP 503 หากตั้งค่าไม่ครบ ไม่แก้สิทธิ์ตาราง ไม่เพิ่ม migration

## 2. ตั้ง HTTP Tool ใน Voice Bot

สร้าง Tool ชื่อ `save_voice_confirm_result` แล้วผูกให้ Agent ที่จะใช้งานจริง:

- Method: `POST`
- Endpoint: `https://<VOICE_CONFIRM_DOMAIN>/api/voice-result`
- Header: `Content-Type: application/json`
- Header: `Authorization: Bearer <VOICE_RESULT_CALLBACK_SECRET>` (เก็บในช่อง credential ของ Tool ห้ามเขียน secret ลง Prompt)
- Body: JSON object แบนตาม schema ใน `voice-result-tool-schema.json` ห้ามมี wrapper `arguments`/`parameters` และห้ามส่งฟิลด์อื่น

เอกสารยืนยันว่า HTTP Tool รองรับ endpoint/auth/parameters แต่ยังต้องตรวจหน้า UI ของ Agent ว่าผูก Tool และส่ง body อย่างไร ไม่ควรถือว่าไฟล์ schema นี้นำเข้า Tool ได้ทันทีโดยไม่ตั้ง execution

## 3. เพิ่มคำสั่งนี้ท้าย Prompt โดยคงบทสนทนาเดิม

```text
รหัสอ้างอิงสำหรับระบบบันทึกผลของสายนี้คือ {{vc_call_reference}}
ห้ามอ่านรหัสนี้ให้ผู้รับฟัง และห้ามสร้างหรือเปลี่ยนรหัสเอง
เมื่อได้ข้อสรุปสุดท้ายจากคำพูดของผู้รับแล้ว ก่อนจบการสนทนาให้เรียก save_voice_confirm_result:
- request_id: ใช้รหัสอ้างอิงด้านบนตรงตัว
- agent_id: ใส่ Agent ID ของ Agent นี้ตรงตามที่ผู้ดูแลกำหนด
- call_result: CONFIRMED (ตกลง), DECLINED (ปฏิเสธ), CALLBACK_REQUESTED (ให้โทรกลับ), REQUEST_AGENT (ขอเจ้าหน้าที่), WRONG_PERSON (ผิดคน), หรือ UNDETERMINED (ยังสรุปไม่ได้)
- needs_agent: true เมื่อขอเจ้าหน้าที่, false เมื่อทราบชัดว่าไม่ต้องการ, null เมื่อยังไม่ทราบ
- evidence: คำพูดจริงที่ใช้สรุป หรือเหตุผลที่ยังสรุปไม่ได้ ไม่แต่งคำตอบแทนผู้รับ
ส่งผลสุดท้ายหนึ่งครั้ง อย่าส่งผลระหว่างที่คำตอบยังเปลี่ยนได้
ถือว่าส่งสำเร็จเฉพาะเมื่อได้รับ received: true
ถ้าเกิด timeout หรือ HTTP 503 หรือ 409 Concurrent update / Call not yet persisted ให้ลองส่ง payload เดิมซ้ำได้ไม่เกิน 2 ครั้ง
ห้ามเปลี่ยน request_id หรือแต่งผลใหม่เพื่อให้ผ่านข้อผิดพลาด
```

ชื่อ Tool ใน Prompt ต้องตรงกับ Tool จริง และแทน Agent ID ให้ถูกต้อง `NO_ANSWER` มีใน API สำหรับแหล่งข้อมูลที่ยืนยันได้ แต่ Agent ที่กำลังสนทนาไม่ควรเดาว่าผู้รับไม่รับสาย

`vc_call_reference` เป็นตัวแปรสงวน ระบบสร้างจาก UUID ของคำขอโทร แล้วใส่ใน metadata.variables ฝั่ง server อัตโนมัติ ไม่ต้องเพิ่มใน CSV หาก Prompt ใช้ตัวแปรนี้แต่ server ยังตั้งค่าไม่ครบ เว็บจะหยุดก่อนโทรและแจ้งเหตุผล

## 4. ทดสอบครบวงจรหลัง deploy

ใช้สายทดสอบใหม่จาก Voice Confirm และผู้รับที่ยินยอม จากนั้นตรวจ:

1. Agent ได้รับ `vc_call_reference` ที่เป็น UUID จริง (ไม่ใช่ข้อความ placeholder)
2. Tool ส่ง JSON ตาม schema พร้อม auth ไปยัง Vercel แล้วได้รับ HTTP 200 `{"received":true}`
3. แถวสายโทรแสดงผลพร้อมแหล่งที่มา **Agent ส่งผลผ่าน Tool** และข้อความประกอบ
4. ดาวน์โหลด CSV มีผล/source/evidence ตรงกับคำตอบจริง
5. ส่ง payload เดิมซ้ำได้ผล duplicate โดยไม่มีข้อมูลซ้ำ ผลสุดท้ายที่ต่างจากเดิมถูกปฏิเสธเพื่อให้ผู้ใช้ตรวจแก้ในเว็บ

หาก Prompt substitution หรือ Tool binding ใช้ไม่ได้ ต้องตรวจการตั้งค่าหรือ runtime ของ Voice Bot ก่อน ขณะนี้ยังไม่มีหลักฐานทดสอบจาก Tool จริง

## ขอบเขตและพฤติกรรม

- รับเฉพาะสายใหม่ที่เปิด correlation ไว้และมี call_id บันทึกแล้ว ตรวจทั้ง request_id และ agent_id ไม่จับคู่ด้วยชื่อหรือเบอร์โทร
- API key ของ Tool อนุญาตส่งผลให้สายที่เปิดใช้ receiver จึงต้องเก็บเป็นความลับ ไม่ใช่ token ของผู้ใช้เว็บ
- รักษาผลที่ผู้ใช้ตรวจเองไว้แยกต่างหาก ผล manual เป็นค่าที่แสดงหลัก หากมี
- callback ไม่เปลี่ยนสถานะสายเป็น completed; สถานะโทรยังมาจาก Voice Bot
- หน้าแคมเปญอ่านผลที่บันทึกใหม่ทุก 15 วินาทีขณะเปิดหน้า ไม่ใช่ push realtime
- ข้อความ evidence เป็นข้อสรุปจาก Agent ไม่ใช่ transcript เต็ม ระบบไม่แต่ง transcript จาก evidence
- Tool ทำงานระหว่างสนทนา หากสายหลุดก่อน Agent เรียก Tool อาจไม่มีผล ต้องใช้ post-call webhook/log ของผู้ให้บริการเพิ่มเติมสำหรับกรณีนี้
- สายเก่าที่ไม่ได้ส่ง correlation ไม่สามารถรับผลย้อนหลังผ่าน receiver นี้ และไม่ได้ถูกเติมข้อมูลจำลอง

อ้างอิง: https://voicebot-stg.botnoigroup.com/docs/post-platform-config-tools
