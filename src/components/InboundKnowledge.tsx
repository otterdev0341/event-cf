import { useEffect, useState } from 'react';
import { Button } from './Button';
import { botnoiFetch } from '../services/botnoi/client';

interface EventInfo { id: string; name: string; event_date: string; event_time: string; location: string; details: string; enabled: boolean; public_enabled: boolean; updated_at: string; contact_count: number }
interface EventCatalog { account_id: string; events: EventInfo[]; automatic_lookup_ready: boolean; context_notice: string }
interface LookupResult { call_id: string; caller_number: string | null; status: 'matched' | 'choose_event' | 'no_match' | 'caller_unavailable'; events: Pick<EventInfo,'id' | 'name' | 'event_date' | 'event_time' | 'location' | 'details'>[] }

function EventEditor({ event, accountId, onSaved }: { event: EventInfo; accountId: string; onSaved: (value: EventInfo) => void }) {
  const [enabled, setEnabled] = useState(event.public_enabled);
  const [location, setLocation] = useState(event.location);
  const [details, setDetails] = useState(event.details);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => { setEnabled(event.public_enabled); setLocation(event.location); setDetails(event.details); setUncertain(false); }, [event]);
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await botnoiFetch<EventInfo>(`/workspace/inbound/events/${event.id}`, { method: 'POST', body: { account_id: accountId, enabled: event.enabled, public_enabled: enabled, location, details, expected_updated_at: event.updated_at } });
      onSaved(result); setMessage('บันทึกรายละเอียดงานแล้ว');
    } catch (err) { setError(err instanceof Error ? err.message : 'บันทึกไม่ได้'); setUncertain(true); }
    finally { setBusy(false); }
  }
  return <details className="inbound-event-editor"><summary><span><strong>{event.name}</strong><small>{event.event_date || 'ยังไม่ระบุวัน'} · {event.contact_count} รายชื่อ</small></span><span className="inbound-event-badge">{event.public_enabled ? 'บอทใช้ตอบข้อมูลทั่วไปได้' : 'ยังไม่เปิดข้อมูล'}</span></summary><div className="inbound-event-fields">
    <p className="workspace-note">ให้ข้อมูลเกี่ยวกับงานที่ลูกค้าสอบถามได้ เช่น เวลา สถานที่ การเดินทาง สิ่งที่ต้องเตรียม และช่องทางติดต่อ</p>
    <label htmlFor={`event-location-${event.id}`}>สถานที่<input id={`event-location-${event.id}`} value={location} maxLength={500} disabled={busy || uncertain} onChange={e => { setLocation(e.target.value); setMessage(''); }} /></label>
    <label htmlFor={`event-details-${event.id}`}>รายละเอียดที่ใช้ตอบลูกค้า<textarea id={`event-details-${event.id}`} rows={5} value={details} maxLength={4000} disabled={busy || uncertain} onChange={e => { setDetails(e.target.value); setMessage(''); }} placeholder="เพิ่มข้อเท็จจริงของงานนี้ บอทจะใช้ข้อความนี้ตอบคำถาม" /></label>
    <label className="inbound-consent"><input type="checkbox" checked={enabled} disabled={busy || uncertain} onChange={e => { setEnabled(e.target.checked); setMessage(''); }} />เปิดรายละเอียดงานนี้ให้บอทตอบผู้โทรทุกคน</label>
    <p className="workspace-note">ใส่เฉพาะข้อมูลทั่วไปของงานที่ให้ผู้โทรทุกคนทราบได้ เช่น วัน เวลา สถานที่ และการเดินทาง</p>
    {error && <p role="alert" className="workspace-alert">{error} กดรีเฟรชรายการงานด้านบนก่อนบันทึกอีกครั้ง</p>}
    {message && <p role="status" className="workspace-notice">{message}</p>}
    <Button size="compact" disabled={busy || uncertain || enabled && !details.trim()} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : 'บันทึกรายละเอียดงาน'}</Button>
  </div></details>;
}

