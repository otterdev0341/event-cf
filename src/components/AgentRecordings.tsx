import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { botnoiFetch, botnoiFetchBlob } from '../services/botnoi/client';
import { repairRecording } from '../lib/recordingRepair';
import './AgentRecordings.css';

type Recording = { id: string; file_time: string; part: number };
type Listing = { items: Recording[]; total: number; has_more: boolean };
type Player = { originalUrl: string; originalBlob: Blob; adjustedUrl?: string; originalSeconds?: number; adjustedSeconds?: number; mode: 'original' | 'adjusted'; recording: Recording };
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function weekStart() { return new Date(Date.parse(today()+'T00:00:00Z')-6*86400000).toISOString().slice(0,10); }
const fileTime = (value: string) => { const [date,time]=value.split(' '); const [year,month,day]=date.split('-'); return `${day}/${month}/${year} ${time}`; };

export function AgentRecordings({ agentId }: { agentId: string }) {
  const [start, setStart] = useState(weekStart);
  const [end, setEnd] = useState(today);
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [player, setPlayer] = useState<Player | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const request = useRef<AbortController | null>(null);
  const objectUrls = useRef<string[]>([]);
  const version = useRef(0);
  function releaseUrls() { objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current=[]; }
  function reset() { version.current++; request.current?.abort(); releaseUrls(); setPlayer(null); setListing(null); setLoading(false); setBusyId(''); setAdjusting(false); setError(''); }
  useEffect(() => { reset(); return () => { version.current++; request.current?.abort(); releaseUrls(); }; }, [agentId]);
  function query() { return new URLSearchParams({ start_date: start, end_date: end }); }
  async function list() {
    reset(); const current=version.current; const controller=new AbortController(); request.current=controller; setLoading(true);
    try { const result=await botnoiFetch<Listing>(`/workspace/agents/${agentId}/audio?${query()}`,{signal:controller.signal}); if (current===version.current) setListing(result); }
    catch (caught) { if (!controller.signal.aborted && current===version.current) setError(caught instanceof Error ? caught.message : 'โหลดรายการเสียงไม่ได้'); }
    finally { if (current===version.current) setLoading(false); }
  }
  async function load(recording: Recording) {
    request.current?.abort(); const controller=new AbortController(); request.current=controller; const current=++version.current;
    releaseUrls(); setPlayer(null); setAdjusting(false); setBusyId(recording.id); setError('');
    try { const blob=await botnoiFetchBlob(`/workspace/agents/${agentId}/audio/${recording.id}?${query()}`,{signal:controller.signal}); if (current!==version.current) return; if (!blob.size || !blob.type.startsWith('audio/')) throw Error('บริการไม่ส่งไฟล์เสียงที่เปิดฟังได้'); const originalUrl=URL.createObjectURL(blob); objectUrls.current.push(originalUrl); setPlayer({originalUrl,originalBlob:blob,mode:'original',recording}); }
    catch (caught) { if (!controller.signal.aborted && current===version.current) setError(caught instanceof Error ? caught.message : 'โหลดเสียงไม่ได้'); }
    finally { if (current===version.current) setBusyId(''); }
  }
  async function adjust() {
    if (!player || adjusting) return;
    setError('');
    if (player.adjustedUrl) { setPlayer({...player,mode:'adjusted'}); return; }
    request.current?.abort(); const controller=new AbortController(); request.current=controller; const current=++version.current; setAdjusting(true);
    try {
      const result=await repairRecording(player.originalBlob,controller.signal);
      if (current!==version.current) return;
      const adjustedUrl=URL.createObjectURL(new Blob([result.buffer],{type:'audio/wav'})); objectUrls.current.push(adjustedUrl);
      setPlayer({...player,adjustedUrl,originalSeconds:result.original_seconds,adjustedSeconds:result.adjusted_seconds,mode:'adjusted'});
    } catch (caught) { if (!controller.signal.aborted && current===version.current) setError(caught instanceof Error ? caught.message : 'ปรับเสียงไม่ได้'); }
    finally { if (current===version.current) setAdjusting(false); }
  }
  const playbackUrl=player?.mode==='adjusted'?player.adjustedUrl:player?.originalUrl;
  return <section className="activity-section agent-recordings" aria-label="บันทึกเสียงจาก Voice Bot">
    <header className="agent-recordings-heading"><div><span className="ui-kicker">VOICE RECORDINGS</span><h2>บันทึกเสียงจาก Voice Bot</h2><p className="workspace-note">ไฟล์ของ Agent ที่เลือก · เวลาในชื่อไฟล์ตามบริการ</p></div></header>
    <p className="workspace-note">รายการนี้แยกตามไฟล์ของบริการ ยังไม่ได้จับคู่กับผู้ติดต่อหรือ Call ID ในแคมเปญ</p>
    <div className="agent-recordings-filters"><label>วันที่เริ่ม<input type="date" value={start} onChange={e=>{reset();setStart(e.target.value);}} /></label><label>วันที่สิ้นสุด<input type="date" value={end} onChange={e=>{reset();setEnd(e.target.value);}} /></label><Button size="compact" variant="secondary" disabled={loading || Boolean(busyId) || !start || !end} onClick={()=>void list()}>{loading?'กำลังค้น…':'ค้นหาบันทึกเสียง'}</Button></div>
    {error && <p role="alert" className="workspace-alert">{error}</p>}
    {listing && <><p className="workspace-note">พบ {listing.total} บันทึก{listing.has_more?' · แสดง 100 รายการล่าสุด เลือกช่วงวันที่ให้แคบลงเพื่อดูรายการอื่น':''}</p>{listing.items.length ? <ul className="agent-recordings-list">{listing.items.map(item=><li key={item.id}><div><strong>{fileTime(item.file_time)}</strong><small>ส่วนที่ {item.part+1} · บันทึก {item.id.slice(0,8)}</small></div><Button size="compact" variant="secondary" disabled={Boolean(busyId)} onClick={()=>void load(item)}>{busyId===item.id?'กำลังโหลด…':player?.recording.id===item.id?'โหลดเสียงใหม่':'โหลดเสียง'}</Button></li>)}</ul> : <p className="workspace-note">ไม่พบบันทึกของ Agent นี้ในช่วงวันที่เลือก</p>}</>}
    {player && <div className="agent-recordings-player"><strong>บันทึก {fileTime(player.recording.file_time)} · ส่วนที่ {player.recording.part+1}</strong><div className="agent-recordings-modes" role="group" aria-label="รูปแบบเสียงที่ฟัง"><Button size="compact" variant={player.mode==='original'?'primary':'secondary'} aria-pressed={player.mode==='original'} disabled={adjusting} onClick={()=>{setPlayer({...player,mode:'original'});setError('');}}>ต้นฉบับจากบริการ</Button><Button size="compact" variant={player.mode==='adjusted'?'primary':'secondary'} aria-pressed={player.mode==='adjusted'} disabled={adjusting} onClick={()=>void adjust()}>{adjusting?'กำลังปรับเสียง…':'ปรับเสียงสำหรับฟัง'}</Button></div><p className="workspace-note">เลือกปรับเสียงเมื่อไฟล์มีเสียงซ่าแบบตัวอย่างที่ตรวจพบ ระบบจะถอดรหัสและจัดช่วงคำพูดใหม่เพื่อฟัง</p>{player.mode==='adjusted' && <p className="agent-recordings-adjustment" role="status">เสียงที่ปรับสำหรับฟัง · {player.originalSeconds?.toFixed(1)} → {player.adjustedSeconds?.toFixed(1)} วินาที · ความยาวนี้ไม่ใช่ระยะเวลาสายจริง</p>}<audio key={playbackUrl} controls preload="metadata" src={playbackUrl} aria-label={player.mode==='adjusted'?'ฟังเสียงที่ปรับแล้ว':'ฟังบันทึกเสียงต้นฉบับ'} onError={()=>setError('เบราว์เซอร์เปิดไฟล์เสียงนี้ไม่ได้ ลองโหลดเสียงใหม่')} /><a href={playbackUrl} download={`voice-${player.recording.id.slice(0,8)}-${player.mode}.wav`}>{player.mode==='adjusted'?'ดาวน์โหลดเสียงที่ปรับแล้ว':'ดาวน์โหลดไฟล์ต้นฉบับ'}</a></div>}
  </section>;
}
