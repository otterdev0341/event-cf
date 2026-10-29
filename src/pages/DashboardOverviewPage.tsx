import { useEffect, useState, type ReactNode } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { GuestBuckets } from '../components/GuestBuckets';
import { SmoothSelect } from '../components/ui/smooth-select';
import { callTime, eventCountdown, eventLabel, getCampaigns, nameColumn, type CampaignDraft } from '../lib/campaigns';
import { supabase } from '../lib/supabase';
import { botnoiFetch } from '../services/botnoi/client';
import { activeSchedule } from '../../shared/campaign-schedule.mjs';
import { routes } from '../routes';
import { effectiveOutcome, latestContactCalls, type Outcome } from '../../shared/call-results.mjs';
import { callResultDisplay, displayPhone, guestBucket, type GuestBucket } from '../../shared/call-display.mjs';

type Attempt = {
  id: string; call_id: string | null; destination: string; status: string; created_at: string;
  metadata: { campaign_id?: string; campaign_version?: string; contact_row?: number };
  response: { review?: Outcome; callback?: { outcome: Outcome }; followup?: { outcome: Outcome; failure_reason?: string | null; final?: boolean } } | null;
};
const PREVIEW = 5;

// The event being worked towards: the nearest one from today on, else the latest one; on the same day, the bigger guest list.
function nearestEvent(campaigns: CampaignDraft[]) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const byDate = [...campaigns].sort((a, b) => (a.eventDate || '').localeCompare(b.eventDate || '') || b.csv.rows.length - a.csv.rows.length);
  return byDate.find(c => c.eventDate >= today) || byDate.at(-1);
}

export function DashboardOverviewPage() {
  const campaigns = getCampaigns();
  const [campaignId, setCampaignId] = useState(() => nearestEvent(campaigns)?.id || '');
  const campaign = campaigns.find(c => c.id === campaignId);
  return <div className="dashboard-page"><AppHeader /><main className="dashboard-main page-shell">
    <header className="rd-head"><div><h1>ภาพรวม</h1></div><div className="rd-head__actions"><Button variant="secondary" href={routes.createCampaign}>+ สร้างแคมเปญ</Button></div></header>
    {campaign
      ? <EventSummary key={campaign.id} campaign={campaign} picker={campaigns.length > 1 && <SmoothSelect aria-label="แคมเปญ" value={campaignId} onChange={setCampaignId} options={campaigns.map(c => ({ value: c.id, label: c.name }))} />} />
      : <section className="workspace-empty"><h2>ยังไม่มีแคมเปญ</h2><Button href={routes.createCampaign}>สร้างแคมเปญ</Button></section>}
  </main></div>;
}

