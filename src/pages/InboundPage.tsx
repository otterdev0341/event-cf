import { useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { useAgents, useAgentDetail } from '../hooks/useBotnoiData';
import { bindInboundNumber, getInboundSetup, getInboundHistory } from '../services/botnoi/inbound';
import type { InboundSetup, InboundHistory } from '../services/botnoi/inbound';
import { routes } from '../routes';
import '../inbound.css';

const dateText = (date: string | null) => date && Number.isFinite(Date.parse(date))
  ? new Date(date).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : 'ไม่ระบุ';
const callStatus = (status: string | null) => ({ completed: 'จบสาย', failed: 'ไม่สำเร็จ', ringing: 'กำลังเรียก', answered: 'รับสายแล้ว', 'in-progress': 'กำลังสนทนา', 'no-answer': 'ไม่ได้รับสาย', busy: 'สายไม่ว่าง', canceled: 'ยกเลิก', cancelled: 'ยกเลิก' }[status || ''] || status || 'ไม่ระบุ');

export function InboundPage() {
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
    } }).catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'โหลดระบบสายเข้าไม่ได้'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    void getInboundHistory(signal).then(result => { if (!controller.signal.aborted) setHistory(result); })
      .catch(err => { if (!controller.signal.aborted) setHistoryError(err instanceof Error ? err.message : 'โหลดประวัติสายเข้าไม่ได้'); })
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
      setMessage(`บันทึกแล้ว: ${selected.did} ใช้ ${agentName(agentId)} รับสาย กรุณาโทรเข้าเบอร์นี้เพื่อตรวจการรับสายจริง`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ'); setMustRefresh(true); setReview(false); setConfirmed(false);
    } finally { setBusy(false); }
  }
  const stateLabel = !setup ? (error ? 'ยังตรวจข้อมูลไม่ได้' : 'รอข้อมูล') : setup.paused ? 'ระบบโทรศัพท์พักอยู่' : setup.readiness === true ? 'บริการแจ้งว่าพร้อม' : setup.readiness === false ? 'ต้องตั้งค่าเพิ่มเติม' : 'ยังไม่ยืนยันความพร้อม';

  return <div className="inbound-page"><AppHeader activeNav="inbound" /><main className="analytics-main page-shell real-data-page inbound-main">
    <header className="inbound-heading"><div><span className="ui-kicker">INBOUND CALLS</span><h1>สายเข้า</h1><p>เลือกบอทรับสายประจำเบอร์ และติดตามการโทรเข้าของบัญชีคุณ</p></div><Button variant="secondary" size="compact" onClick={refresh} disabled={busy || loading || historyLoading}>รีเฟรชข้อมูล</Button></header>
    {error && <div className="workspace-alert" role="alert">{error} <a href={routes.settings}>ตรวจบัญชีที่เชื่อม →</a></div>}
    {message && <p className="workspace-notice" role="status">{message}</p>}
    <section className="activity-section inbound-routing" aria-busy={loading}>
      <div className="inbound-section-heading"><div><h2>เบอร์รับสายของคุณ</h2><p className="workspace-note">คนโทรเข้าเบอร์นี้ แล้ว Agent ที่ผูกไว้จะเป็นผู้รับสาย</p></div><span className={`inbound-status${setup?.readiness === true && !setup.paused ? ' inbound-status--ready' : ''}`}><i />{stateLabel}</span></div>
      {loading ? <p role="status">กำลังอ่านเบอร์และระบบโทรศัพท์…</p> : setup && <>
        {setup.notice && <p className="workspace-notice">{setup.notice}</p>}
        {setup.numbers.length ? <div className="inbound-routing-grid">
          <div className="inbound-number-list" role="group" aria-label="เลือกเบอร์รับสาย">{setup.numbers.map(number => <button key={number.did} type="button" className={`inbound-number${did === number.did ? ' inbound-number--selected' : ''}`} aria-pressed={did === number.did} disabled={busy} onClick={() => changeNumber(number.did)}><span className="inbound-number__caption">เบอร์รับสายเข้า</span><strong>{number.did}</strong><span>{agentName(number.agent_id)}</span><span className="inbound-number__arrow" aria-hidden="true">↗</span></button>)}</div>
          <div className="inbound-editor"><span className="ui-kicker">รับสายด้วย</span><h3>{selected?.did}</h3><label htmlFor="inbound-agent">Agent ประจำเบอร์</label><select id="inbound-agent" value={agentId} disabled={busy || agents.loading || !setup.can_manage || mustRefresh} onChange={event => { setAgentId(event.target.value); setReview(false); setConfirmed(false); setMessage(''); }}><option value="">เลือก Agent</option>{agents.agents.map(item => <option key={item.agent_id} value={item.agent_id}>{item.name}</option>)}{agentId && !agents.agents.some(item => item.agent_id === agentId) && <option value={agentId}>{agentId} (ไม่อยู่ในรายการที่โหลด)</option>}</select>
            {agents.error && <p className="workspace-alert" role="alert">{agents.error}</p>}
            <p className="workspace-note">ปัจจุบัน: {agentName(selected?.agent_id || null)}</p>
            {agent.loading && <p className="workspace-note" role="status">กำลังอ่านข้อมูล Agent…</p>}
            {agent.error && <p className="workspace-alert">อ่านรายละเอียด Agent ไม่ได้: {agent.error}</p>}
            {agent.variables.length > 0 && <div className="inbound-variable-note"><strong>ตรวจบทพูดก่อนใช้รับสายเข้า</strong><p>บอทนี้มีตัวแปร {agent.variables.map(item => <code key={item}>{item}</code>)} สายเข้าไม่มีแถว CSV ของแคมเปญให้เติมอัตโนมัติ ควรให้บอทถามข้อมูลจากผู้โทร หรือกำหนดค่าฝั่ง Voice Bot ให้พร้อม</p></div>}
            {!setup.can_manage && <p className="workspace-note">บัญชีนี้ดูข้อมูลได้ แต่ไม่มีสิทธิ์เปลี่ยน Agent ประจำเบอร์</p>}
            {mustRefresh && <p className="workspace-note">รีเฟรชข้อมูลเพื่ออ่านการผูกเบอร์ล่าสุดก่อนบันทึกอีกครั้ง</p>}
            {!review ? <Button onClick={() => { setReview(true); setConfirmed(false); }} disabled={!canSave}>ตรวจและเชื่อม Agent</Button> : <div className="inbound-review"><h3>ยืนยันการรับสาย</h3><p><strong>{selected?.did}</strong> → <strong>{agentName(agentId)}</strong></p><p>เมื่อบันทึกแล้ว สายใหม่ที่โทรเข้าเบอร์นี้จะใช้ Agent ที่เลือก</p><label className="inbound-consent"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />ฉันตรวจเบอร์และ Agent รับสายแล้ว</label><div className="draft-actions"><Button disabled={!confirmed || !canSave} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : 'บันทึก Agent รับสาย'}</Button><Button variant="secondary" disabled={busy} onClick={() => { setReview(false); setConfirmed(false); }}>ยกเลิก</Button></div></div>}
          </div>
        </div> : <div className="workspace-empty"><h3>{setup.configured ? 'บัญชีนี้ยังไม่มีเบอร์รับสาย' : 'ตั้งค่าระบบโทรศัพท์ก่อนรับสาย'}</h3><p>เพิ่มเบอร์รับสายและเชื่อม PBX / SIP Trunk ใน Voice Bot แล้วกลับมากดรีเฟรชเพื่อเลือก Agent</p><Button href="https://voicebot-stg.botnoigroup.com/home" target="_blank" rel="noopener noreferrer" variant="secondary">เปิด Voice Bot ↗</Button></div>}
        <div className="inbound-connection-note"><span>สถานะ Trunk: <strong>{setup.trunk_state || 'บริการไม่ระบุ'}</strong></span><span>ตรวจล่าสุด {dateText(setup.checked_at)}</span><a href="https://voicebot-stg.botnoigroup.com/home" target="_blank" rel="noopener noreferrer">จัดการเบอร์และระบบโทรศัพท์ ↗</a></div>
      </>}
    </section>
    <section className="inbound-guide"><span className="inbound-guide__icon" aria-hidden="true">↙</span><div><h2>หลังเชื่อม ลองโทรเข้าเบอร์ของคุณ</h2><p>ใช้โทรศัพท์อีกเครื่องโทรเข้า ฟังว่าบอทที่เลือกเป็นผู้ตอบ แล้วรีเฟรชประวัติด้านล่าง การผูกเบอร์สำเร็จยังต้องตรวจด้วยสายจริง</p><p className="workspace-note">หน้านี้แสดงสถานะและประวัติสายเข้า ผลตอบรับและข้อความบทสนทนาของสายเข้ายังไม่รวมในผลแคมเปญโทรออก</p></div></section>
    <section className="activity-section"><div className="inbound-section-heading"><div><h2>ประวัติสายเข้าล่าสุด</h2><p className="workspace-note">สูงสุด 50 สายล่าสุดของบัญชีที่เชื่อม รวมทุกเบอร์ · เวลาไทย</p></div><Button href={`${routes.analytics}?source=inbound`} size="compact" variant="secondary">ดูสถิติสายเข้า →</Button></div>
      {historyLoading ? <p role="status">กำลังโหลดประวัติสายเข้า…</p> : historyError ? <p className="workspace-alert" role="alert">{historyError}</p> : history && <>{history.items.length ? <div className="activity-table-wrap" tabIndex={0} role="region" aria-label="ตารางประวัติสายเข้า เลื่อนแนวนอนได้"><table className="activity-table inbound-history"><thead><tr><th>เวลาที่โทรเข้า</th><th>ผู้โทร / เบอร์รับสาย</th><th>Agent</th><th>สถานะ</th><th>ระยะเวลา</th></tr></thead><tbody>{history.items.map(call => <tr key={call.id}><td>{dateText(call.started_at)}<small className="inbound-call-id">{call.id}</small></td><td>{call.number || 'ไม่ระบุ'}<small className="inbound-call-id">เข้าเบอร์ {call.phone_number || 'ไม่ระบุ'}</small></td><td>{call.agent_name || agentName(call.agent_id)}</td><td><span className="inbound-call-status">{callStatus(call.status)}</span></td><td>{call.duration_seconds === null ? 'ไม่ระบุ' : `${Math.floor(call.duration_seconds / 60)}:${String(Math.floor(call.duration_seconds % 60)).padStart(2, '0')} นาที`}</td></tr>)}</tbody></table></div> : <div className="workspace-empty"><h3>ยังไม่มีประวัติสายเข้า</h3><p>เมื่อ Voice Bot บันทึกสายเข้าแล้ว รายการจะปรากฏที่นี่หลังรีเฟรช</p></div>}<p className="workspace-note">{history.has_more ? 'ยังมีประวัติเก่ากว่านี้ ดูยอดรวมตามช่วงเวลาได้ที่สถิติสายเข้า · ' : ''}ตรวจล่าสุด {dateText(history.checked_at)} · สถานะจบสายไม่ได้แปลว่าผู้โทรตอบตกลง</p></>}
    </section>
  </main></div>;
}
