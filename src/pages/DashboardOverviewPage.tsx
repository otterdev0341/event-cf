import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { getCampaigns } from '../lib/campaigns';
import { supabase } from '../lib/supabase';
import { routes } from '../routes';
import { effectiveOutcome, outcomeLabels, type Outcome } from '../../shared/call-results.mjs';

type Attempt = {
  id: string; call_id: string | null; destination: string; status: string; created_at: string;
  metadata: { campaign_id?: string; campaign_name?: string; contact_row?: number; variables?: Record<string,string> };
  response: { review?: Outcome; callback?: { outcome: Outcome }; followup?: { outcome: Outcome } } | null;
};
const labels: Record<string,string> = { completed:'จบสาย',queued:'เข้าคิว',ringing:'กำลังเรียกสาย','in-progress':'กำลังสนทนา',failed:'โทรไม่สำเร็จ',busy:'สายไม่ว่าง','no-answer':'ไม่รับสาย',cancelled:'ยกเลิก',canceled:'ยกเลิก',unknown:'รอตรวจสอบ',submitting:'กำลังส่งคำขอ' };
const displayDate = (value:string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}) : '—';
const sourceLabel = (value:string) => value==='manual'?'ผู้ใช้ตรวจและบันทึก':value==='agent_tool'?'Agent ส่งผลผ่าน Tool':value==='provider'?'ผลจากบริการ Voice Bot':'ยังไม่มีผลตอบรับ';
const PAGE_SIZE=10;
const BARS=64;
const RANGES=[{days:7,label:'7 วัน'},{days:30,label:'30 วัน'},{days:0,label:'ทั้งหมด'}];
const initials=(name:string)=>name.replace(/[^\p{L}\p{N}]/gu,'').slice(0,2).toUpperCase()||'#';

