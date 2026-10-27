import { SessionAccount } from '../components/SessionAccount';
import { AppHeader } from '../components/AppHeader';
import { VoiceConnection } from '../components/VoiceConnection';
export function SettingsPage() {
  return <div className="settings-page"><AppHeader /><main className="settings-main page-shell real-data-page">
    <header className="rd-head"><div><span className="ui-kicker">ACCOUNT &amp; CONNECTION</span><h1>บัญชีและการเชื่อมต่อ</h1><p>จัดการบัญชีเว็บและบัญชี Voice Bot ที่ใช้โทร</p></div></header>
    <div className="rd-settings">
      <nav className="rd-subnav" aria-label="หมวดการตั้งค่า"><a href="#voicebot">บัญชี Voice Bot</a><a href="#account">บัญชีที่เข้าสู่ระบบ</a></nav>
      <div className="rd-stack"><div id="voicebot"><VoiceConnection /></div><div id="account"><SessionAccount /></div></div>
    </div>
  </main></div>;
}
