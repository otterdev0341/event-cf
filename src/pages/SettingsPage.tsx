import { SessionAccount } from '../components/SessionAccount';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { useAccount } from '../hooks/useBotnoiData';
export function SettingsPage() {
  const { account, loading, error, refetch } = useAccount();
  return <div className="settings-page"><AppHeader /><main className="settings-main page-shell real-data-page"><header><h1>ข้อมูลบัญชี</h1><p>บัญชี Voice Bot ที่ใช้เรียก API ของพื้นที่ทำงานนี้</p></header><SessionAccount /><section className="settings-card"><h2>ข้อมูลจากบริการ Voice Bot</h2><Button variant="secondary" size="compact" onClick={refetch} disabled={loading}>รีเฟรชบัญชี</Button>{loading ? <p role="status">กำลังโหลดบัญชี…</p> : error ? <p className="workspace-alert" role="alert">{error}</p> : account ? <dl className="real-data-fields"><div><dt>ชื่อผู้ใช้</dt><dd>{account.username || 'ไม่ระบุ'}</dd></div><div><dt>อีเมล</dt><dd>{account.email || 'ไม่ระบุ'}</dd></div><div><dt>บทบาทในบัญชี</dt><dd>{account.role || 'ไม่ระบุ'}</dd></div><div><dt>ยืนยันบัญชี</dt><dd>{typeof account.verified === 'boolean' ? account.verified ? 'ยืนยันแล้ว' : 'ยังไม่ยืนยัน' : 'ไม่ระบุ'}</dd></div></dl> : <p>ไม่มีข้อมูลบัญชี</p>}</section><section className="settings-card"><h2>การตั้งค่าที่ยังไม่เชื่อมต่อ</h2><p className="workspace-note">ยังไม่มีบริการบันทึกข้อมูลองค์กรและการแจ้งเตือน จึงยังเปิดแก้ไขรายการเหล่านี้ไม่ได้</p></section></main></div>;
}
