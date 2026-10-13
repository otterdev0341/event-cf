import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { MetricCard } from '../components/MetricCard';
import { useDashboardOverview } from '../hooks/useBotnoiData';
import { routes } from '../routes';

const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('th-TH', { maximumFractionDigits: 1 }) : '—';
const dayValue = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }) : value;

export function AnalyticsPage() {
  const [period, setPeriod] = useState<'7-days' | 'month'>('month');
  const [source, setSource] = useState<'all' | 'outbound' | 'preview'>('all');
  const recent = useDashboardOverview(period, source);
  const report = recent.overview;
  const validSeries = Array.isArray(report?.series) && report.series.every(item => typeof item.bucket_start === 'string' && Number.isFinite(Date.parse(item.bucket_start)) && Number.isInteger(item.call_count) && item.call_count >= 0);
  const series = validSeries ? [...report!.series].sort((a, b) => Date.parse(a.bucket_start) - Date.parse(b.bucket_start)) : [];
  const total = report && validSeries ? series.reduce((sum, item) => sum + item.call_count, 0) : undefined;
  const distributions = report?.distributions?.source;
  const sourceCount = (key: string) => Array.isArray(distributions) ? distributions.find(item => item.key === key)?.count : undefined;
  const outbound = sourceCount('outbound');
  const preview = sourceCount('preview');
  const sourcesMatch = Number.isInteger(outbound) && Number.isInteger(preview) && outbound! >= 0 && preview! >= 0 && outbound! + preview! === total;
  const summaryMismatch = total !== undefined && report?.summary?.total_calls !== total;
  const average = total && !summaryMismatch ? report?.summary?.avg_call_duration_seconds : undefined;
  const error = recent.error || (report && !validSeries ? 'รูปแบบข้อมูลรายวันจาก Voice Bot ไม่ถูกต้อง กรุณารีเฟรชอีกครั้ง' : null);
  const range = report?.window ? `${dayValue(report.window.start_at)} – ${dayValue(report.window.end_at)}` : period === 'month' ? 'เดือนนี้จนถึงปัจจุบัน' : '7 วันรวมวันนี้';
  const typeLabel = source === 'all' ? 'การโทรออกและการทดสอบบอท' : source === 'outbound' ? 'เฉพาะการโทรออก' : 'เฉพาะการทดสอบบอท';

  return <div className="analytics-page"><AppHeader /><main className="analytics-main page-shell real-data-page">
    <header><span className="ui-kicker">ACCOUNT USAGE</span><h1>การใช้งาน Voice Bot</h1><p>เซสชันของทุก Agent ในรายงานบัญชี Voice Bot ที่เชื่อมอยู่</p><p className="workspace-note">ดูผลตกลง ปฏิเสธ และคำขอเจ้าหน้าที่ของแคมเปญได้ที่ <a href={routes.dashboard}>ภาพรวมการโทร →</a></p></header>
    <section className="activity-section">
      <div className="usage-toolbar"><div className="usage-controls">
        <label>ช่วงเวลา<select value={period} onChange={event => setPeriod(event.target.value as typeof period)}><option value="month">เดือนนี้</option><option value="7-days">7 วันรวมวันนี้</option></select></label>
        <label>ประเภทการใช้งาน<select value={source} onChange={event => setSource(event.target.value as typeof source)}><option value="all">โทรออกและทดสอบบอท</option><option value="outbound">เฉพาะการโทรออก</option><option value="preview">เฉพาะการทดสอบบอท</option></select></label>
      </div><Button size="compact" variant="secondary" onClick={recent.refetch} disabled={recent.loading}>รีเฟรชรายงาน</Button></div>
      <h2>สรุปการใช้งานในช่วงที่เลือก</h2><p className="workspace-note">{range} · {typeLabel} · เขตเวลาไทย</p>
      {recent.loading ? <p role="status">กำลังโหลดรายงาน…</p> : error ? <p role="alert" className="workspace-alert">{error}</p> : <>
        <div className="metric-grid"><MetricCard label="เซสชันทั้งหมด" value={numberValue(total)} description="รวมจากรายการรายวันในตารางด้านล่าง" /><MetricCard label="เซสชันโทรออก" value={numberValue(sourcesMatch ? outbound : undefined)} description="ตามประเภทในรายงาน Voice Bot" /><MetricCard label="เซสชันทดสอบบอท" value={numberValue(sourcesMatch ? preview : undefined)} description="ตามประเภทในรายงาน Voice Bot" tone="success" /><MetricCard label="เวลาเฉลี่ยต่อเซสชัน" value={numberValue(average)} description="วินาที · ค่าเฉลี่ยจากรายงานเดียวกัน" /></div>
        {summaryMismatch && <p className="workspace-alert" role="status">ยอดสรุปที่ Voice Bot ส่งกลับยังไม่ตรงกับรายการรายวัน หน้านี้ใช้ผลรวมจากตารางด้านล่าง และรอข้อมูลค่าเฉลี่ยที่ตรงกัน</p>}
        {total !== undefined && !sourcesMatch && <p className="workspace-note">บริการยังไม่ส่งยอดแยกประเภทที่ตรงกับรายการรายวัน จึงยังไม่แสดงตัวเลขแยกประเภท</p>}
      </>}
    </section>
    <section className="activity-section"><h2>รายการใช้งานรายวัน</h2><p className="workspace-note">ใช้ช่วงเวลาและประเภทเดียวกับสรุปด้านบน · {range}</p>
      {recent.loading ? <p role="status">กำลังโหลดรายวัน…</p> : error ? <p className="workspace-note">รายการรายวันยังโหลดไม่สำเร็จ กดรีเฟรชรายงานเพื่อลองใหม่</p> : !series.length ? <p>ไม่มีเซสชันในรายงาน Voice Bot สำหรับช่วงเวลาและประเภทที่เลือก</p> : <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>วันที่</th><th>เซสชัน</th><th>เวลาเฉลี่ย (วินาที)</th></tr></thead><tbody>{series.map(item => <tr key={item.bucket_start}><td>{dayValue(item.bucket_start)}</td><td>{numberValue(item.call_count)}</td><td>{item.call_count ? numberValue(item.avg_call_duration_seconds) : '—'}</td></tr>)}</tbody><tfoot><tr><th scope="row">รวมในช่วงที่เลือก</th><td><strong>{numberValue(total)}</strong></td><td>—</td></tr></tfoot></table></div>}
    </section><p className="workspace-note">นับเฉพาะเซสชันที่ Voice Bot ส่งกลับในรายงานนี้ ยอดนี้เป็นจำนวนการใช้งาน ไม่ใช่จำนวนผู้ที่ตอบตกลง และไม่ใช่ยอดใช้คู่สายรายเดือนจากระบบโควตา</p>
  </main></div>;
}
