import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { MetricCard } from '../components/MetricCard';
import { useCallUsage } from '../hooks/useBotnoiData';
import { routes } from '../routes';

const numberValue = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 1 });
const dayValue = (value: string) => new Date(value).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });

export function AnalyticsPage() {
  const [period, setPeriod] = useState<'7-days' | 'month'>('month');
  const [source, setSource] = useState<'all' | 'outbound' | 'inbound'>('all');
  const usage = useCallUsage(period, source);
  const report = usage.report;
  const series = report?.series || [];
  const total = series.reduce((sum, row) => sum + row.call_count, 0);
  const completed = series.reduce((sum, row) => sum + row.completed, 0);
  const failed = series.reduce((sum, row) => sum + row.failed, 0);
  const other = series.reduce((sum, row) => sum + row.other, 0);
  const seconds = series.reduce((sum, row) => sum + row.duration_seconds, 0);
  const durationCount = series.reduce((sum, row) => sum + row.duration_count, 0);
  const range = report ? `${dayValue(report.window.start_at)} – ${dayValue(report.window.end_at)}` : period === 'month' ? 'เดือนนี้จนถึงปัจจุบัน' : '7 วันรวมวันนี้';
  const typeLabel = source === 'all' ? 'สายโทรเข้าและโทรออก' : source === 'outbound' ? 'เฉพาะสายโทรออก' : 'เฉพาะสายโทรเข้า';
  const minutes = (duration: number, known: number) => known ? numberValue(duration / 60) : '—';

  return <div className="analytics-page"><AppHeader /><main className="analytics-main page-shell real-data-page">
    <header><span className="ui-kicker">CALL USAGE</span><h1>การใช้งาน Voice Bot</h1><p>นับจากประวัติสายโทรศัพท์จริงของบัญชี Voice Bot ที่เชื่อมอยู่</p><p className="workspace-note">รวมสายที่โทรจากแคมเปญ สายโทรทดสอบ และสายที่โทรผ่าน Voice Bot โดยตรง · ดูคำตอบของผู้ติดต่อได้ที่ <a href={routes.dashboard}>ภาพรวมการโทร →</a></p></header>
    <section className="activity-section">
      <div className="usage-toolbar"><div className="usage-controls">
        <label>ช่วงเวลา<select value={period} onChange={event => setPeriod(event.target.value as typeof period)}><option value="month">เดือนนี้</option><option value="7-days">7 วันรวมวันนี้</option></select></label>
        <label>ประเภทสาย<select value={source} onChange={event => setSource(event.target.value as typeof source)}><option value="all">โทรเข้าและโทรออก</option><option value="outbound">เฉพาะสายโทรออก</option><option value="inbound">เฉพาะสายโทรเข้า</option></select></label>
      </div><Button size="compact" variant="secondary" onClick={usage.refetch} disabled={usage.loading}>รีเฟรชประวัติสาย</Button></div>
      <h2>สรุปการโทรในช่วงที่เลือก</h2><p className="workspace-note">{range} · {typeLabel} · เขตเวลาไทย</p>
      {usage.loading ? <p role="status">กำลังโหลดประวัติสายจริง…</p> : usage.error ? <p role="alert" className="workspace-alert">{usage.error}</p> : report && <>
        <div className="metric-grid"><MetricCard label="สายทั้งหมด" value={numberValue(total)} description="นับ Call ID ไม่ซ้ำ รวมการโทรซ้ำแต่ละครั้ง" /><MetricCard label="จบสาย" value={numberValue(completed)} description="สถานะ completed จากประวัติสาย" tone="success" /><MetricCard label="โทรไม่สำเร็จ / ยกเลิก" value={numberValue(failed)} description="รวมไม่รับสาย สายไม่ว่าง และสายที่ล้มเหลว" tone="danger" /><MetricCard label="เวลาโทรที่มีข้อมูล" value={minutes(seconds, durationCount)} description={`นาที · มีระยะเวลา ${numberValue(durationCount)} จาก ${numberValue(total)} สาย`} /></div>
        <p className="workspace-note">กำลังโทร / สถานะอื่น {numberValue(other)} สาย · จบสาย + โทรไม่สำเร็จ / ยกเลิก + สถานะอื่น = {numberValue(total)} สาย</p>
        <p className="workspace-note">ดึงประวัติครบทุกหน้าที่บริการส่งกลับ · อัปเดต {new Date(report.checked_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })}</p>
      </>}
    </section>
    <section className="activity-section"><h2>ประวัติสายรายวัน</h2><p className="workspace-note">ใช้ Call ID ชุดเดียวกับสรุปด้านบน · {range}</p>
      {usage.loading ? <p role="status">กำลังโหลดรายวัน…</p> : usage.error ? <p className="workspace-note">ยังสรุปรายวันไม่ได้ กรุณารีเฟรชประวัติสาย</p> : !series.length ? <p>ไม่พบสายโทรศัพท์ในประวัติที่บริการส่งกลับสำหรับช่วงเวลาและประเภทที่เลือก</p> : <div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>วันที่โทร</th><th>ทั้งหมด</th><th>จบสาย</th><th>ไม่สำเร็จ / ยกเลิก</th><th>สถานะอื่น</th><th>เวลาโทร (นาที)</th></tr></thead><tbody>{series.map(row => <tr key={row.date}><td>{dayValue(row.date)}</td><td>{numberValue(row.call_count)}</td><td>{numberValue(row.completed)}</td><td>{numberValue(row.failed)}</td><td>{numberValue(row.other)}</td><td>{minutes(row.duration_seconds, row.duration_count)}<small className="result-date">มีเวลา {row.duration_count}/{row.call_count} สาย</small></td></tr>)}</tbody><tfoot><tr><th scope="row">รวมในช่วงที่เลือก</th><td><strong>{numberValue(total)}</strong></td><td>{numberValue(completed)}</td><td>{numberValue(failed)}</td><td>{numberValue(other)}</td><td>{minutes(seconds, durationCount)}</td></tr></tfoot></table></div>}
    </section><p className="workspace-note">แหล่งข้อมูล: ประวัติสายโทรศัพท์ของบัญชี Voice Bot · จัดวันตามเวลาเริ่มโทรในประเทศไทย · นับเฉพาะสายที่บริการส่งกลับ ไม่รวมคำขอที่ยังไม่มีรหัสสาย หรือการคุยผ่านไมโครโฟนในเบราว์เซอร์ · ระยะเวลาที่บริการไม่ส่งกลับจะแสดงว่าไม่มีข้อมูล</p>
  </main></div>;
}