/** Counts toward `target` with an exponential ease-out; snaps when reduced motion is on. */
function useCountUp(target:number,ready:boolean){
  const [shown,setShown]=useState(0);
  useEffect(()=>{
    if(!ready)return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setShown(target);return;}
    let frame=0,from=0;
    setShown(current=>(from=current));
    const start=performance.now();
    const tick=(now:number)=>{
      const t=Math.min((now-start)/800,1);
      setShown(Math.round(from+(target-from)*(t===1?1:1-2**(-10*t))));
      if(t<1)frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[target,ready]);
  return shown;
}

/** Splits BARS between outcomes by share (largest remainder) so the spectrum always sums to BARS. */
function spectrum(counts:Record<string,number>,total:number){
  if(!total)return [];
  const rows=Object.entries(counts).filter(([,n])=>n>0).map(([key,n])=>({key,exact:n/total*BARS,n:Math.max(1,Math.floor(n/total*BARS))}));
  let spare=BARS-rows.reduce((sum,r)=>sum+r.n,0);
  for(const r of [...rows].sort((x,y)=>(y.exact-Math.floor(y.exact))-(x.exact-Math.floor(x.exact)))){if(spare<=0)break;r.n++;spare--;}
  for(let i=rows.length-1;spare<0&&i>=0;i--)if(rows[i].n>1){rows[i].n--;spare++;}
  return rows.flatMap(r=>Array.from({length:r.n},()=>r.key));
}

function Stat({label,value,ready,tone}:{label:string;value:number;ready:boolean;tone?:string}){
  const shown=useCountUp(value,ready);
  return <div className="ov-stat" data-result={tone}><dt>{label}</dt><dd className={ready?'':'ov-skeleton'}>{ready?shown.toLocaleString('th-TH'):'0000'}</dd></div>;
}

export function DashboardOverviewPage() {
  const campaigns=getCampaigns();
  const [campaignId,setCampaignId]=useState('all'), [days,setDays]=useState(7);
  return <div className="dashboard-page"><AppHeader/><main className="dashboard-main page-shell"><div className="ov">
    <header className="ov-head">
      <div><h1>ภาพรวมการโทร</h1><p>ใครตอบรับเข้าร่วมงานแล้วบ้าง และใครที่ต้องติดตามต่อ</p></div>
      <div className="ov-controls">
        <div className="ov-range" role="group" aria-label="ช่วงเวลา">{RANGES.map(r=><button key={r.days} type="button" aria-pressed={days===r.days} onClick={()=>setDays(r.days)}>{r.label}</button>)}</div>
        <label className="ov-select"><span className="ov-visually-hidden">แคมเปญ</span><select value={campaignId} onChange={e=>setCampaignId(e.target.value)}><option value="all">ทุกแคมเปญ</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
    </header>
    <CampaignOverview key={`${campaignId}:${days}`} campaignId={campaignId} days={days}/>
  </div></main></div>;
}

function CampaignOverview({campaignId,days}:{campaignId:string;days:number}) {
  const campaigns=getCampaigns();
  const [items,setItems]=useState<Attempt[]>([]), [loading,setLoading]=useState(true), [error,setError]=useState('');
  const [updatedAt,setUpdatedAt]=useState(''), [revision,setRevision]=useState(0), [page,setPage]=useState(0);
  const [filter,setFilter]=useState('all'), [hot,setHot]=useState<string|null>(null);
  useEffect(()=>{
    let active=true,busy=false;
    async function load(){
      if(busy)return; busy=true;
      try{
        if(!supabase)throw Error('ยังเชื่อมต่อฐานข้อมูลไม่ได้');
        const end=new Date().toISOString(),start=new Date(Date.now()-days*86400000).toISOString();
        const all:Attempt[]=[];
        for(let offset=0;;offset+=500){
          let query=supabase.from('voice_call_requests').select('id,call_id,destination,status,created_at,metadata,response').not('metadata->>campaign_id','is',null).lte('created_at',end).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+499);
          if(days)query=query.gte('created_at',start);
          if(campaignId!=='all')query=query.eq('metadata->>campaign_id',campaignId);
          const {data,error}=await query;
          if(error)throw Error('โหลดประวัติแคมเปญไม่ได้ กรุณากดรีเฟรชข้อมูล');
          if(!active)return;
          all.push(...data as Attempt[]);
          if(data.length<500)break;
        }
        if(active){setItems(all);setUpdatedAt(new Date().toISOString());setError('');}
      }catch(e){if(active)setError((e as Error).message);}
      finally{busy=false;if(active)setLoading(false);}
    }
    void load();
    const refresh=()=>{if(!document.hidden)void load();};
    const timer=window.setInterval(refresh,15000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[campaignId,days,revision]);
  const counts=Object.fromEntries(Object.keys(outcomeLabels).map(key=>[key,items.filter(a=>effectiveOutcome(a.response).call_result===key).length]));
  const needingAgent=items.filter(a=>effectiveOutcome(a.response).needs_agent===true).length;
  const visible=items.filter(a=>filter==='all'||effectiveOutcome(a.response).call_result===filter);
  const pages=Math.max(1,Math.ceil(visible.length/PAGE_SIZE));
  useEffect(()=>setPage(p=>Math.min(p,pages-1)),[pages]);
  const ready=!!updatedAt;
  const bars=useMemo(()=>spectrum(counts,items.length),[items]);
  const rate=items.length?Math.round(counts.CONFIRMED/items.length*100):0;
  const setOutcome=(key:string)=>{setFilter(key);setPage(0);};
  return <>
    <div className="ov-status" role="status"><span className={`ov-live${loading?' ov-live--busy':''}`} aria-hidden="true"/><span>{loading&&!ready?'กำลังโหลดข้อมูล…':ready?`อัปเดต ${displayDate(updatedAt)} · ตรวจใหม่ทุก 15 วินาที`:''}</span><button type="button" className="ov-refresh" disabled={loading} onClick={()=>{setLoading(true);setRevision(v=>v+1);}} aria-label="รีเฟรชข้อมูล"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg></button></div>
    {error&&<p className="ov-alert" role="alert">{error}{ready?' · กำลังแสดงข้อมูลเดิมที่โหลดสำเร็จล่าสุด':''}</p>}

    <section className="ov-panel ov-voice" aria-label="ผลตอบรับแคมเปญ" aria-busy={loading}>
      <div className="ov-voice__top">
        <p className="ov-voice__lead"><strong>{ready?`${rate}%`:'—'}</strong><span>ของสายทั้งหมดตอบรับเข้าร่วมงาน</span></p>
        <dl className="ov-stats">
          <Stat label="คำขอโทรทั้งหมด" value={items.length} ready={ready}/>
          <Stat label="ตอบตกลง" value={counts.CONFIRMED} ready={ready} tone="CONFIRMED"/>
          <Stat label="ปฏิเสธ" value={counts.DECLINED} ready={ready} tone="DECLINED"/>
          <Stat label="ต้องการเจ้าหน้าที่" value={needingAgent} ready={ready} tone="REQUEST_AGENT"/>
        </dl>
      </div>
      <div className="ov-spectrum" role="img" aria-label={ready?Object.entries(counts).map(([key,count])=>`${outcomeLabels[key as keyof typeof outcomeLabels]} ${count}`).join(', '):'ยังไม่มีข้อมูล'} data-empty={!bars.length}>
        {(bars.length?bars:Array.from({length:BARS},()=>'EMPTY')).map((key,i)=><i key={`${items.length}-${i}`} className="ov-bar" data-result={key} style={{'--h':`${28+72*Math.abs(Math.sin(i*1.9)*Math.cos(i*.63))}%`,'--i':i,opacity:hot&&hot!==key?.22:1} as CSSProperties}/>)}
      </div>
      <ul className="ov-legend" aria-label="กรองประวัติตามผลตอบรับ">
        <li><button type="button" aria-pressed={filter==='all'} onClick={()=>setOutcome('all')}>ทั้งหมด <b>{ready?items.length.toLocaleString('th-TH'):'—'}</b></button></li>
        {Object.entries(outcomeLabels).map(([key,label])=><li key={key}><button type="button" data-result={key} aria-pressed={filter===key} disabled={!ready||!counts[key]} onMouseEnter={()=>setHot(key)} onMouseLeave={()=>setHot(null)} onFocus={()=>setHot(key)} onBlur={()=>setHot(null)} onClick={()=>setOutcome(key)}><span className="ov-dot"/>{label} <b>{ready?counts[key].toLocaleString('th-TH'):'—'}</b></button></li>)}
      </ul>
    </section>

    {ready&&counts.UNDETERMINED>0&&<aside className="ov-nudge"><p><strong>{counts.UNDETERMINED.toLocaleString('th-TH')} สาย</strong> ยังไม่มีข้อสรุป · “จบสาย” คือสถานะการโทร ส่วนคำตอบจะขึ้นเมื่อ Agent ส่งผลหรือคุณบันทึกผลที่ตรวจแล้ว</p><Button size="compact" variant="secondary" href={routes.campaigns}>ไปยังแคมเปญ</Button></aside>}

    <section className="ov-panel ov-log" aria-labelledby="recent-activity-title">
      <header><div><h2 id="recent-activity-title">ประวัติการโทรจากแคมเปญ</h2><p>ล่าสุดก่อน · นับทุกคำขอ รวมการโทรซ้ำและแคมเปญเวอร์ชันก่อนหน้า</p></div>{filter!=='all'&&<button type="button" className="ov-clear" onClick={()=>setOutcome('all')}>ล้างตัวกรอง: {outcomeLabels[filter as keyof typeof outcomeLabels]} ✕</button>}</header>
      {loading&&!ready?<div aria-hidden="true">{Array.from({length:5},(_,i)=><div key={i} className="ov-skeleton ov-row-skeleton"/>)}</div>
      :!ready?<p className="ov-empty">ยังแสดงประวัติไม่ได้ กรุณาลองรีเฟรชข้อมูล</p>
      :!visible.length?<p className="ov-empty">ไม่พบประวัติการโทรตามตัวกรองนี้ ลองเลือกทุกแคมเปญหรือขยายช่วงเวลา</p>
      :<div className="ov-table"><table><thead><tr><th>ผู้ติดต่อ</th><th>แคมเปญ</th><th>เวลา</th><th>สถานะสาย</th><th>ผลตอบรับ</th><th>เจ้าหน้าที่</th><th><span className="ov-visually-hidden">รายละเอียด</span></th></tr></thead><tbody>{visible.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map((a,i)=>{
        const result=effectiveOutcome(a.response), campaign=campaigns.find(c=>c.id===a.metadata.campaign_id);
        const name=a.metadata.variables?.applicant_name||a.metadata.variables?.guest_name||a.metadata.variables?.name||a.destination;
        return <tr key={a.id} style={{'--i':i} as CSSProperties}><td><div className="ov-person"><span className="ov-avatar" data-result={result.call_result} aria-hidden="true">{initials(name)}</span><div><strong>{name}</strong><small>{a.destination}</small></div></div></td><td>{campaign?.name||a.metadata.campaign_name||'แคมเปญที่ไม่มีในรายการปัจจุบัน'}{Number.isInteger(a.metadata.contact_row)&&<small>แถว {a.metadata.contact_row!+1}</small>}</td><td className="ov-time">{displayDate(a.created_at)}</td><td><span className="ov-call-status">{labels[a.status]||'รอตรวจสอบ'}</span></td><td><span className="ov-pill" data-result={result.call_result}><span className="ov-dot"/>{outcomeLabels[result.call_result as keyof typeof outcomeLabels]||'รอตรวจสอบ'}</span><small>{sourceLabel(result.source)}</small></td><td>{result.needs_agent===null?'ยังไม่ทราบ':result.needs_agent?'ต้องการ':'ไม่ต้องการ'}</td><td>{campaign?<Button size="compact" variant="secondary" href={`${routes.campaignCall(campaign.id)}&request=${encodeURIComponent(a.id)}#call-results`}>ดูรายละเอียด</Button>:<small>ไม่อยู่ในรายการที่บันทึก</small>}</td></tr>;
      })}</tbody></table></div>}
      {ready&&<nav className="ov-pager" aria-label="หน้าประวัติการโทร"><p>{visible.length.toLocaleString('th-TH')} ครั้ง</p><div><button type="button" disabled={page===0} onClick={()=>setPage(p=>p-1)}>ย้อนกลับ</button><span aria-live="polite">หน้า {page+1} / {pages}</span><button type="button" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>ถัดไป</button></div></nav>}
    </section>
  </>;
}
