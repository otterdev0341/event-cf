// Summary of public/openapi.yaml (the source of truth). Update both when an endpoint changes.
export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export interface Endpoint { method: Method; path: string; tag: string; summary: string; detail: string; }
export interface EndpointGroup { id: string; title: string; auth: string; note: string; endpoints: Endpoint[]; }

export const apiGroups: EndpointGroup[] = [
  {
    id: "agent", title: "เครื่องมือของ Agent", auth: "Bearer accountKey",
    note: "ถูกเรียกโดย HTTP Tool ของ Voice Bot Agent ระหว่างสนทนา ใส่ key ที่ Credential ของ Tool ไม่ใส่ใน prompt",
    endpoints: [
      { method: "POST", path: "/api/voice-result", tag: "บันทึกผลสาย", summary: "บันทึกผลสุดท้ายของสาย หรือข้อความสนทนา", detail: "Agent ส่งผลสุดท้าย 1 ครั้งต่อสายก่อนวางสาย ต้องใช้ request_id จาก {{vc_call_reference}} ตรงตัว ส่ง JSON แบบเรียบ ห้ามห่อด้วย arguments หรือ parameters ถ้า timeout, 503 หรือ 409 ให้ส่งซ้ำได้ไม่เกิน 2 ครั้ง" },
      { method: "POST", path: "/api/voice-events", tag: "ค้นข้อมูลงาน", summary: "ค้นข้อมูลงานที่เปิดเผยได้", detail: "ส่ง query กับ event_id ว่างเพื่อรับรายการให้เลือก แล้วส่ง event_id ที่เลือกเพื่อรับสถานที่และรายละเอียด ไม่คืนชื่อ เบอร์โทร ข้อมูล CSV หรือผลการโทร" },
    ],
  },
  {
    id: "provider", title: "Callback จากผู้ให้บริการ", auth: "Bearer accountKey",
    note: "ถูกเรียกโดยระบบของ Botnoi ไม่ใช่โดยโมเดลภาษา",
    endpoints: [
      { method: "POST", path: "/api/voice-recording", tag: "ผูกไฟล์เสียง", summary: "ผูกไฟล์บันทึกเสียงกับ Call ID", detail: "ไม่บังคับ ไม่จำเป็นเมื่อ GET /calls/{call_id} คืน conversation.linked_by เป็น exact อยู่แล้ว รับ path .txt และเซิร์ฟเวอร์จะเปลี่ยนนามสกุลสุดท้ายเป็น .wav" },
    ],
  },
  {
    id: "website", title: "เว็บไซต์ (ผู้ใช้ที่ล็อกอิน)", auth: "Bearer Supabase JWT",
    note: "ถูกเรียกโดยหน้าเว็บ Voice Confirm ด้วย session ของผู้ใช้ ไม่ใช่ proxy ทั่วไป เซิร์ฟเวอร์ตรวจ session อีเมลที่ยืนยัน บัญชี Voice Bot ที่เชื่อม สิทธิ์ของ Agent และ path ที่อนุญาต",
    endpoints: [
      { method: "GET", path: "/api/voice", tag: "อ่านข้อมูล", summary: "อ่านข้อมูล Voice Bot และ workspace", detail: "ส่ง path เป็น query เช่น /me, /agents, /dashboard/v1/overview, /workspace/usage, /logs/call_logs_platform และ /workspace/inbound รูปแบบข้อมูลที่ตอบขึ้นกับ path" },
      { method: "POST", path: "/api/voice", tag: "สั่งงาน", summary: "เริ่มการโทรหรือแก้ข้อมูล workspace", detail: "โทรออก 1 สายผ่าน /v1/provisioning/tenants/{tenant_id}/calls บันทึกการเชื่อมต่อ ตั้งเวลาแคมเปญ ผูก Agent กับเบอร์ และอื่นๆ ตาม path ที่อนุญาต ปฏิเสธคำขอข้ามไซต์ (Sec-Fetch-Site: cross-site)" },
    ],
  },
  {
    id: "ops", title: "ระบบและการดูแล", auth: "ตามแต่ละ endpoint",
    note: "ใช้ตรวจสถานะและรันงานเบื้องหลัง",
    endpoints: [
      { method: "POST", path: "/api/voice-scheduler", tag: "Scheduler", summary: "รัน worker ของแคมเปญ 1 รอบ", detail: "Supabase pg_cron เรียกทุกนาทีด้วย scheduler token (Bearer) ที่เก็บใน Vault ชื่อ voice_campaign_scheduler_token ดู SCHEDULER_SETUP.md" },
      { method: "GET", path: "/healthz", tag: "Health", summary: "ตรวจว่าเซิร์ฟเวอร์ทำงานอยู่", detail: "ไม่ต้องยืนยันตัวตน ตอบ text/plain ว่า ok" },
    ],
  },
];