export function InboundKnowledge({ callId }: { callId: string }) {
  const [catalog, setCatalog] = useState<EventCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void botnoiFetch<EventCatalog>('/workspace/inbound/events').then(value => { if (active) setCatalog(value); })
      .catch(err => { if (active) { setCatalog(null); setError(err instanceof Error ? err.message : 'อ่านรายการงานไม่ได้'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setLookup(null); setLookupError('');
    if (!callId) { setLookupLoading(false); return; }
    setLookupLoading(true);
    void botnoiFetch<LookupResult>('/workspace/inbound/lookup', { method: 'POST', body: { call_id: callId } }).then(value => { if (active) setLookup(value); })
      .catch(err => { if (active) setLookupError(err instanceof Error ? err.message : 'ค้นงานไม่ได้'); })
      .finally(() => { if (active) setLookupLoading(false); });
    return () => { active = false; };
  }, [callId, catalog]);
  return <section className="activity-section inbound-knowledge" id="inbound-knowledge"><div className="inbound-section-heading"><div><h2>ข้อมูลสำหรับบอทรับสาย</h2><p className="workspace-note">ผู้โทรบอกชื่องาน บอทค้นรายละเอียดที่คุณเปิดไว้ได้โดยไม่ต้องถามเบอร์</p></div><Button variant="secondary" size="compact" disabled={loading} onClick={() => setRevision(value => value + 1)}>รีเฟรชรายการงาน</Button></div>
    {loading ? <p role="status">กำลังอ่านรายการงาน…</p> : error ? <p role="alert" className="workspace-alert">{error}</p> : catalog && <>
      <div className="inbound-context-status"><strong>ตอบข้อมูลทั่วไปของทุกงาน</strong><p>เปิดข้อมูลของงานที่ต้องการด้านล่าง แล้วเชื่อมบอทรับสายกับข้อมูลทั่วไป บอทจะถามชื่องานและอ่านรายละเอียดล่าสุดจากเว็บนี้</p></div>
      {catalog.events.length ? catalog.events.map(event => <EventEditor key={event.id} event={event} accountId={catalog.account_id} onSaved={value => setCatalog(current => current ? { ...current, events: current.events.map(item => item.id === value.id ? value : item) } : current)} />) : <div className="workspace-empty"><h3>ยังไม่มีแคมเปญที่บันทึกแล้ว</h3><p>บันทึกแคมเปญพร้อมรายชื่อก่อน แล้วเพิ่มรายละเอียดงานที่นี่</p></div>}
    </>}
    {callId && <div className="inbound-lookup-result" aria-live="polite"><h3>งานที่ตรงกับผู้โทร</h3>{lookupLoading ? <p role="status">กำลังค้นจากเบอร์ในสายจริง…</p> : lookupError ? <p role="alert" className="workspace-alert">{lookupError}</p> : lookup && <><p className="workspace-note">เบอร์จากบริการ: {lookup.caller_number || 'ไม่ระบุ'} · ไม่ใช้เบอร์ที่พิมพ์แทน</p>{lookup.status === 'caller_unavailable' ? <p>บริการไม่ส่งเบอร์ผู้โทรที่ใช้ค้นได้</p> : lookup.status === 'no_match' ? <p>ยังไม่มีงานที่เปิดข้อมูลและมีเบอร์นี้อยู่ในรายชื่อ</p> : <>{lookup.status === 'choose_event' && <p>พบหลายงาน บอทต้องถามลูกค้าว่าต้องการสอบถามงานไหนก่อนตอบรายละเอียด</p>}{lookup.events.map(event => <article key={event.id}><h4>{event.name}</h4><p>{event.event_date} {event.event_time} · {event.location || 'ยังไม่ระบุสถานที่'}</p><p className="inbound-event-answer">{event.details}</p></article>)}</>}</>}</div>}
  </section>;
}
