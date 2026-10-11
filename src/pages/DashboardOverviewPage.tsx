import { useEffect, useMemo, useState } from "react";
import { ActivityTable, type ActivityItem } from "../components/ActivityTable";
import { AppHeader } from "../components/AppHeader";
import { MetricCard } from "../components/MetricCard";
import { Button } from "../components/Button";
import { VOICE_AGENTS } from "../config/voiceAgent";
import { botnoiApi } from "../services/botnoi";
import type { DashboardOverviewResponse, CallLogPlatformItem } from "../services/botnoi";

const PAGE_SIZE = 10;
const LOG_LIMIT = 100;
const numberOrNull = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const displayNumber = (value: number | null) => value === null ? '—' : value.toLocaleString('th-TH');
const displayDate = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : 'ไม่ระบุเวลา';

export function DashboardOverviewPage() {
  const [agentId, setAgentId] = useState(VOICE_AGENTS.wedding.id);
  const [days, setDays] = useState(7);
  return <div className="dashboard-page"><AppHeader /><main className="dashboard-main page-shell">
    <header className="dashboard-title"><h1>รายงาน <span>{Object.values(VOICE_AGENTS).find(agent => agent.id === agentId)?.name || agentId}</span></h1><p>ข้อมูลเซสชันจาก Voice Bot แยกตาม Agent และช่วงเวลา</p></header>
    <section className="report-filters" aria-label="ตัวกรองรายงาน">
      <label>Voice Agent<select className="workspace-select" value={agentId} onChange={event => setAgentId(event.target.value)}>{Object.values(VOICE_AGENTS).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <label>ช่วงเวลา<select className="workspace-select" value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>7 วันที่ผ่านมา</option><option value={30}>30 วันที่ผ่านมา</option></select></label>
    </section>
    <DashboardReport key={`${agentId}-${days}`} agentId={agentId} days={days} />
  </main></div>;
}

function DashboardReport({ agentId, days }: { agentId: string; days: number }) {
  const [overview, setOverview] = useState<DashboardOverviewResponse | null>(null);
  const [logs, setLogs] = useState<CallLogPlatformItem[]>([]);
  const [overviewError, setOverviewError] = useState('');
  const [logsError, setLogsError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [updatedAt, setUpdatedAt] = useState('');
  const [range, setRange] = useState({ start: '', end: '' });
  const [page, setPage] = useState(1);
  const [loadedCount, setLoadedCount] = useState(0);
  useEffect(() => {
    let active = true;
    const end = new Date();
    const start = new Date(end.getTime() - days * 86400000);
    setLoading(true); setOverview(null); setLogs([]); setOverviewError(''); setLogsError(''); setUpdatedAt(''); setPage(1);
    setRange({ start: start.toISOString(), end: end.toISOString() });
    void Promise.allSettled([
      botnoiApi.getDashboardOverview({ startAt: start.toISOString(), endAt: end.toISOString(), agentId, granularity: 'day', timezone: 'Asia/Bangkok' }),
      botnoiApi.listCallLogsPlatform(agentId, LOG_LIMIT),
    ]).then(([summaryResult, logsResult]) => {
      if (!active) return;
      if (summaryResult.status === 'fulfilled' && numberOrNull(summaryResult.value?.summary?.total_calls) !== null) setOverview(summaryResult.value);
      else setOverviewError('โหลดตัวเลขสรุปไม่ได้ กรุณาลองรีเฟรชอีกครั้ง');
      if (logsResult.status === 'fulfilled' && Array.isArray(logsResult.value?.items)) {
        setLoadedCount(logsResult.value.items.length);
        const unique = new Map<string, CallLogPlatformItem>();
        for (const log of logsResult.value.items) {
          const time = Date.parse(log.started_at);
          if (log.agent_id === agentId && Number.isFinite(time) && time >= start.getTime() && time <= end.getTime()) unique.set(log.conversation_id, log);
        }
        setLogs([...unique.values()].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)));
      } else setLogsError('โหลดประวัติสนทนาไม่ได้ กรุณาลองรีเฟรชอีกครั้ง');
      setLoading(false); setUpdatedAt(new Date().toISOString());
    });
    return () => { active = false; };
  }, [agentId, days, revision]);
  const total = numberOrNull(overview?.summary?.total_calls);
  function sourceCount(key: string) {
    const entries = overview?.distributions?.source;
    if (!Array.isArray(entries)) return null;
    const item = entries.find(entry => entry.key === key);
    return item ? numberOrNull(item.count) : total === 0 ? 0 : null;
  }
  const duration = numberOrNull(overview?.summary?.avg_call_duration_seconds);
  const metrics = [
    { label: 'เซสชันทั้งหมด', value: displayNumber(total), description: 'เฉพาะ Agent และช่วงเวลาที่เลือก', tone: 'primary' as const },
    { label: 'โทรออก (Outbound)', value: displayNumber(sourceCount('outbound')), description: 'จำนวนที่รายงานส่วนกลางบันทึกแล้ว', tone: 'success' as const },
    { label: 'ทดลองสนทนา (Preview)', value: displayNumber(sourceCount('preview')), description: 'เซสชันทดลองผ่านระบบ Preview', tone: 'neutral' as const },
    { label: 'ระยะเวลาเฉลี่ย', value: duration === null ? '—' : `${duration.toLocaleString('th-TH', { maximumFractionDigits: 1 })} วินาที`, description: 'ค่าเฉลี่ยของเซสชันในรายงาน', tone: 'primary' as const },
  ];
  const outcomes = useMemo(() => {
    if (total === null || !Array.isArray(overview?.distributions?.outcome)) return null;
    const entries = overview.distributions.outcome;
    if (entries.some(entry => numberOrNull(entry.count) === null)) return null;
    const result = entries.map(entry => ({ key: entry.key, count: entry.count, label: entry.key === 'success' ? 'สำเร็จตามรายงาน' : entry.key === 'failed' ? 'ล้มเหลวตามรายงาน' : entry.key, color: entry.key === 'success' ? '#0db98a' : entry.key === 'failed' ? '#f04452' : '#8c84a6' }));
    const sum = result.reduce((value, entry) => value + entry.count, 0);
    if (sum > total) return null;
    if (sum < total) result.push({ key: 'unclassified', count: total - sum, label: 'ยังไม่ระบุผล', color: '#c5c7d4' });
    return result;
  }, [overview, total]);
  let angle = 0;
  const segments = outcomes?.filter(entry => entry.count > 0).map(entry => {
    const start = angle; angle += total ? entry.count / total * 360 : 0;
    return `${entry.color} ${start}deg ${angle}deg`;
  });
  const chartBackground = total && segments?.length ? `conic-gradient(${segments.join(', ')})` : '#e6e7ed';
  const activityItems: ActivityItem[] = logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(log => {
    const start = Date.parse(log.started_at);
    const end = Date.parse(log.ended_at);
    return { id: log.conversation_id, customer: log.display_name || 'ไม่ระบุชื่อ', campaign: log.bot_name || agentId, date: displayDate(log.started_at), status: 'ไม่ระบุผลตอบรับ', tone: 'neutral', duration: Number.isFinite(start) && Number.isFinite(end) && end >= start ? `${((end - start) / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 })} วินาที` : 'ไม่ระบุ' };
  });
  const pages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE));
  return <>
    <div className="report-update"><p>{range.start && `${displayDate(range.start)} – ${displayDate(range.end)} (เวลาไทย)`}<br />{loading ? 'กำลังโหลดข้อมูล…' : updatedAt ? `ดึงข้อมูลล่าสุด ${displayDate(updatedAt)}` : ''}</p><Button size="compact" variant="secondary" onClick={() => setRevision(value => value + 1)} disabled={loading}>{loading ? 'กำลังโหลด…' : 'รีเฟรชข้อมูล'}</Button></div>
    {overviewError && <p className="workspace-alert" role="alert">{overviewError}</p>}
    <section className="metric-grid" aria-label="ข้อมูลสรุปเซสชัน" aria-busy={loading}>{metrics.map(metric => <MetricCard key={metric.label} {...metric} />)}</section>
    <section className="dashboard-visuals" aria-label="ผลรายงาน">
      <article className="response-card report-response"><h2>ผลเซสชันที่รายงานบันทึกไว้</h2><div className="report-donut" role="img" aria-label={outcomes ? outcomes.map(entry => `${entry.label} ${entry.count}`).join(', ') || 'ไม่มีเซสชัน' : 'ไม่มีข้อมูลผลเซสชัน'} style={{ background: chartBackground }}><div><span>ทั้งหมด</span><strong>{displayNumber(total)}</strong><span>เซสชัน</span></div></div>
        {outcomes ? <ul className="response-legend">{outcomes.map(entry => <li key={entry.key}><span className="response-legend__dot" style={{ background: entry.color }} />{entry.label} ({entry.count.toLocaleString('th-TH')})</li>)}</ul> : <p className="workspace-note">{loading ? 'กำลังโหลดผลเซสชัน…' : 'ไม่มีข้อมูลผลเซสชันที่คำนวณกราฟได้'}</p>}
      </article>
      <div className="campaign-summary">
        <article className="agent-stream-card"><div><h2>สถานะโทรอัตโนมัติ</h2><p>ยังไม่มีข้อมูลสถานะแคมเปญสดจากบริการแคมเปญ</p></div></article>
        <article className="campaign-progress-card report-explanation"><header><h2>ผลยืนยันเข้าร่วมงาน</h2><span>ยังไม่มีข้อมูล</span></header><p>ข้อมูลที่ได้รับยังไม่มีผลยืนยันหรือปฏิเสธเข้าร่วมงาน จึงยังคำนวณอัตรายืนยันและความคืบหน้าแคมเปญไม่ได้</p><p className="workspace-note">รายงานส่วนกลางอาจยังไม่รวมสายล่าสุด ตรวจผลแต่ละสายได้ด้วย Call ID ในหน้าโทรทดสอบ</p></article>
      </div>
    </section>
    <section className="activity-section" aria-labelledby="recent-activity-title"><h2 id="recent-activity-title">ประวัติสนทนาที่บันทึกไว้</h2><p className="workspace-note">รายการที่บริการประวัติส่งกลับสำหรับ Agent และช่วงเวลานี้ ไม่มีข้อมูลผลตอบรับรายบุคคล</p>
      {logsError ? <p className="workspace-alert" role="alert">{logsError}</p> : loading ? <p role="status">กำลังโหลดประวัติ…</p> : activityItems.length ? <ActivityTable items={activityItems} customerLabel="ชื่อในบันทึก" campaignLabel="Agent" /> : <p className="workspace-note">ไม่พบประวัติสนทนาในข้อมูลที่ได้รับสำหรับช่วงเวลานี้</p>}
    </section>
    {!loading && !logsError && <nav className="pagination" aria-label="หน้าประวัติสนทนา"><p>{logs.length ? `แสดง ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, logs.length)} จาก ${logs.length} รายการที่โหลดในช่วงนี้` : '0 รายการในช่วงนี้'}{loadedCount >= LOG_LIMIT && ' · โหลดสูงสุด 100 รายการล่าสุด'}</p><div className="pagination__controls"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>ย้อนกลับ</button><span aria-live="polite">หน้า {page} / {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>ถัดไป</button></div></nav>}
  </>;
}
