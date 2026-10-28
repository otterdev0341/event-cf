import { SessionAccount } from '../components/SessionAccount';
import { AppHeader } from '../components/AppHeader';
import { VoiceConnection } from '../components/VoiceConnection';
import { UserRoles } from '../components/UserRoles';
import { useIsDev } from '../components/WorkspaceGate';
export function SettingsPage() {
  const isDev = useIsDev();
  return <div className="settings-page"><AppHeader /><main className="settings-main page-shell real-data-page">
    <header className="rd-head"><div><span className="ui-kicker">ACCOUNT &amp; CONNECTION</span><h1>บัญชีและการเชื่อมต่อ</h1><p>จัดการบัญชีเว็บและบัญชี Voice Bot ที่ใช้โทร</p></div></header>
    <div className="rd-settings">
      <nav className="rd-subnav" aria-label="หมวดการตั้งค่า">{isDev && <a href="#voicebot">บัญชี Voice Bot</a>}{isDev && <a href="#roles">ตำแหน่งผู้ใช้งาน</a>}<a href="#account">บัญชีที่เข้าสู่ระบบ</a></nav>
      <div className="rd-stack">{isDev && <div id="voicebot"><VoiceConnection /></div>}{isDev && <div id="roles"><UserRoles /></div>}<div id="account"><SessionAccount /></div></div>
    </div>
  </main></div>;
}
