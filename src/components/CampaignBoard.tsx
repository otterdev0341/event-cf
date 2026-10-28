import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { supabase } from '../lib/supabase';
import { nameColumn, type CampaignDraft } from '../lib/campaigns';
import { checkCampaignReady } from '../lib/campaign-calls';
import { botnoiApi } from '../services/botnoi';
import { botnoiFetch } from '../services/botnoi/client';
import { useAgentDetail } from '../hooks/useBotnoiData';
import { prepareCampaignRows } from '../../shared/campaign-inputs.mjs';
import { runCampaignQueue, planCampaignCalls, campaignRequestId, terminalCall, shownStatus, type CampaignAttempt } from '../../shared/campaign-queue.mjs';
import { effectiveOutcome, latestContactCalls, type Outcome } from '../../shared/call-results.mjs';
import { callResultDisplay } from '../../shared/call-display.mjs';
import { activeSchedule } from '../../shared/campaign-schedule.mjs';
import { routes, warnBeforeLeave } from '../routes';

// Kanban view of one campaign: one card per contact, placed by its latest call.
// Calls only start from the Start button; Stop ends the queue before the next contact.

type Attempt = CampaignAttempt & {
  destination?: string;
  response?: { review?: Outcome; callback?: { outcome: Outcome }; followup?: { outcome: Outcome; failure_reason?: string | null }; transcript?: { text: string } } | null;
};
type Live = { status: string; callId?: string };
type ColumnId = 'pending' | 'calling' | 'confirmed' | 'declined' | 'followup' | 'noresult';

const COLUMNS: { id: ColumnId; label: string; tone: string; review?: { call_result: string; needs_agent: boolean | null } }[] = [
  { id: 'pending', label: 'รอโทร', tone: '' },
  { id: 'calling', label: 'กำลังโทร', tone: 'info' },
  { id: 'confirmed', label: 'ตอบตกลง', tone: 'ok', review: { call_result: 'CONFIRMED', needs_agent: false } },
  { id: 'declined', label: 'ปฏิเสธ', tone: 'bad', review: { call_result: 'DECLINED', needs_agent: false } },
  { id: 'followup', label: 'ต้องติดตาม', tone: 'warn', review: { call_result: 'REQUEST_AGENT', needs_agent: true } },
  { id: 'noresult', label: 'ไม่สำเร็จ', tone: '', review: { call_result: 'UNDETERMINED', needs_agent: null } },
];
const STATUS_LABELS: Record<string, string> = { waiting: 'รอส่ง', submitting: 'กำลังส่งคำขอ', queued: 'เข้าคิวแล้ว', ringing: 'กำลังเรียกสาย', 'in-progress': 'กำลังสนทนา', completed: 'จบสาย', failed: 'โทรไม่สำเร็จ', busy: 'สายไม่ว่าง', 'no-answer': 'ไม่รับสาย', cancelled: 'ยกเลิก', canceled: 'ยกเลิก', unknown: 'รอตรวจสอบ' };
const PAGE = 30, LIST_PAGE = 50;
const VIEW_KEY = 'outbound-view';
const date = (v?: string) => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : '—';

function columnOf(attempt: Attempt | undefined, live: Live | undefined): ColumnId {
  const status = live?.status ?? attempt?.status;
  if (!status || status === 'waiting') return 'pending';
  if (!terminalCall(status)) return 'calling';
  if (!attempt || attempt.status !== status) return 'noresult';
  const key = callResultDisplay(attempt).key;
  if (key === 'CONFIRMED') return 'confirmed';
  if (key === 'DECLINED') return 'declined';
  if (key === 'REQUEST_AGENT' || key === 'CALLBACK_REQUESTED' || effectiveOutcome(attempt.response).needs_agent) return 'followup';
  return 'noresult';
}

async function fetchAttempts(campaignId: string) {
  if (!supabase) throw new Error('ยังเชื่อมต่อฐานข้อมูลไม่ได้');
  const all: Attempt[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('voice_call_requests').select('id,call_id,destination,status,created_at,metadata,response').eq('metadata->>campaign_id', campaignId).order('created_at').order('id').range(offset, offset + 499);
    if (error) throw new Error('อ่านประวัติการโทรไม่ได้ กรุณารีเฟรช');
    all.push(...data as Attempt[]);
    if (data.length < 500) return all;
  }
}

