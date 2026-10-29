import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { CampaignSchedule } from './CampaignSchedule';
import { CampaignResults } from './CampaignResults';
import { CallRecording } from './CallRecording';
import { BUCKET_ORDER, GuestBuckets } from './GuestBuckets';
import { supabase } from '../lib/supabase';
import { callTime, eventCountdown, eventLabel, nameColumn, saveDraft, type CampaignDraft } from '../lib/campaigns';
import { checkCampaignReady } from '../lib/campaign-calls';
import { botnoiApi } from '../services/botnoi';
import { botnoiFetch } from '../services/botnoi/client';
import { useAgentDetail } from '../hooks/useBotnoiData';
import { prepareCampaignRows, type PreparedContact } from '../../shared/campaign-inputs.mjs';
import { runCampaignQueue, planCampaignCalls, campaignRequestId, terminalCall, shownStatus, type CampaignAttempt } from '../../shared/campaign-queue.mjs';
import { latestContactCalls, outcomeLabels, type Outcome } from '../../shared/call-results.mjs';
import { callResultDisplay, callChoices, liveBucket, bucketLabels, readableTranscript, displayPhone, type GuestBucket } from '../../shared/call-display.mjs';
import { activeSchedule } from '../../shared/campaign-schedule.mjs';
import { routes, warnBeforeLeave } from '../routes';

// One campaign: who is coming, who to call, and every guest's calls. One row per guest, grouped by their latest call.
// Calls only start from the confirm step; Stop ends the queue before the next guest.

type Attempt = CampaignAttempt & {
  destination?: string;
  response?: { review?: Outcome; callback?: { outcome: Outcome }; followup?: { outcome: Outcome; failure_reason?: string | null; final?: boolean; transcript?: string }; transcript?: { text: string } } | null;
};
type Live = { status: string; callId?: string };
type Choice = 'next' | 'selected';
type Planned = PreparedContact & { redialOf?: string };
type Tab = 'guests' | 'history' | 'settings';

const TONES: Partial<Record<GuestBucket, string>> = { staff: 'staff', redial: 'warn', calling: 'info', confirmed: 'confirmed', declined: 'bad' };
// Manual results the backend accepts, with whether the guest asked for staff (null when the call cannot tell).
// The three answers a staff call usually gets come first; the rest sit under "ตอบอย่างอื่น".
const ANSWERS: { key: string; needs: boolean | null }[] = [{ key: 'CONFIRMED', needs: false }, { key: 'DECLINED', needs: false }, { key: 'NO_ANSWER', needs: null }];
const OTHER_ANSWERS: { key: string; needs: boolean | null }[] = [{ key: 'CALLBACK_REQUESTED', needs: null }, { key: 'REQUEST_AGENT', needs: true }, { key: 'WRONG_PERSON', needs: false }];
// Every manual result carries a note (docs/CALL_RESULTS.md); these fill it in one tap.
const NOTE_CHIPS = ['คุยทางโทรศัพท์', 'ตอบทาง LINE', 'แจ้งผู้จัดงานเอง'];
const STATUS_LABELS: Record<string, string> = { waiting: 'รอส่ง', submitting: 'กำลังส่งคำขอ', queued: 'เข้าคิวแล้ว', ringing: 'กำลังเรียกสาย', 'in-progress': 'กำลังคุย', completed: 'จบสาย', failed: 'โทรไม่สำเร็จ', busy: 'สายไม่ว่าง', 'no-answer': 'ไม่รับสาย', cancelled: 'ยกเลิก', canceled: 'ยกเลิก', unknown: 'ยังไม่รู้สถานะ' };
const TABS: [Tab, string][] = [['guests', 'แขก'], ['history', 'ประวัติการโทร'], ['settings', 'ตั้งค่า']];
const LIST_PAGE = 50, NAMES_SHOWN = 8;
const transcriptOf = (a?: Attempt) => readableTranscript(a?.response?.transcript?.text || a?.response?.followup?.transcript);
const playIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7Z" /></svg>;
const phoneIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>;

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

