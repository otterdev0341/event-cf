import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { MetricCard } from '../components/MetricCard';
import { useAccount, useTelephonyOverview, useDashboardOverview } from '../hooks/useBotnoiData';
const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('th-TH', { maximumFractionDigits: 1 }) : '—';
export function AnalyticsPage() {
  const account = useAccount();
  const monthly = useTelephonyOverview(account.tenantId);
  const recent = useDashboardOverview();
  const usage = monthly.overview?.sections.usage?.ok ? monthly.overview.sections.usage.data : null;
  const total = usage?.outbound?.calls_total;
  const answered = usage?.outbound?.calls_answered;
  const rate = typeof total === 'number' && total > 0 && typeof answered === 'number' && answered >= 0 && answered <= total ? `${(answered / total * 100).toFixed(1)}%` : '—';
  const series = recent.overview?.series;
  return <div className="analytics-page"><AppHeader /><main className="analytics-main page-shell real-data-page"><header><h1>รายงานการใช้งานบัญชี</h1><p>ข้อมูลรวมทุก Agent ตามบัญชี Voice Bot ที่เชื่อมต่อ</p></header>
    {account.error && <p role="alert" className="workspace-alert">{account.error}</p>}
    <section className="activity-section"><h2>การใช้งานรายเดือน {usage?.month || ''}</h2><Button size="compact" variant="secondary" onClick={monthly.refetch} disabled={!account.tenantId || monthly.loading}>รีเฟรชการใช้งาน</Button>{account.loading || monthly.loading ? <p role="status">กำลังโหลดการใช้งาน…</p> : monthly.error ? <p role="alert" className="workspace-alert">{monthly.error}</p> : !usage && <p className="workspace-note">ไม่มีข้อมูลการใช้งานรายเดือนจาก API</p>}
    <div className="metric-grid"><MetricCard label="การโทรออกทั้งหมด" value={numberValue(total)} /><MetricCard label="รับสาย" value={numberValue(answered)} description={`อัตรารับสาย ${rate} · ผลยืนยันเข้าร่วมยังไม่ระบุ`} tone="success" /><MetricCard label="สายล้มเหลว" value={numberValue(usage?.outbound?.calls_failed)} tone="danger" /><MetricCard label="นาทีใช้งานบอท" value={numberValue(usage?.bot_minutes)} /></div></section>
    <section className="activity-section"><h2>เซสชันรายวันใน 7 วันที่ผ่านมา</h2><p className="workspace-note">รวม Outbound และ Preview จากรายงานส่วนกลางทุก Agent · เขตเวลา Asia/Bangkok</p><Button size="compact" variant="secondary" onClick={recent.refetch} disabled={recent.loading}>รีเฟรชรายวัน</Button>
    {recent.loading ? <p role="status">กำลังโหลดรายวัน…</p> : recent.error ? <p className="workspace-alert" role="alert">{recent.error}</p> : !series?.length ? <p>ไม่มีข้อมูลเซสชันรายวันในช่วงนี้</p> : <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>จุดเริ่มช่วงตามที่ API ส่งกลับ</th><th>เซสชัน</th><th>เวลาเฉลี่ย (วินาที)</th></tr></thead><tbody>{series.map(item => <tr key={item.bucket_start}><td>{item.bucket_start}</td><td>{numberValue(item.call_count)}</td><td>{numberValue(item.avg_call_duration_seconds)}</td></tr>)}</tbody></table></div>}
    </section><p className="workspace-note">สถิติแคมเปญและผลยืนยันเข้าร่วมยังไม่มีข้อมูลจากบริการแคมเปญ</p>
  </main></div>;
}