export function CampaignBoard({ campaign, title }: { campaign: CampaignDraft; title?: ReactNode }) {
  const detail = useAgentDetail(campaign.agentId);
  const prepared = prepareCampaignRows(campaign, detail.variables);
  const [items, setItems] = useState<Attempt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState<Record<number, Live>>({});
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  // Kept apart from action errors so a later successful poll can clear it without hiding a failed Start.
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<ColumnId | 'all'>('all');
  const [listLimit, setListLimit] = useState(LIST_PAGE);
  const [view, setView] = useState<'list' | 'board'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'list'; } catch { return 'list'; } });
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [dragRow, setDragRow] = useState<number | null>(null);
  const [overColumn, setOverColumn] = useState<ColumnId | null>(null);
  const [saving, setSaving] = useState(false);
  const stopped = useRef(false), mounted = useRef(true), busy = useRef(false);

  const reload = useCallback(async () => {
    try { const data = await fetchAttempts(campaign.id); if (mounted.current) { setItems(data); setLoaded(true); setLoadError(''); } }
    catch (e) { if (mounted.current) setLoadError((e as Error).message); }
  }, [campaign.id]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopped.current = true; }; }, []);
  useEffect(() => { setLoaded(false); setLive({}); setOpenRow(null); void reload(); }, [reload]);
  // Results arrive from the Agent after a call ends, so keep the board fresh while idle.
  useEffect(() => {
    if (running) return;
    const timer = window.setInterval(() => { if (!document.hidden) void reload(); }, 15000);
    return () => window.clearInterval(timer);
  }, [reload, running]);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    const unguard = warnBeforeLeave('กำลังโทรตามคิวอยู่ ถ้าออกจากหน้านี้ คิวจะหยุดส่งรายชื่อถัดไป ต้องการออกหรือไม่');
    return () => { window.removeEventListener('beforeunload', warn); unguard(); };
  }, [running]);

  const current = latestContactCalls(items, campaign.updatedAt, campaign.csv.rows.length) as Attempt[];
  const latestByRow = new Map(current.map(a => [a.metadata.contact_row!, a]));
  const versionMismatch = items.some(a => a.metadata.campaign_version !== campaign.updatedAt);
  const planned = planCampaignCalls(prepared.rows, items.filter(a => a.metadata.campaign_version === campaign.updatedAt), null, false);
  const ready = loaded && !!detail.agent && !detail.loading && !detail.error && !prepared.errors.length && !versionMismatch;
  const runnable = planned.filter(row => !row.errors.length).length;
  const finished = prepared.rows.length - planned.length;
  // Variable names from "…: name" mapping errors, so the alert can list them compactly.
  const staleVariables = prepared.errors.map(e => e.match(/:\s*(.+)$/)?.[1]).filter((v): v is string => !!v);
  const blocker = !loaded ? '' : versionMismatch ? 'มีคำขอจากเวอร์ชันก่อนหน้า' : prepared.errors.length ? 'ต้องจับคู่ข้อมูลใหม่ก่อน'
    : detail.loading ? 'กำลังตรวจ Agent…' : detail.error ? 'ตรวจ Agent ไม่ได้' : !navigator.locks ? 'เบราว์เซอร์ไม่รองรับ' : !runnable ? 'โทรครบทุกคนแล้ว' : '';

  const nameOf = (index: number) => {
    const row = campaign.csv.rows[index] || [];
    const col = nameColumn(campaign);
    return (col >= 0 && row[col]) || `แถว ${index + 1}`;
  };
  const cards = prepared.rows.map(row => {
    const attempt = latestByRow.get(row.index), state = live[row.index];
    return { row, attempt, state, column: columnOf(attempt, state), name: nameOf(row.index) };
  });
  // Second line under the status: the Agent's result once the call ended, otherwise where the call is now.
  const detailOf = (card: typeof cards[number]) => {
    const status = card.state?.status ?? card.attempt?.status;
    if (!status) return 'ยังไม่เคยโทร';
    const result = card.attempt && !card.state && terminalCall(card.attempt.status) ? callResultDisplay(card.attempt).label : null;
    return result || STATUS_LABELS[status] || status;
  };
  const needle = query.trim().toLowerCase();
  const visible = needle ? cards.filter(c => `${c.name} ${c.row.destination}`.toLowerCase().includes(needle)) : cards;

  async function start() {
    if (!ready || running || busy.current || !navigator.locks) return;
    busy.current = true; stopped.current = false; setConfirming(false); setRunning(true); setError(''); setMessage('กำลังตรวจคิวตั้งเวลา Agent และคู่สาย…');
    try {
      const schedule = await botnoiFetch<{ job: { status: string } | null }>(`/workspace/campaigns/${campaign.id}/schedule`);
      if (activeSchedule(schedule.job)) throw new Error('แคมเปญนี้มีคิวตั้งเวลาทำงานอยู่ ยกเลิกคิวตั้งเวลาในหน้าโทรตามรายชื่อก่อนเริ่มโทรเอง');
      await navigator.locks.request(`voice-campaign:${campaign.id}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('แคมเปญนี้กำลังโทรอยู่ในอีกแท็บ');
        const { account, checked } = await checkCampaignReady(campaign);
        const history = await fetchAttempts(campaign.id);
        if (history.some(a => a.metadata.campaign_version !== campaign.updatedAt)) throw new Error('แคมเปญนี้มีคำขอจากเวอร์ชันก่อนหน้า หากต้องการโทรชุดใหม่ให้สร้างแคมเปญใหม่');
        const chosen = planCampaignCalls(checked.rows, history, null, false);
        if (!chosen.length) throw new Error('ไม่มีรายชื่อที่รอโทรแล้ว');
        if (chosen.some(row => row.errors.length)) throw new Error('ข้อมูลของบางรายชื่อยังไม่ครบ กรุณาตรวจ CSV ในหน้าโทรตามรายชื่อ');
        const result = await runCampaignQueue({
          rows: chosen, attempts: history,
          shouldStop: () => stopped.current || !mounted.current,
          wait: ms => new Promise(resolve => window.setTimeout(resolve, ms)),
          submit: async row => botnoiApi.placeCall(account._id, row.destination, campaign.agentId, { requestId: await campaignRequestId(campaign.id, campaign.updatedAt!, row.index, row.redialOf), redialOf: row.redialOf, variables: {}, campaignId: campaign.id, contactRow: row.index, campaignBatch: true, campaignVersion: campaign.updatedAt }),
          readStatus: id => botnoiApi.getCallStatus(account._id, id),
          onUpdate: (index, status, _message, callId) => {
            if (!mounted.current) return;
            setLive(prev => ({ ...prev, [index]: { status, callId: callId || prev[index]?.callId } }));
            setMessage(`กำลังโทร ${nameOf(index)} · ${STATUS_LABELS[status] || status}`);
          },
        });
        if (mounted.current) setMessage(result === 'complete' ? `โทรครบ ${chosen.length} รายชื่อแล้ว ผลตอบรับจะเข้ามาเมื่อ Agent ส่งผล` : 'หยุดคิวแล้ว สายที่ส่งไปก่อนหน้ายังอาจกำลังสนทนาอยู่');
      });
    } catch (e) { if (mounted.current) { setError((e as Error).message); setMessage(''); } }
    finally { busy.current = false; if (mounted.current) { setRunning(false); setLive({}); void reload(); } }
  }

  function stop() { stopped.current = true; setMessage('กำลังหยุด… จะไม่ส่งรายชื่อถัดไป สายที่กำลังคุยอยู่จะไม่ถูกตัด'); }

  async function review(attempt: Attempt, target: ColumnId) {
    const column = COLUMNS.find(c => c.id === target);
    if (!column?.review || saving || running) return;
    setSaving(true); setError('');
    try {
      const updated = await botnoiFetch<Attempt>(`/workspace/calls/${attempt.id}/result`, { method: 'POST', body: { ...column.review, expected_review_at: attempt.response?.review?.updated_at || null } });
      setItems(old => old.map(a => a.id === updated.id ? updated : a));
      setMessage(`บันทึกผล “${column.label}” แล้ว`);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  const canMove = (card: typeof cards[number]) => !running && !saving && !!card.attempt && terminalCall(card.attempt.status) && !card.state;
  function onDrop(event: DragEvent, target: ColumnId) {
    event.preventDefault(); setOverColumn(null);
    const card = cards.find(c => c.row.index === dragRow); setDragRow(null);
    if (card && card.attempt && canMove(card) && card.column !== target) void review(card.attempt, target);
  }

  const openCard = openRow === null ? null : cards.find(c => c.row.index === openRow) || null;
  useEffect(() => {
    if (openRow === null) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenRow(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [openRow]);

  const total = cards.length;
  const counts = Object.fromEntries(COLUMNS.map(c => [c.id, cards.filter(x => x.column === c.id).length])) as Record<ColumnId, number>;
  const shown = filter === 'all' ? visible : visible.filter(c => c.column === filter);
  const fix = prepared.errors.length || versionMismatch ? routes.campaignCall(campaign.id) : '';
  const pickView = (next: 'list' | 'board') => { setView(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* per-viewer only */ } };
  const playIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>;

  return <section className="rd-stack" aria-label={`แคมเปญ ${campaign.name}`}>
    <div className="rd-card ob-control">
      <div className="ob-control__head">
        <div className="ob-control__title">
          {title || <h2>{campaign.name}</h2>}
          <span className="rd-muted">{detail.agent?.bot_name || campaign.agentId} · {total.toLocaleString()} รายชื่อ</span>
        </div>
        <div className="ob-control__action">
          {running
            ? <Button className="kb-stop" onClick={stop}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>หยุดโทร</Button>
            : confirming
              ? <><Button variant="secondary" onClick={() => setConfirming(false)}>ยกเลิก</Button><Button onClick={() => void start()}>{playIcon}ยืนยัน โทร {runnable.toLocaleString()} คน</Button></>
              : <Button disabled={!ready || !runnable || !navigator.locks} onClick={() => setConfirming(true)}>{playIcon}เริ่มโทร</Button>}
        </div>
      </div>

      <div className="ob-progress">
        <div className="ob-progress__bar" role="img" aria-label={`จบแล้ว ${finished.toLocaleString()} จาก ${total.toLocaleString()} รายชื่อ`}>
          {total > 0 && COLUMNS.filter(c => c.id !== 'pending' && counts[c.id]).map(c => <span key={c.id} className={`ob-tone--${c.id}`} style={{ width: `${counts[c.id] / total * 100}%` }} title={`${c.label} ${counts[c.id]}`} />)}
        </div>
        <span className="rd-muted">จบแล้ว <strong>{finished.toLocaleString()}</strong> / {total.toLocaleString()} · เหลือ {runnable.toLocaleString()} คน</span>
      </div>

      <div className={`ob-next${running ? ' ob-next--live' : loaded && blocker && runnable && !confirming ? ' ob-next--warn' : ''}`} role="status">
        {running ? <><span className="ob-pulse" aria-hidden="true" /><p><strong>{message || 'กำลังโทร…'}</strong><small>โทรทีละคน ต้องเปิดหน้านี้ไว้ กดหยุดได้ทุกเมื่อ สายที่คุยอยู่จะไม่ถูกตัด</small></p></>
          : confirming ? <p><strong>จะเริ่มโทรรายชื่อที่ยังไม่จบ {runnable.toLocaleString()} คน</strong><small>โทรทีละคน รอจบสายก่อนส่งคนถัดไป สายที่ยังไม่มีสถานะสุดท้ายจะตรวจสายเดิมก่อน ไม่โทรซ้ำ</small></p>
          : !loaded ? <p><strong>{loadError ? 'ยังอ่านประวัติการโทรไม่ได้' : 'กำลังโหลด…'}</strong></p>
          : blocker ? <>
            <p><strong>{prepared.errors.length && staleVariables.length ? `Agent เปลี่ยนตัวแปร ${staleVariables.length} ตัว ต้องจับคู่ข้อมูลใหม่ก่อนโทร` : blocker}</strong>
              {prepared.errors.length > 0 && <details><summary>ดูรายละเอียด</summary>{staleVariables.length ? <span className="rd-codes">{staleVariables.map(v => <code key={v}>{v}</code>)}</span> : <small>{prepared.errors.join(' · ')}</small>}</details>}
              {versionMismatch && <small>บอร์ดแสดงเฉพาะเวอร์ชันปัจจุบัน หากต้องการโทรชุดใหม่ให้สร้างแคมเปญใหม่</small>}
              {!navigator.locks && <small>กรุณาใช้ Chrome หรือ Edge รุ่นปัจจุบัน</small>}
              {detail.error && <small>{detail.error}</small>}
              {message && <small>{message}</small>}</p>
            {fix && <Button size="compact" variant="secondary" href={fix}>{prepared.errors.length ? 'ไปแก้การจับคู่' : 'ไปหน้าโทรตามรายชื่อ'} →</Button>}
          </>
          : <p><strong>{message || `พร้อมโทร ${runnable.toLocaleString()} คน`}</strong><small>ระบบไม่โทรเอง กด “เริ่มโทร” เมื่อพร้อม</small></p>}
      </div>
    </div>

    {(error || loadError) && <p className="workspace-alert" role="alert">{error || loadError}</p>}

    <div className="ob-tiles" role="group" aria-label="กรองตามสถานะ">
      <button type="button" className="ob-tile" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}><span>ทั้งหมด</span><strong>{total.toLocaleString()}</strong></button>
      {COLUMNS.map(c => <button key={c.id} type="button" className="ob-tile" aria-pressed={filter === c.id} onClick={() => setFilter(f => f === c.id ? 'all' : c.id)}>
        <span><i className={`ob-dot ob-tone--${c.id}`} aria-hidden="true" />{c.label}</span><strong>{counts[c.id].toLocaleString()}</strong>
      </button>)}
    </div>

    <div className="rd-card rd-table-card">
      <div className="rd-table-card__head">
        <label className="rd-search ob-search"><span className="sr-only">ค้นหารายชื่อ</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4" /></svg><input type="search" placeholder="ค้นหาชื่อหรือเบอร์" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <div className="rd-filters">
          <div className="rd-segment" role="group" aria-label="มุมมอง"><button type="button" aria-pressed={view === 'list'} onClick={() => pickView('list')}>รายการ</button><button type="button" aria-pressed={view === 'board'} onClick={() => pickView('board')}>บอร์ด</button></div>
          <Button size="compact" variant="secondary" disabled={running} onClick={() => { setError(''); setLoadError(''); void reload(); }}>รีเฟรช</Button>
        </div>
      </div>

      {!loaded ? (loadError
          ? <div className="rd-empty"><strong style={{ display: 'block', color: 'var(--color-heading)', marginBottom: 4 }}>ยังแสดงรายชื่อไม่ได้</strong>ต้องอ่านประวัติการโทรก่อน จึงจะรู้ว่าใครโทรแล้ว<div style={{ marginTop: 12 }}><Button size="compact" variant="secondary" onClick={() => { setError(''); setLoadError(''); void reload(); }}>ลองใหม่</Button></div></div>
          : <p className="rd-empty" role="status">กำลังโหลดรายชื่อ…</p>)
      : view === 'list' ? <>
        {shown.length ? <div className="rd-table-wrap"><table className="rd-table ob-list">
          <thead><tr><th>#</th><th>รายชื่อ</th><th>สถานะ</th><th>โทรล่าสุด</th><th><span className="sr-only">ดู</span></th></tr></thead>
          <tbody>{shown.slice(0, listLimit).map(card => {
            const column = COLUMNS.find(c => c.id === card.column)!;
            return <tr key={card.row.index} onClick={() => setOpenRow(card.row.index)}>
              <td className="ob-list__num">{card.row.index + 1}</td>
              <td><strong>{card.name}</strong><span className="rd-table__sub">{card.row.destination || 'ไม่มีเบอร์'}</span></td>
              <td>{card.row.errors.length ? <span className="rd-chip rd-chip--bad">ต้องแก้ข้อมูล</span> : <span className={`rd-chip${column.tone ? ` rd-chip--${column.tone}` : ''}`}>{column.label}</span>}{detailOf(card) !== column.label && <span className="rd-table__sub">{detailOf(card)}</span>}</td>
              <td className="rd-muted">{card.attempt ? date(card.attempt.created_at) : '—'}</td>
              <td><button type="button" className="ob-open" aria-haspopup="dialog" aria-label={`ดูรายละเอียด ${card.name}`} onClick={e => { e.stopPropagation(); setOpenRow(card.row.index); }}>ดู ›</button></td>
            </tr>;
          })}</tbody>
        </table></div> : <p className="rd-empty">{needle ? 'ไม่พบรายชื่อที่ค้นหา' : 'ไม่มีรายชื่อในสถานะนี้'}</p>}
        {shown.length > listLimit && <div className="rd-table-foot"><span>แสดง {listLimit.toLocaleString()} จาก {shown.length.toLocaleString()}</span><Button size="compact" variant="secondary" onClick={() => setListLimit(l => l + LIST_PAGE)}>แสดงเพิ่ม</Button></div>}
      </>
      : <div className="ob-board-wrap">
        <div className={`kb-board${filter === 'all' ? '' : ' kb-board--single'}`} role="list" aria-label="คอลัมน์สถานะ">
          {COLUMNS.filter(c => filter === 'all' || c.id === filter).map(column => {
            const list = visible.filter(c => c.column === column.id), limit = limits[column.id] || PAGE;
            const droppable = !!column.review && dragRow !== null;
            return <section key={column.id} role="listitem" aria-label={`${column.label} ${list.length} รายชื่อ`}
              className={`kb-col${overColumn === column.id && droppable ? ' kb-col--over' : ''}`}
              onDragOver={e => { if (droppable) { e.preventDefault(); setOverColumn(column.id); } }}
              onDragLeave={() => setOverColumn(c => c === column.id ? null : c)}
              onDrop={e => onDrop(e, column.id)}>
              <header className="kb-col__head"><span className="kb-col__label"><i className={`ob-dot ob-tone--${column.id}`} aria-hidden="true" />{column.label}</span><span className="kb-col__count">{list.length.toLocaleString()}</span></header>
              <div className="kb-col__body">
                {list.slice(0, limit).map(card => <button key={card.row.index} type="button" className={`kb-card${card.row.errors.length ? ' kb-card--invalid' : ''}${dragRow === card.row.index ? ' kb-card--drag' : ''}`}
                  draggable={canMove(card)} onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragRow(card.row.index); }} onDragEnd={() => { setDragRow(null); setOverColumn(null); }}
                  onClick={() => setOpenRow(card.row.index)} aria-haspopup="dialog">
                  <span className="kb-card__top"><strong>{card.name}</strong><span className="kb-card__row">#{card.row.index + 1}</span></span>
                  <span className="kb-card__phone">{card.row.destination || 'ไม่มีเบอร์'}</span>
                  <span className={`kb-card__meta${card.row.errors.length ? ' ob-bad' : ''}`}>{card.row.errors.length ? 'ต้องแก้ข้อมูล' : detailOf(card)}{card.attempt && <span className="kb-card__time">{date(card.attempt.created_at)}</span>}</span>
                </button>)}
                {list.length > limit && <button type="button" className="kb-more" onClick={() => setLimits(l => ({ ...l, [column.id]: limit + PAGE }))}>แสดงอีก {Math.min(PAGE, list.length - limit)} จาก {list.length - limit}</button>}
                {!list.length && <p className="kb-empty">{droppable ? 'วางการ์ดที่นี่เพื่อบันทึกผล' : 'ว่าง'}</p>}
              </div>
            </section>;
          })}
        </div>
        <p className="rd-stat__note">ลากการ์ดที่จบสายแล้วไปคอลัมน์ผลลัพธ์เพื่อแก้ผลเอง หรือกดการ์ดเพื่อเลือกผล · การบันทึกผลไม่เริ่มโทรใหม่</p>
      </div>}
    </div>

    {openCard && createPortal(<div className="kb-drawer-backdrop" onClick={() => setOpenRow(null)}>
      <aside className="kb-drawer" role="dialog" aria-modal="true" aria-label={`รายละเอียด ${openCard.name}`} onClick={e => e.stopPropagation()}>
        <header className="kb-drawer__head">
          <div><span className="rd-muted">แถว {openCard.row.index + 1}</span><h2>{openCard.name}</h2><span className="kb-card__phone">{openCard.row.destination || 'ไม่มีเบอร์'}</span></div>
          <button type="button" className="kb-drawer__close" aria-label="ปิด" autoFocus onClick={() => setOpenRow(null)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </header>
        <div className="kb-drawer__body">
          <section className="rd-stack" style={{ gap: 8 }}>
            <h3>สถานะล่าสุด</h3>
            {openCard.attempt || openCard.state ? <>
              <div className="rd-kv"><span>สถานะสาย</span><strong>{STATUS_LABELS[openCard.state?.status ?? shownStatus(openCard.attempt!.status, openCard.attempt!.response?.followup?.failure_reason)] || openCard.attempt?.status}</strong></div>
              {openCard.attempt && <>
                <div className="rd-kv"><span>ผลตอบรับ</span><strong>{callResultDisplay(openCard.attempt).label}</strong></div>
                <div className="rd-kv"><span>ต้องการเจ้าหน้าที่</span><strong>{(() => { const n = effectiveOutcome(openCard.attempt!.response).needs_agent; return n === null ? 'ยังไม่ทราบ' : n ? 'ต้องการ' : 'ไม่ต้องการ'; })()}</strong></div>
                <div className="rd-kv"><span>เวลาโทร</span><strong>{date(openCard.attempt.created_at)}</strong></div>
                {openCard.attempt.call_id && <div className="rd-kv"><span>Call ID</span><strong>{openCard.attempt.call_id}</strong></div>}
              </>}
            </> : <p className="rd-muted" style={{ margin: 0 }}>ยังไม่เคยโทรหารายชื่อนี้</p>}
          </section>
          {openCard.attempt && canMove(openCard) && <section className="rd-stack" style={{ gap: 8 }}>
            <h3>บันทึกผลด้วยตัวเอง</h3>
            <div className="kb-review">{COLUMNS.filter(c => c.review).map(c => <button key={c.id} type="button" className={`rd-chip rd-chip--${c.tone} kb-review__btn`} aria-pressed={openCard.column === c.id} disabled={saving || openCard.column === c.id} onClick={() => void review(openCard.attempt!, c.id)}>{c.label}</button>)}</div>
          </section>}
          {openCard.attempt?.response?.transcript?.text && <section className="rd-stack" style={{ gap: 8 }}>
            <h3>บทสนทนา</h3><p className="kb-transcript">{openCard.attempt.response.transcript.text}</p>
          </section>}
          <section className="rd-stack" style={{ gap: 8 }}>
            <h3>ข้อมูลจาก CSV</h3>
            <dl className="rd-fields">{campaign.csv.headers.map((h, i) => <div key={h + i}><dt>{h}</dt><dd>{campaign.csv.rows[openCard.row.index]?.[i] || '—'}</dd></div>)}</dl>
            {openCard.row.errors.length > 0 && <p className="workspace-alert">{openCard.row.errors.join(' · ')}</p>}
          </section>
          <a className="rd-link" href={openCard.attempt ? `${routes.campaignCall(campaign.id)}&request=${encodeURIComponent(openCard.attempt.id)}#call-results` : routes.campaignCall(campaign.id)}>ดูประวัติทุกครั้งและเสียงบันทึก →</a>
        </div>
      </aside>
    </div>, document.body)}
  </section>;
}