// One event, guests only: how many are coming, who you call yourself, and who the bot calls again.
// Groups come from each guest's latest call on the campaign's current version, the same rule as the campaign screen.
function EventSummary({ campaign, picker }: { campaign: CampaignDraft; picker: ReactNode }) {
  const [items, setItems] = useState<Attempt[] | null>(null), [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  // The campaign's schedule, when one is set: the bot then calls on its own and the page can stay closed.
  const [schedule, setSchedule] = useState<{ status: string; run_at: string; next_run_at?: string | null } | null>(null);
  useEffect(() => {
    let active = true, busy = false;
    async function load() {
      if (busy) return; busy = true; setLoading(true);
      try {
        if (!supabase) throw Error('ยังเชื่อมต่อฐานข้อมูลไม่ได้');
        const all: Attempt[] = [];
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await supabase.from('voice_call_requests').select('id,call_id,destination,status,created_at,metadata,response').eq('metadata->>campaign_id', campaign.id).order('created_at').order('id').range(offset, offset + 499);
          if (error) throw Error('โหลดผลไม่ได้ กดรีเฟรชเพื่อลองใหม่');
          if (!active) return;
          all.push(...data as Attempt[]);
          if (data.length < 500) break;
        }
        if (active) { setItems(all); setUpdatedAt(new Date().toISOString()); setError(''); }
        // The schedule is extra: without it the counts still stand.
        void botnoiFetch<{ job: typeof schedule }>(`/workspace/campaigns/${campaign.id}/schedule`).then(r => { if (active) setSchedule(r.job); }).catch(() => {});
      } catch (e) { if (active) setError((e as Error).message); }
      finally { busy = false; if (active) setLoading(false); }
    }
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [campaign.id, revision]);

  const latest = new Map((latestContactCalls(items || [], campaign.updatedAt, campaign.csv.rows.length) as Attempt[]).map(a => [a.metadata.contact_row!, a]));
  const name = nameColumn(campaign);
  const guests = campaign.csv.rows.map((cells, row) => { const attempt = latest.get(row); return { row, attempt, bucket: guestBucket(attempt), name: cells[name]?.trim() || `แถว ${row + 1}` }; });
  const count = (b: GuestBucket) => guests.filter(g => g.bucket === b).length;
  const staff = guests.filter(g => g.bucket === 'staff'), redial = guests.filter(g => g.bucket === 'redial');
  const shown = (n: number) => items ? n.toLocaleString('th-TH') : '—';
  const countdown = eventCountdown(campaign);
  const link = (query = '') => `${routes.campaignCall(campaign.id)}${query}`;
  const list = (title: string, people: typeof guests, footer: ReactNode, actions: (g: typeof guests[number]) => ReactNode) => <section className="rd-card rd-pad staff-list" aria-label={title}>
    <h2 className="rd-section-title">{title} ({people.length.toLocaleString('th-TH')})</h2>
    <ul>{people.slice(0, PREVIEW).map(g => { const result = callResultDisplay(g.attempt!), said = effectiveOutcome(g.attempt!.response).evidence; return <li key={g.row}>
      <div className="staff-list__who"><strong>{g.name}</strong> <span className="result-badge" data-result={result.key}>{result.label}</span>{said && <span className="rd-table__sub">“{said}”</span>}</div>
      <div className="staff-list__actions">{actions(g)}</div>
    </li>; })}</ul>
    {footer && <p className="staff-list__more">{footer}</p>}
  </section>;

  return <>
    <section className="rd-filters" aria-label="แคมเปญ">
      {picker}
      <span className="rd-filters__end"><span className="rd-muted" role="status">{updatedAt ? `อัปเดต ${new Date(updatedAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', timeStyle: 'short' })} น.` : 'กำลังโหลด…'}</span><Button size="compact" variant="secondary" disabled={loading} onClick={() => setRevision(v => v + 1)}>รีเฟรช</Button></span>
    </section>
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    <section className="rd-card rd-pad guest-summary" aria-label="มากี่คน" aria-busy={!items}>
      <div className="guest-summary__head">
        <div><p className="guest-summary__count"><strong>{shown(count('confirmed'))}</strong> / {guests.length.toLocaleString('th-TH')} แขก</p>
          <p className="guest-summary__label">มางาน{picker ? '' : ` · ${campaign.name}`}</p></div>
        {countdown && <p className="guest-summary__event"><strong>{countdown}</strong><span>{eventLabel(campaign)}</span></p>}
      </div>
      {activeSchedule(schedule) && <p className="guest-summary__schedule">ตั้งเวลาโทรไว้ · รอบถัดไป {callTime(schedule!.next_run_at || schedule!.run_at)} น.</p>}
      <GuestBuckets count={count} total={guests.length} ready={!!items} />
      <a className="rd-link guest-summary__open" href={link()}>เปิดแคมเปญ →</a>
    </section>
    {items && staff.length > 0 && list('ต้องโทรหาเอง', staff, staff.length > PREVIEW && <a className="rd-link" href={link('&status=staff')}>ดูทั้งหมด ({staff.length.toLocaleString('th-TH')}) →</a>, g => <>
      <a className="rd-link" href={`tel:${g.attempt!.destination}`}>โทร {displayPhone(g.attempt!.destination)}</a>
      <a className="rd-link" href={link(`&row=${g.row}`)}>บันทึกผล</a>
    </>)}
    {items && !staff.length && <p className="rd-muted staff-list__none">ไม่มีใครต้องโทรหาเอง</p>}
    {items && redial.length > 0 && list('ต้องโทรซ้ำ', redial, <a className="rd-link" href={link('&status=redial')}>ดูคนที่ต้องโทรซ้ำ ({redial.length.toLocaleString('th-TH')}) →</a>, g => <a className="rd-link" href={link(`&row=${g.row}`)}>ดู</a>)}
  </>;
}
