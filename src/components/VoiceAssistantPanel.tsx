import { Button } from './Button';
import { Waveform } from './Waveform';
import { routes } from '../routes';
const wave = [11, 20, 31, 22, 40, 50, 33, 25, 45, 56, 36, 22, 42, 53, 31, 20, 34, 48, 28, 17, 25, 36, 20, 11];
export function VoiceAssistantPanel() {
  return <section className="assistant-panel" aria-labelledby="assistant-title"><div className="assistant-panel__header"><span id="assistant-title">Voice Confirm Workspace</span><span className="assistant-panel__ready">พร้อมใช้งาน</span></div><Waveform heights={wave} className="assistant-panel__wave" /><div className="assistant-panel__analysis"><p>เริ่มต้นจากข้อมูลของคุณ</p></div><ol className="workspace-intro-steps"><li>นำเข้ารายชื่อจากไฟล์ CSV</li><li>เลือก Voice Agent จากบัญชีที่เชื่อมต่อ</li><li>โทรทดสอบและตรวจสถานะจาก API</li></ol><Button href={routes.campaigns}>เปิดพื้นที่ทำงาน →</Button><p className="assistant-panel__hint">ผลการโทรจะแสดงเมื่อได้รับข้อมูลจากบริการ Voice Bot</p></section>;
}
