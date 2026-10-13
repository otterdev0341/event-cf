import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { MetricCard } from '../components/MetricCard';
import { useAccount, useTelephonyOverview, useDashboardOverview } from '../hooks/useBotnoiData';
import { routes } from '../routes';
const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('th-TH', { maximumFractionDigits: 1 }) : '—';
const dayValue = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }) : value;
export function AnalyticsPage() {
  const account = useAccount();
  const monthly = useTelephonyOverview(account.tenantId);
  const recent = useDashboardOverview();
  const usage = monthly.overview?.sections.usage?.ok ? monthly.overview.sections.usage.data : null;
  const total = usage?.outbound?.calls_total;
  const answered = usage?.outbound?.calls_answered;
  const rate = typeof total === 'number' && total > 0 && typeof answered === 'number' && answered >= 0 && answered <= total ? `${(answered / total * 100).toFixed(1)}%` : '—';
  const series = recent.overview?.series;
  return <div className="analytics-page"><AppHeader /><main className="analytics-main page-shell real-data-page"><header><span className="ui-kicker">ACCOUNT USAGE</span><h1>การใช้งาน Voice Bot</h1><p>ยอดใช้งานรวมทุก Agent ของบัญชี Voice Bot ที่เชื่อมอยู่ ทั้งการโทรผ่านเว็บนี้และการใช้งานส่วนอื่นของบัญชี</p><p className="workspace-note">ดูผลตกลง ปฏิเสธ และคำขอเจ้าหน้าที่ของแคมเปญได้ที่ <a href={routes.dashboard}>ภาพรวมการโทร →</a></p></header>
    {account.error && <p role="alert" className="workspace-alert">{account.error}</p>}
    <section className="activity-section"><h2>การใช้งานรายเดือน {usage?.month || ''}</h2><Button size="compact" variant="secondary" onClick={monthly.refetch} disabled={!account.tenantId || monthly.loading}>รีเฟรชการใช้งาน</Button>{account.loading || monthly.loading ? <p role="status">กำลังโหลดการใช้งาน…</p> : monthly.error ? <p role="alert" className="workspace-alert">{monthly.error}</p> : !usage && <p className="workspace-note">ไม่มีข้อมูลการใช้งานรายเดือนจาก API</p>}
    <div className="metric-grid"><MetricCard label="การโทรออกทั้งหมด" value={numberValue(total)} description="ยอดรวมรายเดือนของบัญชี Voice Bot" /><MetricCard label="รับสาย" value={numberValue(answered)} description={`อัตรารับสาย ${rate} · การรับสายยังไม่ใช่ผลตอบตกลง`} tone="success" /><MetricCard label="สายล้มเหลว" value={numberValue(usage?.outbound?.calls_failed)} tone="danger" /><MetricCard label="นาทีใช้งานบอท" value={numberValue(usage?.bot_minutes)} /></div></section>
    <section className="activity-section"><h2>เซสชันรายวันใน 7 วันที่ผ่านมา</h2><p className="workspace-note">รวม Outbound และ Preview จากรายงานส่วนกลางทุก Agent · เขตเวลา Asia/Bangkok</p><Button size="compact" variant="secondary" onClick={recent.refetch} disabled={recent.loading}>รีเฟรชรายวัน</Button>
    {recent.loading ? <p role="status">กำลังโหลดรายวัน…</p> : recent.error ? <p className="workspace-alert" role="alert">{recent.error}</p> : !series?.length ? <p>ไม่มีข้อมูลเซสชันรายวันในช่วงนี้</p> : <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>วันที่</th><th>เซสชัน</th><th>เวลาเฉลี่ย (วินาที)</th></tr></thead><tbody>{series.map(item => <tr key={item.bucket_start}><td>{dayValue(item.bucket_start)}</td><td>{numberValue(item.call_count)}</td><td>{numberValue(item.avg_call_duration_seconds)}</td></tr>)}</tbody></table></div>}
    </section><p className="workspace-note">รายเดือนนับการโทรออก ส่วนรายวันรวมการโทรออกและการทดสอบบอทตามข้อมูลจาก Voice Bot ยอดของสองส่วนจึงอาจต่างกัน</p>
  </main></div>;
}
