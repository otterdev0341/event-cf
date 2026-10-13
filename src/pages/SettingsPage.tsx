import { SessionAccount } from '../components/SessionAccount';
import { AppHeader } from '../components/AppHeader';
import { VoiceConnection } from '../components/VoiceConnection';
export function SettingsPage() {
  return <div className="settings-page"><AppHeader /><main className="settings-main page-shell real-data-page"><header><span className="ui-kicker">ACCOUNT & CONNECTION</span><h1>บัญชีและการเชื่อมต่อ</h1><p>จัดการบัญชีเว็บและบัญชี Voice Bot ที่ใช้โทร</p></header><VoiceConnection /><SessionAccount /></main></div>;
}
