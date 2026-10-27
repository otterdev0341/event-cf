import { useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { SmoothSelect } from '../components/ui/smooth-select';
import { InboundKnowledge } from '../components/InboundKnowledge';
import { GeneralEventSetup } from '../components/GeneralEventSetup';
import { useIsDev } from '../components/WorkspaceGate';
import { AgentRecordings } from '../components/AgentRecordings';
import { useAgents, useAgentDetail } from '../hooks/useBotnoiData';
import { bindInboundNumber, getInboundSetup, getInboundHistory } from '../services/botnoi/inbound';
import type { InboundSetup, InboundHistory } from '../services/botnoi/inbound';
import { routes } from '../routes';
import '../inbound.css';

const dateText = (date: string | null) => date && Number.isFinite(Date.parse(date))
  ? new Date(date).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : 'ไม่ระบุ';
const callStatus = (status: string | null) => ({ completed: 'จบสาย', failed: 'ไม่สำเร็จ', ringing: 'กำลังเรียก', answered: 'รับสายแล้ว', 'in-progress': 'กำลังสนทนา', 'no-answer': 'ไม่ได้รับสาย', busy: 'สายไม่ว่าง', canceled: 'ยกเลิก', cancelled: 'ยกเลิก' }[status || ''] || status || 'ไม่ระบุ');

export function InboundPage() {
  const isDev = useIsDev();
  const agents = useAgents();
  const [setup, setSetup] = useState<InboundSetup | null>(null);
  const [history, setHistory] = useState<InboundHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [revision, setRevision] = useState(0);
  const [did, setDid] = useState('');
  const [agentId, setAgentId] = useState('');
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [mustRefresh, setMustRefresh] = useState(false);
  const [lookupCallId, setLookupCallId] = useState('');
  const agent = useAgentDetail(agentId || undefined);
  const selected = setup?.numbers.find(item => item.did === did);
  const agentName = (id: string | null) => !id ? 'ยังไม่เลือก Agent' : agents.agents.find(item => item.agent_id === id)?.name || id;

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]);
    setLoading(true); setHistoryLoading(true); setError(''); setHistoryError(''); setSetup(null); setHistory(null);
    setReview(false); setConfirmed(false); setDid(''); setAgentId(''); setMessage(''); setMustRefresh(false);
    void getInboundSetup(signal).then(result => { if (!controller.signal.aborted) {
      setSetup(result); setDid(result.numbers[0]?.did || ''); setAgentId(result.numbers[0]?.agent_id || '');
    } }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'โหลดระบบสายออกไม่ได้'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    void getInboundHistory(signal).then(result => { if (!controller.signal.aborted) setHistory(result); })
      .catch(err => { if (!controller.signal.aborted) setHistoryError(err instanceof Error ? err.message : 'โหลดประวัติสายออกไม่ได้'); })
      .finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [revision]);

  const refresh = () => { if (busy) return; agents.refetch(); setRevision(value => value + 1); };
  const changeNumber = (value: string) => {
    setDid(value); setAgentId(setup?.numbers.find(item => item.did === value)?.agent_id || '');
    setReview(false); setConfirmed(false); setMessage('');
  };
  const canSave = Boolean(setup?.can_manage && selected && agentId && agents.agents.some(item => item.agent_id === agentId) && agentId !== selected.agent_id && !mustRefresh && !loading && !busy && !agents.loading && !agents.error && !agent.loading && !agent.error);
  async function save() {
    if (!canSave || !confirmed || !review || !setup || !selected) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await bindInboundNumber(setup, selected, agentId);
      setSetup(result); setReview(false); setConfirmed(false);
      setMessage(`บันทึกแล้ว: ${selected.did} ใช้ ${agentName(agentId)} โทรออก กรุณาทดสอบโทรออกจากเบอร์นี้เพื่อตรวจการโทรจริง`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ'); setMustRefresh(true); setReview(false); setConfirmed(false);
    } finally { setBusy(false); }
  }
  const stateLabel = !setup ? (error ? 'ยังตรวจข้อมูลไม่ได้' : 'รอข้อมูล') : setup.paused ? 'ระบบโทรศัพท์พักอยู่' : setup.readiness === true ? 'บริการแจ้งว่าพร้อม' : setup.readiness === false ? 'ต้องตั้งค่าเพิ่มเติม' : 'ยังไม่ยืนยันความพร้อม';

  return <div className="inbound-page"><AppHeader activeNav="inbound" /><main className="analytics-main page-shell real-data-page inbound-main">
    <header className="rd-head"><div><span className="ui-kicker">OUTBOUND CALLS</span><h1>สายออก</h1><p>เลือกบอทโทรออกประจำเบอร์ และติดตามการโทรออกของบัญชีคุณ</p></div><div className="rd-head__actions"><Button variant="secondary" onClick={refresh} disabled={busy || loading || historyLoading}>รีเฟรชข้อมูล</Button></div></header>
    {error && <div className="workspace-alert" role="alert">{error} <a href={routes.settings}>ตรวจบัญชีที่เชื่อม →</a></div>}
    {message && <p className="workspace-notice" role="status">{message}</p>}
    <section className="rd-card rd-pad rd-stack inbound-routing" aria-busy={loading}>
      <div className="rd-filters" style={{justifyContent:'space-between'}}><div className="rd-panel-head"><h2>เบอร์โทรออกของคุณ</h2><span className="rd-muted">เมื่อโทรออกจากเบอร์นี้ Agent ที่ผูกไว้จะเป็นผู้สนทนา</span></div><span className={`rd-chip ${setup?.readiness === true && !setup.paused ? 'rd-chip--ok' : setup ? 'rd-chip--warn' : ''}`}>{stateLabel}</span></div>
      {loading ? <p role="status">กำลังอ่านเบอร์และระบบโทรศัพท์…</p> : setup && <>
        {setup.notice && <p className="workspace-notice">{setup.notice}</p>}
        {setup.numbers.length ? <div className="inbound-routing-grid">
          <div className="inbound-number-list" role="group" aria-label="เลือกเบอร์โทรออก">{setup.numbers.map(number => <button key={number.did} type="button" className={`inbound-number${did === number.did ? ' inbound-number--selected' : ''}`} aria-pressed={did === number.did} disabled={busy} onClick={() => changeNumber(number.did)}><span className="inbound-number__caption">เบอร์โทรออก</span><strong>{number.did}</strong><span>{agentName(number.agent_id)}</span><span className="inbound-number__arrow" aria-hidden="true">↗</span></button>)}</div>
          <div className="inbound-editor"><span className="ui-kicker">โทรออกด้วย</span><h3>{selected?.did}</h3><label htmlFor="inbound-agent">Agent ประจำเบอร์</label><SmoothSelect id="inbound-agent" value={agentId} disabled={busy || agents.loading || !setup.can_manage || mustRefresh} onChange={value => { setAgentId(value); setReview(false); setConfirmed(false); setMessage(''); }} options={[{ value: '', label: 'เลือก Agent' }, ...agents.agents.map(item => ({ value: item.agent_id, label: item.name })), ...(agentId && !agents.agents.some(item => item.agent_id === agentId) ? [{ value: agentId, label: `${agentId} (ไม่อยู่ในรายการที่โหลด)` }] : [])]} />
            {agents.error && <p className="workspace-alert" role="alert">{agents.error}</p>}
            <p className="workspace-note">ปัจจุบัน: {agentName(selected?.agent_id || null)}</p>
            {agent.loading && <p className="workspace-note" role="status">กำลังอ่านข้อมูล Agent…</p>}
            {agent.error && <p className="workspace-alert">อ่านรายละเอียด Agent ไม่ได้: {agent.error}</p>}
            {agent.variables.length > 0 && <div className="inbound-variable-note"><strong>ตรวจบทพูดก่อนใช้โทรออก</strong><p>บอทนี้มีตัวแปร {agent.variables.map(item => <code key={item}>{item}</code>)} สายออกไม่มีแถว CSV ของแคมเปญให้เติมอัตโนมัติ ควรให้บอทถามข้อมูลจากผู้โทร หรือกำหนดค่าฝั่ง Voice Bot ให้พร้อม</p></div>}
            {!setup.can_manage && <p className="workspace-note">บัญชีนี้ดูข้อมูลได้ แต่ไม่มีสิทธิ์เปลี่ยน Agent ประจำเบอร์</p>}
            {mustRefresh && <p className="workspace-note">รีเฟรชข้อมูลเพื่ออ่านการผูกเบอร์ล่าสุดก่อนบันทึกอีกครั้ง</p>}
            {!review ? <Button onClick={() => { setReview(true); setConfirmed(false); }} disabled={!canSave}>ตรวจและเชื่อม Agent</Button> : <div className="inbound-review"><h3>ยืนยันการโทรออก</h3><p><strong>{selected?.did}</strong> → <strong>{agentName(agentId)}</strong></p><p>เมื่อบันทึกแล้ว สายใหม่ที่โทรออกจากเบอร์นี้จะใช้ Agent ที่เลือก</p><label className="inbound-consent"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />ฉันตรวจเบอร์และ Agent โทรออกแล้ว</label><div className="draft-actions"><Button disabled={!confirmed || !canSave} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : 'บันทึก Agent โทรออก'}</Button><Button variant="secondary" disabled={busy} onClick={() => { setReview(false); setConfirmed(false); }}>ยกเลิก</Button></div></div>}
          </div>
        </div> : <div className="workspace-empty"><h3>{setup.configured ? 'บัญชีนี้ยังไม่มีเบอร์โทรออก' : 'ตั้งค่าระบบโทรศัพท์ก่อนโทรออก'}</h3><p>เพิ่มเบอร์โทรออกและเชื่อม PBX / SIP Trunk ใน Voice Bot แล้วกลับมากดรีเฟรชเพื่อเลือก Agent</p><Button href="https://voicebot-stg.botnoigroup.com/home" target="_blank" rel="noopener noreferrer" variant="secondary">เปิด Voice Bot ↗</Button></div>}
        <div className="inbound-connection-note"><span>สถานะ Trunk: <strong>{setup.trunk_state || 'บริการไม่ระบุ'}</strong></span><span>ตรวจล่าสุด {dateText(setup.checked_at)}</span><a href="https://voicebot-stg.botnoigroup.com/home" target="_blank" rel="noopener noreferrer">จัดการเบอร์และระบบโทรศัพท์ ↗</a></div>
      </>}
    </section>
    <div className="rd-banner"><div className="rd-banner__body"><span className="rd-banner__icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 4l-7 7M13 4v7h7M6 3H3v4c0 8 6 14 14 14h4v-3l-5-2-2 2c-4-1-7-4-8-8l2-2-2-5Z"/></svg></span><p><strong>หลังเชื่อม ลองโทรออกจากเบอร์ของคุณ</strong><small>ใช้โทรศัพท์อีกเครื่องรับสาย ฟังว่าบอทที่เลือกเป็นผู้ตอบ แล้วรีเฟรชประวัติด้านล่าง · ผลตอบรับของสายออกยังไม่รวมในผลแคมเปญโทรออก</small></p></div></div>
    <section className="rd-card rd-table-card"><div className="rd-table-card__head"><div className="rd-panel-head"><h2>ประวัติสายออกล่าสุด</h2><span className="rd-muted">สูงสุด 50 สายล่าสุดของบัญชีที่เชื่อม รวมทุกเบอร์ · เวลาไทย</span></div><a className="rd-link" href={`${routes.analytics}?source=inbound`}>ดูสถิติสายออก →</a></div>
      {historyLoading ? <p className="rd-empty" role="status">กำลังโหลดประวัติสายออก…</p> : historyError ? <p className="workspace-alert" role="alert" style={{margin:'0 20px 20px'}}>{historyError}</p> : history && <>{history.items.length ? <div className="rd-table-wrap" tabIndex={0} role="region" aria-label="ตารางประวัติสายออก เลื่อนแนวนอนได้"><table className="rd-table inbound-history"><thead><tr><th>ผู้รับ / เบอร์โทรออก</th><th>เวลาที่โทรออก</th><th>ระยะเวลา</th><th>โทรออกด้วย</th><th>สถานะ</th><th><span className="sr-only">ข้อมูลของผู้โทร</span></th></tr></thead><tbody>{history.items.map(call => <tr key={call.id}><td><strong>{call.number || 'ไม่ระบุ'}</strong><span className="rd-table__sub">→ {call.phone_number || 'ไม่ระบุ'}</span></td><td>{dateText(call.started_at)}<span className="rd-table__sub">{call.id}</span></td><td>{call.duration_seconds === null ? 'ไม่ระบุ' : `${Math.floor(call.duration_seconds / 60)}:${String(Math.floor(call.duration_seconds % 60)).padStart(2, '0')}`}</td><td style={{color:'var(--color-body)'}}>{call.agent_name || agentName(call.agent_id)}</td><td><span className={`rd-chip rd-chip--${call.status === 'completed' || call.status === 'answered' ? 'ok' : call.status === 'failed' || call.status === 'no-answer' ? 'bad' : call.status === 'busy' ? 'warn' : call.status === 'in-progress' || call.status === 'ringing' ? 'info' : ''}`}>{callStatus(call.status)}</span></td><td style={{textAlign:'right'}}><button type="button" className="rd-link" onClick={() => { setLookupCallId(call.id); document.getElementById('inbound-knowledge')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }}>ดูงานของผู้โทร</button></td></tr>)}</tbody></table></div> : <div className="rd-empty"><strong style={{display:'block',color:'var(--color-heading)',marginBottom:4}}>ยังไม่มีประวัติสายออก</strong>เมื่อ Voice Bot บันทึกสายออกแล้ว รายการจะปรากฏที่นี่หลังรีเฟรช</div>}<p className="rd-table-foot" style={{margin:0}}>{history.has_more ? 'ยังมีประวัติเก่ากว่านี้ ดูยอดรวมตามช่วงเวลาได้ที่สถิติสายออก · ' : ''}ตรวจล่าสุด {dateText(history.checked_at)} · สถานะจบสายไม่ได้แปลว่าผู้โทรตอบตกลง</p></>}
    </section>
    {isDev && agentId && <GeneralEventSetup agentId={agentId} onConnected={agent.refetch} />}
    <InboundKnowledge callId={lookupCallId} />
    {agentId && <AgentRecordings key={agentId} agentId={agentId} />}
  </main></div>;
}
