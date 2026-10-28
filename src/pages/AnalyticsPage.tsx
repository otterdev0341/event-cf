import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { SmoothSelect } from '../components/ui/smooth-select';
import { useCallUsage } from '../hooks/useBotnoiData';
import { routes } from '../routes';

const numberValue = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 1 });
const dayValue = (value: string) => new Date(value).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });

export function AnalyticsPage() {
  const [period, setPeriod] = useState<'7-days' | 'month'>('month');
  // The workspace only places outbound confirmation calls.
  const usage = useCallUsage(period, 'outbound');
  const report = usage.report;
  const series = report?.series || [];
  const total = series.reduce((sum, row) => sum + row.call_count, 0);
  const completed = series.reduce((sum, row) => sum + row.completed, 0);
  const failed = series.reduce((sum, row) => sum + row.failed, 0);
  const other = series.reduce((sum, row) => sum + row.other, 0);
  const seconds = series.reduce((sum, row) => sum + row.duration_seconds, 0);
  const durationCount = series.reduce((sum, row) => sum + row.duration_count, 0);
  const range = report ? `${dayValue(report.window.start_at)} – ${dayValue(report.window.end_at)}` : period === 'month' ? 'เดือนนี้จนถึงปัจจุบัน' : '7 วันรวมวันนี้';
  const minutes = (duration: number, known: number) => known ? numberValue(duration / 60) : '—';

  const peak = Math.max(1, ...series.map(row => row.call_count));
  const share = (n: number) => total ? `${Math.round(n / total * 100)}% ของสายทั้งหมด` : '—';
  return <div className="analytics-page"><AppHeader /><main className="analytics-main page-shell real-data-page">
    <header className="rd-head"><div><span className="ui-kicker">CALL USAGE</span><h1>การใช้งาน Voice Bot</h1><p>นับจากประวัติสายโทรศัพท์จริงของบัญชี Voice Bot ที่เชื่อมอยู่ รวมสายจากแคมเปญ สายโทรทดสอบ และสายที่โทรผ่าน Voice Bot โดยตรง</p></div><div className="rd-head__actions"><a className="rd-link" href={routes.dashboard}>ภาพรวมการโทร →</a><Button variant="secondary" onClick={usage.refetch} disabled={usage.loading}>รีเฟรชประวัติสาย</Button></div></header>
    <div className="rd-filters">
      <SmoothSelect aria-label="ช่วงเวลา" value={period} onChange={setPeriod} options={[{ value: 'month', label: 'เดือนนี้' }, { value: '7-days', label: '7 วันรวมวันนี้' }]} />
      <span className="rd-muted">{range} · สายโทรออก · เขตเวลาไทย</span>
    </div>
    {usage.loading ? <p className="rd-card rd-empty" role="status">กำลังโหลดประวัติสายจริง…</p> : usage.error ? <p role="alert" className="workspace-alert">{usage.error}</p> : report && <>
      <section className="rd-stats" aria-label="สรุปการโทรในช่วงที่เลือก">
        <article className="rd-card rd-stat"><p className="rd-stat__label">สายทั้งหมด</p><p className="rd-stat__value">{numberValue(total)}</p><p className="rd-stat__note">รวมในช่วงที่เลือก · นับ Call ID ไม่ซ้ำ</p></article>
        <article className="rd-card rd-stat"><p className="rd-stat__label">จบสาย</p><p className="rd-stat__value">{numberValue(completed)}</p><p className="rd-stat__note">{share(completed)}</p></article>
        <article className="rd-card rd-stat"><p className="rd-stat__label">โทรไม่สำเร็จ / ยกเลิก</p><p className="rd-stat__value">{numberValue(failed)}</p><p className="rd-stat__note">{share(failed)} · รวมไม่รับสาย สายไม่ว่าง</p></article>
        <article className="rd-card rd-stat"><p className="rd-stat__label">เวลาโทรที่มีข้อมูล</p><p className="rd-stat__value">{minutes(seconds, durationCount)} <span style={{fontSize:16,color:'var(--color-muted)'}}>นาที</span></p><p className="rd-stat__note">มีระยะเวลา {numberValue(durationCount)} จาก {numberValue(total)} สาย</p></article>
      </section>
      {series.length > 0 && <section className="rd-card rd-pad rd-stack" aria-labelledby="daily-chart-title">
        <div className="rd-filters" style={{justifyContent:'space-between'}}><h2 id="daily-chart-title" className="rd-section-title" style={{fontSize:16}}>ประวัติสายรายวัน</h2><ul className="rd-legend"><li><i style={{background:'#7151df'}}/>จบสาย</li><li><i style={{background:'#ffc300'}}/>ไม่สำเร็จ / ยกเลิก</li><li><i style={{background:'#d4d4d8'}}/>สถานะอื่น</li></ul></div>
        <div className="rd-chart" role="img" aria-label={`จำนวนสายรายวัน ${series.map(row => `${dayValue(row.date)} ${row.call_count} สาย`).join(', ')}`}>
          {series.map(row => <div key={row.date} className="rd-chart__col" title={`${dayValue(row.date)} · ${row.call_count} สาย`}>
            <span className="rd-chart__value">{row.call_count || ''}</span>
            <div className="rd-chart__bar" style={{height:`${row.call_count / peak * 86}%`}}><span style={{flex:row.other,background:'#d4d4d8'}}/><span style={{flex:row.failed,background:'#ffc300'}}/><span style={{flex:row.completed,background:'#7151df'}}/></div>
            <span className="rd-chart__label">{new Date(row.date).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short' })}</span>
          </div>)}
        </div>
      </section>}
    </>}
    <section className="rd-card rd-table-card"><div className="rd-table-card__head"><div className="rd-panel-head"><h2>ตารางรายวัน</h2><span className="rd-muted">ใช้ Call ID ชุดเดียวกับสรุปด้านบน · {range}</span></div></div>
      {usage.loading ? <p className="rd-empty" role="status">กำลังโหลดรายวัน…</p> : usage.error ? <p className="rd-empty">ยังสรุปรายวันไม่ได้ กรุณารีเฟรชประวัติสาย</p> : !series.length ? <p className="rd-empty">ไม่พบสายโทรศัพท์ในประวัติที่บริการส่งกลับสำหรับช่วงเวลาและประเภทที่เลือก</p> : <div className="rd-table-wrap"><table className="rd-table rd-table--num"><thead><tr><th>วันที่โทร</th><th>ทั้งหมด</th><th>จบสาย</th><th>ไม่สำเร็จ / ยกเลิก</th><th>สถานะอื่น</th><th>เวลาโทร (นาที)</th></tr></thead><tbody>{series.map(row => <tr key={row.date}><td>{dayValue(row.date)}</td><td><strong>{numberValue(row.call_count)}</strong></td><td>{numberValue(row.completed)}</td><td>{numberValue(row.failed)}</td><td>{numberValue(row.other)}</td><td>{minutes(row.duration_seconds, row.duration_count)}<span className="rd-table__sub">มีเวลา {row.duration_count}/{row.call_count} สาย</span></td></tr>)}</tbody><tfoot><tr><th scope="row">รวมในช่วงที่เลือก</th><td><strong>{numberValue(total)}</strong></td><td>{numberValue(completed)}</td><td>{numberValue(failed)}</td><td>{numberValue(other)}</td><td>{minutes(seconds, durationCount)}</td></tr></tfoot></table></div>}
      {report && <p className="rd-table-foot" style={{margin:0}}>ดึงประวัติครบทุกหน้าที่บริการส่งกลับ · อัปเดต {new Date(report.checked_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })}</p>}
    </section>
    <p className="rd-stat__note">แหล่งข้อมูล: ประวัติสายโทรศัพท์ของบัญชี Voice Bot · จัดวันตามเวลาเริ่มโทรในประเทศไทย · นับเฉพาะสายที่บริการส่งกลับ ไม่รวมคำขอที่ยังไม่มีรหัสสาย หรือการคุยผ่านไมโครโฟนในเบราว์เซอร์ · ระยะเวลาที่บริการไม่ส่งกลับจะแสดงว่าไม่มีข้อมูล</p>
  </main></div>;
}
