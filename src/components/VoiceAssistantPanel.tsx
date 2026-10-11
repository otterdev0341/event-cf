import { Button } from './Button';
import { routes } from '../routes';
export function VoiceAssistantPanel() {
  return <section className="assistant-panel" aria-labelledby="assistant-title"><div className="assistant-panel__header"><span id="assistant-title">Voice Confirm Workspace</span></div><div className="assistant-panel__analysis"><p>เริ่มต้นจากข้อมูลของคุณ</p></div><ol className="workspace-intro-steps"><li>นำเข้ารายชื่อจากไฟล์ CSV</li><li>เลือก Voice Agent จากบัญชีที่เชื่อมต่อ</li><li>โทรทดสอบและตรวจสถานะจาก API</li></ol><Button href={routes.campaigns}>เปิดพื้นที่ทำงาน →</Button><p className="assistant-panel__hint">ผลการโทรจะแสดงเมื่อได้รับข้อมูลจากบริการ Voice Bot</p></section>;
}
