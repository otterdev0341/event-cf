# Event Confirm documentation

เริ่มอ่านก่อน refactor:

- [สถาปัตยกรรมและขอบเขตระบบปัจจุบัน](ARCHITECTURE.md)
- [Application architecture — JPG](diagrams/application-architecture.jpg)
- [Deployment foundation — JPG](diagrams/deployment-foundation.jpg)
- [การ deploy บน Otter host และนโยบาย resource/cleanup](HOST_DEPLOYMENT.md)

ภาพเป็น JPG ที่ render จาก PlantUML มาตรฐาน เปิดด้วย image viewer จาก terminal ได้
เช่น `kitten icat docs/diagrams/application-architecture.jpg` เมื่อใช้ Kitty
หรือ `chafa docs/diagrams/application-architecture.jpg` หากติดตั้ง chafa แล้ว
ต้นฉบับ: [application-architecture.puml](diagrams/application-architecture.puml)
และ [deployment-foundation.puml](diagrams/deployment-foundation.puml)

สร้างภาพใหม่ด้วย:

```bash
python3 docs/diagrams/render.py /path/to/plantuml.jar
```

ต้องมี Java, [PlantUML](https://plantuml.com/command-line), Pillow และ DejaVu Sans
ใช้ Smetana layout engine จึงไม่ต้องติดตั้ง Graphviz เพิ่ม ตัว script ให้ PlantUML
render PNG แล้วแปลง format เป็น JPG โดยไม่จัดวางหรือวาด diagram เอง
ไม่ส่ง source ไปยัง online renderer และไม่เก็บ JAR ไว้ใน Git

เอกสารรายฟีเจอร์เดิม:

- [Personal Voice Bot connection](PERSONAL_VOICE_BOT_CONNECTION.md)
- [Call results](CALL_RESULTS.md), [Agent result setup](AGENT_RESULT_AUTO_SETUP.md)
- [Inbound](INBOUND.md), [Recording callbacks](BOTNOI_RECORDING_CALLBACK.md)
- [Selected calls and recordings](SELECTED_CALLS_AND_RECORDINGS.md)
- [Scheduler และ recurring calls](../SCHEDULER_SETUP.md)
- [API documentation](API_DOCUMENTATION.md)

`BACKEND_SETUP.md`, `DEPLOYMENT_HANDOFF.md` และ `TEST_REPORT.md` เป็นเอกสารจาก
แอปเดิม บางข้อความยังอ้าง shared Voice Bot account, repository เก่า หรือระบุว่า
scheduler ยังไม่มี ซึ่งไม่ตรงกับ source ปัจจุบันทั้งหมด ไม่ใช่หลักฐานว่า
environment ของ `event-cf` ได้ตั้งค่า Supabase หรือ deploy แอปแล้ว