export function CampaignBoard({ campaign }: { campaign: CampaignDraft }) {
  const detail = useAgentDetail(campaign.agentId);
  const prepared = prepareCampaignRows(campaign, detail.variables);
  const version = campaign.updatedAt;
  // Links in: ?row=<n> opens a guest, ?status=<group> filters, ?request=<id> opens one call in the history tab.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [items, setItems] = useState<Attempt[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [live, setLive] = useState<Record<number, Live>>({});
  const [running, setRunning] = useState(false);
  // The list the user is asked to confirm; start() only runs if fresh history plans exactly this list.
  const [asking, setAsking] = useState<{ choice: Choice; plan: Planned[] } | null>(null);
  const [error, setError] = useState('');
  // Kept apart from action errors so a later successful poll can clear it without hiding a failed start.
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [scheduled, setScheduled] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<Tab>(() => params.has('request') ? 'history' : 'guests');
  const [filter, setFilter] = useState<GuestBucket | null>(() => {
    const wanted = params.get('status') ?? (params.get('scope') === 'unanswered' ? 'redial' : '');
    return BUCKET_ORDER.find(b => b === wanted) ?? null;
  });
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [listLimit, setListLimit] = useState(LIST_PAGE);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Drawer: the chosen answer, the required note, the last save (for undo), its error and the open recording.
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<{ attempt: Attempt; previous: Outcome | null } | null>(null);
  const [drawerError, setDrawerError] = useState('');
  const [recording, setRecording] = useState<string | null>(null);
  const linkedRow = useRef(Number.parseInt(params.get('row') ?? '', 10));
  const stopped = useRef(false), mounted = useRef(true), busy = useRef(false), opener = useRef<HTMLElement | null>(null);

  const reload = useCallback(async () => {
    try { const data = await fetchAttempts(campaign.id); if (mounted.current) { setItems(data); setLoaded(true); setLoadError(''); } }
    catch (e) { if (mounted.current) setLoadError((e as Error).message); }
  }, [campaign.id]);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopped.current = true; }; }, []);
  useEffect(() => { setLoaded(false); setLive({}); setOpenRow(null); void reload(); }, [reload]);
  // Results arrive from the Agent after a call ends, so keep the list fresh, also during a run (start() keeps its own history).
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void reload(); }, 15000);
    return () => window.clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    const unguard = warnBeforeLeave('กำลังโทรอยู่ ถ้าออกจากหน้านี้ จะหยุดโทรคนถัดไป ต้องการออกหรือไม่');
    return () => { window.removeEventListener('beforeunload', warn); unguard(); };
  }, [running]);

  const current = items.filter(a => a.metadata.campaign_version === version);
  const latestByRow = new Map((latestContactCalls(items, version, campaign.csv.rows.length) as Attempt[]).map(a => [a.metadata.contact_row!, a]));
  const versionMismatch = current.length < items.length;
  // Guests with incomplete data are left out of every plan; the list marks them.
  const callable = prepared.errors.length ? [] : prepared.rows.filter(row => !row.errors.length);
  const skipped = prepared.rows.filter(row => row.errors.length).length;
  const choices = callChoices(callable, current);
  const picked = planCampaignCalls(callable, current, selected, true);
  const planOf = (choice: Choice): Planned[] => choice === 'selected' ? picked : choices.next;
  // A planned row with a call and no redialOf is an unfinished call: the queue checks it and does not call again,
  // so it is never counted as a call. The scheduler only calls guests with no call at all.
  const checksOf = (plan: Planned[]) => plan.filter(row => !row.redialOf && latestByRow.has(row.index));
  const callsOf = (plan: Planned[]) => plan.filter(row => row.redialOf || !latestByRow.has(row.index));
  const neverCalled = (plan: Planned[]) => plan.filter(row => !latestByRow.has(row.index)).length;
  const nextCalls = callsOf(choices.next).length;
  const ready = loaded && !!detail.agent && !detail.loading && !detail.error && !prepared.errors.length && !versionMismatch && !!navigator.locks;
  const blocker = !loaded ? '' : versionMismatch ? 'มีสายจากไฟล์เวอร์ชันก่อน ถ้าจะโทรชุดใหม่ให้สร้างแคมเปญใหม่'
    : prepared.errors.length ? 'บอทต้องใช้ข้อมูลแขกเพิ่ม จับคู่คอลัมน์ใหม่ก่อนโทร' : detail.loading ? 'กำลังตรวจ Agent…'
    : detail.error ? detail.error : !detail.agent ? 'ยังไม่ได้เลือก Agent' : !navigator.locks ? 'ใช้ Chrome หรือ Edge รุ่นล่าสุดเพื่อโทร' : '';

  const names = nameColumn(campaign);
  const nameOf = (index: number) => (names >= 0 && campaign.csv.rows[index]?.[names]?.trim()) || `แถว ${index + 1}`;
  const cards = prepared.rows.map(row => {
    const attempt = latestByRow.get(row.index), state = live[row.index];
    return { row, attempt, state, column: liveBucket(attempt, state?.status), name: nameOf(row.index) };
  });
  type Card = typeof cards[number];
  // A second line only when it says more than the group: where a live call is, or the answer behind the group.
  const detailOf = (card: Card) => {
    const status = card.state?.status ?? card.attempt?.status;
    if (!status || card.column === 'awaiting') return '';
    if (card.column === 'calling') return terminalCall(status) ? 'จบสาย' : STATUS_LABELS[status] || status;
    const label = card.attempt ? callResultDisplay(card.attempt).label : '';
    return label === bucketLabels[card.column] ? '' : label;
  };
  const chip = (column: GuestBucket) => <span className={`rd-chip${TONES[column] ? ` rd-chip--${TONES[column]}` : ''}`}>{bucketLabels[column]}</span>;
  const needle = query.trim().toLowerCase();
  const visible = needle ? cards.filter(c => `${c.name} ${c.row.destination} ${displayPhone(c.row.destination)}`.toLowerCase().includes(needle)) : cards;
  const counts = Object.fromEntries(BUCKET_ORDER.map(b => [b, cards.filter(c => c.column === b).length])) as Record<GuestBucket, number>;
  const shown = filter ? visible.filter(c => c.column === filter) : visible;
  const total = cards.length;

  async function start() {
    const want = asking;
    if (!want || !ready || running || scheduled || busy.current) return;
    busy.current = true; stopped.current = false; setAsking(null); setRunning(true); setError(''); setMessage('กำลังตรวจก่อนโทร…');
    try {
      const schedule = await botnoiFetch<{ job: { status: string } | null }>(`/workspace/campaigns/${campaign.id}/schedule`);
      if (activeSchedule(schedule.job)) throw new Error('มีการตั้งเวลาโทรอยู่ ยกเลิกก่อนจึงโทรเองได้');
      await navigator.locks.request(`voice-campaign:${campaign.id}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('แคมเปญนี้กำลังโทรอยู่ในอีกแท็บ');
        const { account, checked } = await checkCampaignReady(campaign);
        const history = await fetchAttempts(campaign.id);
        if (history.some(a => a.metadata.campaign_version !== version)) throw new Error('มีสายจากไฟล์เวอร์ชันก่อน ถ้าจะโทรชุดใหม่ให้สร้างแคมเปญใหม่');
        const rows = checked.rows.filter(row => !row.errors.length);
        const chosen = want.choice === 'selected' ? planCampaignCalls(rows, history, selected, true) : callChoices(rows, history).next;
        if (!chosen.length) throw new Error('ไม่มีใครต้องโทรแล้ว');
        // A result or another call landed since the user confirmed: ask again instead of calling a different list.
        if (chosen.length !== want.plan.length || chosen.some((row, i) => row.index !== want.plan[i].index || row.redialOf !== want.plan[i].redialOf)) throw new Error('รายชื่อเปลี่ยนระหว่างรอ กรุณากดโทรอีกครั้ง');
        const result = await runCampaignQueue({
          rows: chosen, attempts: history,
          shouldStop: () => stopped.current || !mounted.current,
          wait: ms => new Promise(resolve => window.setTimeout(resolve, ms)),
          submit: async row => botnoiApi.placeCall(account._id, row.destination, campaign.agentId, { requestId: await campaignRequestId(campaign.id, version!, row.index, row.redialOf), redialOf: row.redialOf, variables: {}, campaignId: campaign.id, contactRow: row.index, campaignBatch: true, campaignVersion: version }),
          readStatus: id => botnoiApi.getCallStatus(account._id, id),
          onUpdate: (index, status, _message, callId) => {
            if (!mounted.current) return;
            setLive(prev => ({ ...prev, [index]: { status, callId: callId || prev[index]?.callId } }));
            setMessage(`${nameOf(index)} · ${STATUS_LABELS[status] || status}`);
            if (terminalCall(status)) void reload();
          },
        });
        if (mounted.current) setMessage(result === 'complete' ? `โทรครบ ${chosen.length} คนแล้ว คำตอบจะขึ้นภายใน 1 ชั่วโมง` : 'หยุดแล้ว สายที่คุยอยู่ไม่ถูกตัด');
      });
    } catch (e) { if (mounted.current) { setError((e as Error).message); setMessage(''); } }
    finally { busy.current = false; if (mounted.current) { setRunning(false); setLive({}); setSelecting(false); setSelected([]); setRevision(v => v + 1); void reload(); } }
  }

  function stop() { stopped.current = true; setMessage('กำลังหยุด… สายที่คุยอยู่ไม่ถูกตัด'); }
  function ask(choice: Choice) { setError(''); setMessage(''); setAsking({ choice, plan: planOf(choice) }); }
  function toggle(index: number) { setAsking(null); setSelected(old => old.includes(index) ? old.filter(i => i !== index) : [...old, index]); }
  async function edit(path: string) {
    if (running || busy.current || scheduled) return;
    setEditing(true); setError('');
    try { await saveDraft(campaign); window.location.assign(path); } catch (e) { setError((e as Error).message); setEditing(false); }
  }

  function openDrawer(index: number) { if (openRow === null) opener.current = document.activeElement as HTMLElement | null; setOpenRow(index); setPick('');setNote(''); setSaved(null); setDrawerError(''); setRecording(null); }
  // A typed note keeps the drawer open on Escape or a stray click outside it, and says why.
  const closeDrawer = (force = false) => {
    if (force || !note.trim()) setOpenRow(null);
    else setDrawerError('ยังไม่ได้บันทึก กด “บันทึกผล” หรือกด × เพื่อปิดโดยไม่บันทึก');
  };

  async function writeReview(attempt: Attempt, body: Record<string, unknown>) {
    if (saving || running) return;
    setSaving(true); setDrawerError('');
    try {
      const updated = await botnoiFetch<Attempt>(`/workspace/calls/${attempt.id}/result`, { method: 'POST', body: { ...body, expected_review_at: attempt.response?.review?.updated_at || null } });
      setItems(old => old.map(a => a.id === updated.id ? updated : a));
      return updated;
    } catch (e) { setDrawerError((e as Error).message); }
    finally { setSaving(false); }
  }
  async function saveReview(attempt: Attempt) {
    const option = [...ANSWERS, ...OTHER_ANSWERS].find(o => o.key === pick);
    if (!option || !note.trim()) return;
    const previous = attempt.response?.review ?? null;
    const updated = await writeReview(attempt, { call_result: option.key, needs_agent: option.needs, evidence: note.trim() });
    if (updated) { setSaved({ attempt: updated, previous }); setNote(''); }
  }
  // Undo restores the review that was replaced, or clears it so the bot's own result shows again.
  async function restore(attempt: Attempt, previous: Outcome | null) {
    const body = previous ? { call_result: previous.call_result, needs_agent: previous.needs_agent, evidence: previous.evidence || '' } : { clear: true };
    if (await writeReview(attempt, body)) { setSaved(null); setPick(''); }
  }

  // A result is recorded against a finished call, and never while this tab is placing calls.
  const canReview = (card: Card) => !running && !!card.attempt && terminalCall(card.attempt.status) && !card.state;
  // A result the history tab fetched updates the guest's group now instead of at the next poll.
  const onResult = useCallback((_row: number, status: string, callId: string, response: unknown) => {
    setItems(old => old.map(a => a.call_id === callId ? { ...a, status: terminalCall(a.status) ? a.status : status, response: response as Attempt['response'] } : a));
  }, []);

  useEffect(() => {
    if (!loaded || !Number.isInteger(linkedRow.current)) return;
    if (prepared.rows.some(r => r.index === linkedRow.current)) openDrawer(linkedRow.current);
    linkedRow.current = NaN;
  }, [loaded]);
  const openCard = openRow === null ? null : cards.find(c => c.row.index === openRow) || null;
  useEffect(() => {
    if (openRow === null) return;
    const close = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [openRow, note]);
  // While the drawer is open the page behind it is inert, so Tab stays in the drawer; closing returns focus to what opened it
  // (recorded in openDrawer, because the close button's autoFocus has moved focus before this runs).
  const drawerOpen = openRow !== null;
  useEffect(() => {
    if (!drawerOpen) return;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => { root?.removeAttribute('inert'); opener.current?.focus(); };
  }, [drawerOpen]);

  const onTabKey = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const next = TABS[(TABS.findIndex(t => t[0] === tab) + step + TABS.length) % TABS.length][0];
    setTab(next); document.getElementById(`tab-${next}`)?.focus();
  };
  const shownCallable = selecting ? shown.filter(c => !c.row.errors.length && !prepared.errors.length).map(c => c.row.index) : [];
  const allShown = shownCallable.length > 0 && shownCallable.every(i => selected.includes(i));
  const locked = running || editing || scheduled;
  const countdown = eventCountdown(campaign);
  const guestHistory = openCard ? current.filter(a => a.metadata.contact_row === openCard.row.index).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id)) : [];
  // One line under the call button: what blocks calling, how the last run ended, or what to do next.
  const hint = blocker || message || (!loaded ? '' : selecting ? 'เลือกแขกในรายการด้านล่าง'
    : !scheduled && !choices.next.length ? 'ไม่มีใครต้องโทรตอนนี้' : skipped ? `ข้าม ${skipped} คนที่ข้อมูลไม่ครบ` : '');
  const answer = (o: { key: string }) => <label key={o.key} className="kb-review__option"><input type="radio" name="kb-review" value={o.key} checked={pick === o.key} onChange={() => setPick(o.key)} /><span>{outcomeLabels[o.key]}</span></label>;

  return <>
    <header className="rd-head camp-head"><div>
      <a className="rd-back" href={routes.campaigns}>← แคมเปญ</a>
      <div className="camp-head__title"><h1>{campaign.name}</h1>{running ? <span className="rd-chip rd-chip--info">กำลังโทร</span> : scheduled ? <span className="rd-chip rd-chip--info">ตั้งเวลาไว้</span> : null}</div>
      {countdown && <p><strong className="event-countdown">{countdown}</strong> · {eventLabel(campaign)}</p>}
    </div></header>

    <section className="rd-card rd-pad guest-summary camp-hero" aria-labelledby="camp-hero-title" aria-busy={!loaded}>
      <h2 id="camp-hero-title" className="sr-only">ผลตอบรับ</h2>
      <p className="guest-summary__count"><strong>{loaded ? counts.confirmed.toLocaleString() : '—'}</strong> / {total.toLocaleString()} แขก</p>
      <p className="guest-summary__label">มางาน</p>
      <GuestBuckets count={b => counts[b]} total={total} ready={loaded} legend={false} />
      {/* The tiles are the bar's key, in its order; each one filters the guest list. Empty groups are left out. */}
      {loaded && <div className="ob-tiles" role="group" aria-label="กรองแขกตามกลุ่ม">
        {BUCKET_ORDER.filter(b => counts[b] > 0 || filter === b).map(b => <button key={b} type="button" className="ob-tile" aria-pressed={filter === b} onClick={() => { setFilter(f => f === b ? null : b); setTab('guests'); }}>
          <span><i className={`ob-dot ob-tone--${b}`} aria-hidden="true" />{bucketLabels[b]}</span><strong>{counts[b].toLocaleString()}</strong>
        </button>)}
      </div>}

      <div className="camp-go" role="group" aria-label="โทรหาแขก">
        {running ? <div className="camp-go__live" role="status">
          <span className="ob-pulse" aria-hidden="true" /><strong>{message || 'กำลังโทร…'}</strong>
          <Button className="kb-stop" onClick={stop}><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>หยุดโทร</Button>
        </div>
        : asking ? (() => {
          const calls = callsOf(asking.plan), checks = checksOf(asking.plan).length, redials = calls.filter(row => row.redialOf).length;
          const people = calls.length ? calls : asking.plan, more = people.length - NAMES_SHOWN;
          const extra = [redials && `โทรซ้ำ ${redials.toLocaleString()} คน`, checks && calls.length && `ตรวจ ${checks.toLocaleString()} สายที่ยังไม่จบ ไม่โทรซ้ำ`].filter(Boolean).join(' · ');
          return <div className="camp-confirm" role="group" aria-labelledby="camp-confirm-title">
            <p id="camp-confirm-title"><strong>{calls.length ? `โทร ${calls.length.toLocaleString()} คน` : `ตรวจ ${checks.toLocaleString()} สายที่ยังไม่จบ`}</strong></p>
            <p className="camp-confirm__names">{people.slice(0, NAMES_SHOWN).map(row => nameOf(row.index)).join(', ')}{more > 0 ? ` และอีก ${more} คน` : ''}</p>
            {extra && <p className="camp-confirm__note">{extra}</p>}
            <p className="camp-confirm__note">ต้องเปิดหน้านี้ไว้จนโทรเสร็จ ถ้าจะปิดหน้า ใช้ “ตั้งเวลาโทร” แทน</p>
            <div className="camp-go__buttons"><Button disabled={!ready || scheduled} onClick={() => void start()}>{playIcon}เริ่มโทร</Button><Button variant="secondary" onClick={() => setAsking(null)}>ยกเลิก</Button></div>
          </div>;
        })()
        : <div className="camp-go__buttons">
          {!scheduled && (selecting
            ? <><Button disabled={!ready || !picked.length} onClick={() => ask('selected')}>โทร {callsOf(picked).length.toLocaleString()} คนที่เลือก</Button>
              <Button variant="secondary" onClick={() => { setSelecting(false); setSelected([]); }}>ยกเลิกการเลือก</Button></>
            : choices.next.length > 0 && <Button disabled={!ready} onClick={() => ask('next')}>{playIcon}{nextCalls ? `โทร ${nextCalls.toLocaleString()} คนที่ยังไม่ได้คำตอบ` : `ตรวจ ${choices.next.length.toLocaleString()} สายที่ยังไม่จบ`}</Button>)}
          {/* The server schedule calls on its own: its button, state and cancel sit with the call button. */}
          <CampaignSchedule campaignId={campaign.id} onActive={setScheduled} configure version={version} rows={selecting ? selected : null} total={total}
            pendingCount={neverCalled(selecting ? picked : choices.fresh)}
            disabled={running || editing || !loaded || detail.loading || !!detail.error || !!prepared.errors.length || versionMismatch} />
          {!scheduled && !selecting && <button type="button" className="rd-link camp-go__pick" disabled={!loaded} onClick={() => { setSelecting(true); setTab('guests'); }}>เลือกเอง</button>}
        </div>}
        {!running && !asking && hint && <p className={`camp-go__hint${blocker && blocker !== 'กำลังตรวจ Agent…' ? ' camp-go__hint--warn' : ''}`} role="status">{hint}
          {prepared.errors.length > 0 && <button type="button" className="rd-link" onClick={() => setTab('settings')}>ไปตั้งค่า</button>}</p>}
        {!running && !asking && <details className="camp-rules"><summary>ใครถูกโทรซ้ำ</summary>
          <p>โทรซ้ำคนที่ไม่รับสาย สายไม่ว่าง ขอให้โทรกลับ หรือวางสายก่อนตอบ ไม่โทรซ้ำคนที่ตอบแล้ว ผิดคน หรือขอคุยเจ้าหน้าที่</p>
          <p>สายที่เพิ่งจบรอคำตอบจากบอทได้ถึง 1 ชั่วโมง ระหว่างนั้นอยู่ใน “รอผล” และยังไม่โทรซ้ำ</p>
        </details>}
      </div>
    </section>

    {(error || loadError) && <p className="workspace-alert" role="alert">{error || loadError}</p>}

    <div className="camp-tabs" role="tablist" aria-label="ส่วนของแคมเปญ" onKeyDown={onTabKey}>
      {TABS.map(([id, label]) => <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)}>{label}</button>)}
    </div>

    {/* Panels are hidden, never unmounted: the history panel keeps fetching results while another tab is open. */}
    <div className="camp-panel" role="tabpanel" id="panel-guests" aria-labelledby="tab-guests" hidden={tab !== 'guests'}>
      <h2 className="sr-only">รายชื่อแขก</h2>
      <div className="rd-card rd-table-card">
        <div className="rd-table-card__head">
          <label className="rd-search ob-search"><span className="sr-only">ค้นหาแขก</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4" /></svg><input type="search" placeholder="ค้นหาชื่อหรือเบอร์" value={query} onChange={e => setQuery(e.target.value)} /></label>
          {filter && <button type="button" className="rd-link" onClick={() => setFilter(null)}>{bucketLabels[filter]} · แสดงทุกคน</button>}
        </div>

        {!loaded ? (loadError
            ? <div className="rd-empty"><p>ยังแสดงรายชื่อไม่ได้</p><Button size="compact" variant="secondary" onClick={() => { setError(''); setLoadError(''); void reload(); }}>ลองใหม่</Button></div>
            : <p className="rd-empty" role="status">กำลังโหลด…</p>)
        : <>
          {shown.length ? <div className="rd-table-wrap"><table className="rd-table rd-table--cards ob-list">
            <thead><tr>
              {selecting && <th className="rd-cell--auto"><input type="checkbox" aria-label="เลือกทุกคนที่แสดง" checked={allShown} disabled={!shownCallable.length} onChange={() => setSelected(old => allShown ? old.filter(i => !shownCallable.includes(i)) : [...new Set([...old, ...shownCallable])])} /></th>}
              <th>แขก</th><th>สถานะ</th><th className="ob-list__when">โทรล่าสุด</th><th><span className="sr-only">ดู</span></th>
            </tr></thead>
            <tbody>{shown.slice(0, listLimit).map(card => {
              const sub = detailOf(card), bad = !!card.row.errors.length || !!prepared.errors.length;
              return <tr key={card.row.index} className={selecting && selected.includes(card.row.index) ? 'call-row-selected' : ''} onClick={() => selecting ? !bad && toggle(card.row.index) : openDrawer(card.row.index)}>
                {selecting && <td className="rd-cell--auto"><input type="checkbox" aria-label={`เลือก ${card.name}`} checked={selected.includes(card.row.index)} disabled={bad} onClick={e => e.stopPropagation()} onChange={() => toggle(card.row.index)} /></td>}
                <td className="rd-cell--grow"><strong>{card.name}</strong><span className="rd-table__sub">{card.row.destination ? displayPhone(card.row.destination) : 'ไม่มีเบอร์'}</span></td>
                <td className="rd-cell--auto">{card.row.errors.length ? <span className="rd-chip rd-chip--bad">ข้อมูลไม่ครบ</span> : chip(card.column)}{sub && <span className="rd-table__sub">{sub}</span>}</td>
                <td className="rd-muted rd-cell--half rd-cell--later ob-list__when" data-label="โทรล่าสุด">{card.attempt ? callTime(card.attempt.created_at) : '—'}</td>
                <td className="rd-cell--auto"><button type="button" className="ob-open" aria-haspopup="dialog" aria-label={`ดู ${card.name}`} onClick={e => { e.stopPropagation(); openDrawer(card.row.index); }}>ดู ›</button></td>
              </tr>;
            })}</tbody>
          </table></div> : <p className="rd-empty">{needle ? 'ไม่พบแขกที่ค้นหา' : 'ไม่มีแขกในกลุ่มนี้'}</p>}
          {shown.length > listLimit && <div className="rd-table-foot"><span>{listLimit.toLocaleString()} / {shown.length.toLocaleString()} คน</span><Button size="compact" variant="secondary" onClick={() => setListLimit(l => l + LIST_PAGE)}>แสดงเพิ่ม</Button></div>}
        </>}
      </div>
    </div>

    <div className="camp-panel" role="tabpanel" id="panel-history" aria-labelledby="tab-history" hidden={tab !== 'history'}>
      <h2 className="sr-only">ประวัติการโทร</h2>
      <CampaignResults campaign={campaign} queueRunning={running} revision={revision} onStatus={onResult} onOpenGuest={row => openDrawer(row)} />
    </div>

    <div className="camp-panel" role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" hidden={tab !== 'settings'}>
      <section className="rd-card rd-pad rd-stack camp-settings" aria-labelledby="camp-settings-title">
        <h2 id="camp-settings-title" className="sr-only">ตั้งค่าแคมเปญ</h2>
        <div className="rd-kv"><span>Agent</span><strong>{detail.agent?.bot_name || campaign.agentId || '—'}</strong></div>
        <div className="rd-kv"><span>ไฟล์รายชื่อ</span><strong>{campaign.fileName}</strong></div>
        <div className="rd-kv"><span>ข้อมูลครบ</span><strong>{prepared.errors.length ? 'ต้องจับคู่ใหม่' : `${callable.length.toLocaleString()} / ${total.toLocaleString()} คน`}</strong></div>
        {detail.error && <p className="workspace-alert" role="alert">{detail.error}</p>}
        {prepared.errors.map(e => <p className="workspace-alert" key={e}>{e}</p>)}
        {detail.variables.length > 0 && <div className="rd-codes">{detail.variables.map(v => <code key={v}>{v} ← {prepared.bindings[v]?.source === 'output' ? 'ผลหลังโทร' : (prepared.bindings[v] as { column?: string })?.column || 'ยังไม่เลือก'}</code>)}</div>}
        <div className="rd-head__actions">
          <Button size="compact" variant="secondary" disabled={locked} onClick={() => { detail.refetch(); setError(''); setAsking(null); void reload(); }}>ตรวจข้อมูลล่าสุด</Button>
          <Button size="compact" variant="secondary" disabled={locked} onClick={() => void edit(routes.dataMapping)}>แก้ไขการจับคู่</Button>
          <Button size="compact" variant="secondary" disabled={locked} onClick={() => void edit(routes.createCampaign)}>เปลี่ยนไฟล์ CSV</Button>
        </div>
      </section>
    </div>

    {openCard && createPortal(<div className="kb-drawer-backdrop" onClick={() => closeDrawer()}>
      <aside className="kb-drawer" role="dialog" aria-modal="true" aria-labelledby="kb-drawer-title" onClick={e => e.stopPropagation()}>
        <header className="kb-drawer__head">
          <div><h2 id="kb-drawer-title">{openCard.name}</h2>
            <p className="kb-drawer__result">{chip(openCard.column)}{detailOf(openCard) && <span>{detailOf(openCard)}</span>}{openCard.attempt && <span className="rd-muted">{callTime(openCard.attempt.created_at)}</span>}</p></div>
          <button type="button" className="kb-drawer__close" aria-label="ปิด" autoFocus onClick={() => closeDrawer(true)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
        </header>
        <div className="kb-drawer__body">
          {/* Guests who asked for a person: calling them is the job, so the number is the first and biggest action. */}
          {openCard.row.destination ? <Button href={`tel:${openCard.row.destination}`} variant={openCard.column === 'staff' ? 'primary' : 'secondary'} className="kb-drawer__call">{phoneIcon}โทร {displayPhone(openCard.row.destination)}</Button>
            : <p className="rd-muted kb-drawer__wait">ไม่มีเบอร์</p>}
          {openCard.attempt && (canReview(openCard) ? <section className="rd-stack kb-review" aria-labelledby="kb-review-title">
            <h3 id="kb-review-title">แขกตอบว่า</h3>
            <fieldset className="kb-review__options" disabled={saving}><legend className="sr-only">คำตอบของแขก</legend>{ANSWERS.map(answer)}</fieldset>
            <details className="kb-review__more"><summary>ตอบอย่างอื่น</summary>
              <fieldset className="kb-review__options" disabled={saving}><legend className="sr-only">คำตอบอื่น</legend>{OTHER_ANSWERS.map(answer)}</fieldset>
            </details>
            <div className="kb-review__note">
              <span id="kb-note-label">ได้คำตอบทางไหน</span>
              <div className="kb-review__chips">{NOTE_CHIPS.map(text => <button key={text} type="button" aria-pressed={note === text} disabled={saving} onClick={() => setNote(text)}>{text}</button>)}</div>
              <textarea rows={2} maxLength={2000} value={note} disabled={saving} aria-labelledby="kb-note-label" placeholder="หรือพิมพ์เอง เช่น แขกตอบทาง LINE ว่ามา" onChange={e => { setNote(e.target.value); setDrawerError(''); }} />
            </div>
            <div className="kb-review__actions">
              <Button size="compact" disabled={saving || !pick || !note.trim()} onClick={() => void saveReview(openCard.attempt!)}>{saving ? 'กำลังบันทึก…' : 'บันทึกผล'}</Button>
              {openCard.attempt.response?.review && !saved && <Button size="compact" variant="secondary" disabled={saving} onClick={() => void restore(openCard.attempt!, null)}>ใช้ผลจากบอท</Button>}
            </div>
            {saved && saved.attempt.id === openCard.attempt.id && <p className="workspace-notice kb-review__saved" role="status">บันทึก “{callResultDisplay(saved.attempt).label}” แล้ว<button type="button" className="rd-link" disabled={saving} onClick={() => void restore(saved.attempt, saved.previous)}>เลิกทำ</button></p>}
            {drawerError && <p className="workspace-alert" role="alert">{drawerError}</p>}
          </section> : <p className="rd-muted kb-drawer__wait">{running ? 'บันทึกผลได้เมื่อโทรเสร็จ' : 'สายนี้ยังไม่จบ บันทึกผลได้เมื่อจบสาย'}</p>)}
          {transcriptOf(openCard.attempt) && <section className="rd-stack" style={{ gap: 8 }}>
            <h3>บทสนทนา</h3><p className="kb-transcript">{transcriptOf(openCard.attempt)}</p>
          </section>}
          {guestHistory.length > 0 && <section className="rd-stack" style={{ gap: 8 }} aria-labelledby="kb-history-title">
            <h3 id="kb-history-title">ประวัติการโทร ({guestHistory.length})</h3>
            <ul className="kb-history">{guestHistory.map(a => <li key={a.id}>
              <div><strong>{callResultDisplay(a).label}</strong><span className="rd-muted">{callTime(a.created_at)} · {STATUS_LABELS[shownStatus(a.status, a.response?.followup?.failure_reason)] || a.status}</span></div>
              {a.call_id && <button type="button" className="rd-link" aria-expanded={recording === a.id} onClick={() => setRecording(r => r === a.id ? null : a.id)}>{recording === a.id ? 'ปิดเสียง' : 'ฟังเสียง'}</button>}
              {recording === a.id && <CallRecording key={a.id} requestId={a.id} campaignId={campaign.id} callId={a.call_id} />}
            </li>)}</ul>
          </section>}
          <details className="kb-guest-data">
            <summary>ข้อมูลแขก</summary>
            <dl className="rd-fields">{campaign.csv.headers.map((h, i) => <div key={h + i}><dt>{h}</dt><dd>{campaign.csv.rows[openCard.row.index]?.[i] || '—'}</dd></div>)}</dl>
            {openCard.row.errors.length > 0 && <p className="workspace-alert">{openCard.row.errors.join(' · ')}</p>}
          </details>
        </div>
      </aside>
    </div>, document.body)}
  </>;
}
