import { SessionAccount } from '../components/SessionAccount';
import { AppHeader } from '../components/AppHeader';
import { VoiceConnection } from '../components/VoiceConnection';
export function SettingsPage() {
  return <div className="settings-page"><AppHeader /><main className="settings-main page-shell real-data-page"><header><h1>ข้อมูลบัญชี</h1><p>จัดการบัญชีเว็บและเชื่อมบัญชี Voice Bot ของคุณ</p></header><VoiceConnection /><SessionAccount /><section className="settings-card"><h2>การตั้งค่าที่ยังไม่เชื่อมต่อ</h2><p className="workspace-note">ยังไม่มีบริการบันทึกข้อมูลองค์กรและการแจ้งเตือน จึงยังเปิดแก้ไขรายการเหล่านี้ไม่ได้</p></section></main></div>;
}
