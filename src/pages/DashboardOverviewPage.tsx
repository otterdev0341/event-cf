import { useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { SmoothSelect } from '../components/ui/smooth-select';
import { eventLabel, getCampaigns } from '../lib/campaigns';
import { supabase } from '../lib/supabase';
import { routes } from '../routes';
import { effectiveOutcome, latestContactCalls, type Outcome } from '../../shared/call-results.mjs';
import { callResultDisplay, displayLabels, needsFollowUp } from '../../shared/call-display.mjs';
import { shownStatus } from '../../shared/campaign-queue.mjs';

type Attempt = {
  id: string; call_id: string | null; destination: string; status: string; created_at: string;
  metadata: { campaign_id?: string; campaign_name?: string; campaign_version?: string; contact_row?: number; variables?: Record<string,string> };
  response: { review?: Outcome; callback?: { outcome: Outcome }; followup?: { outcome: Outcome; failure_reason?: string | null } } | null;
};
const labels: Record<string,string> = { completed:'จบสาย',queued:'เข้าคิว',ringing:'กำลังเรียกสาย','in-progress':'กำลังสนทนา',failed:'โทรไม่สำเร็จ',busy:'สายไม่ว่าง','no-answer':'ไม่รับสาย',cancelled:'ยกเลิก',canceled:'ยกเลิก',unknown:'รอตรวจสอบ',submitting:'กำลังส่งคำขอ' };
const displayDate = (value:string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}) : '—';
const sourceLabel = (value:string) => value==='manual'?'ผู้ใช้ตรวจและบันทึก':value==='agent_tool'?'Agent ส่งผลผ่าน Tool':value==='provider'?'ผลจากบริการ Voice Bot':'ยังไม่มีผลตอบรับ';
const PAGE_SIZE=10;

export function DashboardOverviewPage() {
  const campaigns=getCampaigns();
  const [campaignId,setCampaignId]=useState('all'), [days,setDays]=useState(7);
  // One refresh for the guest summary and the call history; the history reports when it last loaded.
  const [revision,setRevision]=useState(0), [status,setStatus]=useState({loading:true,updatedAt:''});
  return <div className="dashboard-page"><AppHeader/><main className="dashboard-main page-shell">
    <header className="rd-head"><div><h1>ภาพรวมการโทร</h1><p>แขกตอบรับกี่คน ใครยังต้องโทรตาม และประวัติการโทรของทุกแคมเปญ</p></div><div className="rd-head__actions"><Button href={routes.createCampaign}>+ สร้างแคมเปญ</Button></div></header>
    <section className="rd-filters" aria-label="ตัวกรองภาพรวม">
      <SmoothSelect aria-label="แคมเปญ" value={campaignId} onChange={setCampaignId} options={[{value:'all',label:'ทุกแคมเปญ'},...campaigns.map(c=>({value:c.id,label:c.name}))]}/>
      <span className="rd-filters__end"><span className="rd-muted" role="status">{status.updatedAt?`อัปเดต ${new Date(status.updatedAt).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',timeStyle:'short'})} น.`:'กำลังโหลด…'}</span><Button size="compact" variant="secondary" disabled={status.loading} onClick={()=>{setStatus(s=>({...s,loading:true}));setRevision(v=>v+1);}}>รีเฟรชข้อมูล</Button></span>
    </section>
    <GuestSummary campaignId={campaignId} revision={revision}/>
    <CampaignOverview key={campaignId} campaignId={campaignId} days={days} setDays={setDays} revision={revision} onStatus={setStatus}/>
  </main></div>;
}

function Stat({label,tone,value,share}:{label:string;tone:'ok'|'bad'|'warn';value:string;share:number}) {
  return <article className="rd-card rd-stat"><span className={`rd-chip rd-chip--${tone}`}>{label}</span><p className="rd-stat__value">{value}</p><div className={`rd-bar rd-bar--${tone}`} role="img" aria-label={`${share}% ของคำขอโทรทั้งหมด`}><span style={{width:`${share}%`}}/></div></article>;
}

// Per guest on each campaign's current version: the latest call of every contact, whatever the period filter.
// Follow-up uses the redial scope's rule, so the banner count is exactly who the linked page will call again.
function GuestSummary({campaignId,revision}:{campaignId:string;revision:number}) {
  const campaigns=getCampaigns().filter(c=>campaignId==='all'||c.id===campaignId);
  const ids=campaigns.map(c=>c.id).join(',');
  const [items,setItems]=useState<Attempt[]|null>(null), [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    void (async()=>{
      try{
        if(!supabase)throw Error('ยังเชื่อมต่อฐานข้อมูลไม่ได้');
        const all:Attempt[]=[];
        for(let offset=0;ids;offset+=500){
          const {data,error}=await supabase.from('voice_call_requests').select('id,call_id,destination,status,created_at,metadata,response').in('metadata->>campaign_id',ids.split(',')).order('created_at').order('id').range(offset,offset+499);
          if(error)throw Error('โหลดสรุปผลรายแขกไม่ได้ กรุณากดรีเฟรชข้อมูล');
          if(!active)return;
          all.push(...data as Attempt[]);
          if(data.length<500)break;
        }
        if(active){setItems(all);setError('');}
      }catch(e){if(active)setError((e as Error).message);}
    })();
    return()=>{active=false;};
  },[ids,revision]);
  if(!campaigns.length)return null;
  const rows=campaigns.map(c=>{
    const current=latestContactCalls((items||[]).filter(a=>a.metadata.campaign_id===c.id),c.updatedAt,c.csv.rows.length) as Attempt[];
    const count=(key:string)=>current.filter(a=>callResultDisplay(a).key===key).length;
    return {campaign:c,guests:c.csv.rows.length,confirmed:count('CONFIRMED'),declined:count('DECLINED'),followUp:current.filter(needsFollowUp).length};
  });
  const sum=(key:'guests'|'confirmed'|'declined'|'followUp')=>rows.reduce((n,r)=>n+r[key],0);
  const guests=sum('guests'), confirmed=sum('confirmed'), declined=sum('declined'), followUp=sum('followUp');
  const shown=(n:number)=>items?n.toLocaleString('th-TH'):'—';
  const single=campaigns.length===1?campaigns[0]:null, event=single?eventLabel(single):'';
  const width=(n:number)=>`${guests?n/guests*100:0}%`;
  return <>
    {error&&<p className="workspace-alert" role="alert">{error}</p>}
    <section className="rd-card rd-pad guest-summary" aria-label="สรุปผลรายแขก" aria-busy={!items}>
      <p className="guest-summary__count"><strong>{shown(confirmed)}</strong> / {guests.toLocaleString('th-TH')} แขก</p>
      <p className="guest-summary__label">ยืนยันมางานแล้ว · {single?single.name:`${campaigns.length} แคมเปญ`}{event&&<span className="rd-muted"> · {event}</span>}</p>
      <div className="rd-bar guest-summary__bar" role="img" aria-label={`ตอบตกลง ${confirmed} ปฏิเสธ ${declined} ต้องโทรตาม ${followUp} จาก ${guests} แขก`}>
        <span style={{width:width(confirmed),background:'var(--result-confirmed)'}}/><span style={{width:width(declined),background:'var(--result-declined)'}}/><span style={{width:width(followUp),background:'var(--result-callback_requested)'}}/>
      </div>
      <ul className="rd-legend"><li><i style={{background:'var(--result-confirmed)'}}/>ตอบตกลง {shown(confirmed)}</li><li><i style={{background:'var(--result-declined)'}}/>ปฏิเสธ {shown(declined)}</li><li><i style={{background:'var(--result-callback_requested)'}}/>ต้องโทรตาม {shown(followUp)}</li><li><i style={{background:'var(--result-undetermined)'}}/>ยังไม่โทรหรือผลอื่น {shown(guests-confirmed-declined-followUp)}</li></ul>
    </section>
    {items&&followUp>0&&<div className="rd-banner">
      <div className="rd-banner__body"><span className="rd-banner__icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 8v5M12 16h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/></svg></span><p><strong>{followUp.toLocaleString('th-TH')}</strong> แขกยังต้องโทรตาม<small>สายล่าสุดไม่รับสาย สายไม่ว่าง จบสายโดยไม่ได้คำตอบ หรือขอให้โทรกลับ</small></p></div>
      <ul className="guest-summary__links">{rows.filter(r=>r.followUp>0).map(r=><li key={r.campaign.id}><a className="rd-link" href={`${routes.campaignCall(r.campaign.id)}&scope=unanswered#call-selection`}>{single?'โทรตาม':r.campaign.name+' ·'} {r.followUp.toLocaleString('th-TH')} คน →</a></li>)}</ul>
    </div>}
  </>;
}

function CampaignOverview({campaignId,days,setDays,revision,onStatus}:{campaignId:string;days:number;setDays:(d:number)=>void;revision:number;onStatus:(s:{loading:boolean;updatedAt:string})=>void}) {
  const campaigns=getCampaigns();
  const [items,setItems]=useState<Attempt[]>([]), [loading,setLoading]=useState(true), [error,setError]=useState('');
  const [updatedAt,setUpdatedAt]=useState(''), [page,setPage]=useState(0);
  useEffect(()=>onStatus({loading,updatedAt}),[loading,updatedAt,onStatus]);
  const [filter,setFilter]=useState('all');
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
    setLoading(true);void load();
    const refresh=()=>{if(!document.hidden)void load();};
    const timer=window.setInterval(refresh,15000);
    window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
  },[campaignId,days,revision]);
  const counts=Object.fromEntries(Object.keys(displayLabels).map(key=>[key,items.filter(a=>callResultDisplay(a).key===key).length]));
  const needingAgent=items.filter(a=>effectiveOutcome(a.response).needs_agent===true).length;
  const visible=items.filter(a=>filter==='all'||callResultDisplay(a).key===filter);
  const pages=Math.max(1,Math.ceil(visible.length/PAGE_SIZE));
  useEffect(()=>setPage(p=>Math.min(p,pages-1)),[pages]);
  const value=(n:number)=>!updatedAt?'—':n.toLocaleString('th-TH');
  const color=(key:string)=>`var(--result-${key.toLowerCase()})`;
  const total=items.length, share=(n:number)=>total?Math.round(n/total*100):0;
  const breakdown=Object.entries(counts).filter(([,count])=>count>0);
  return <>
    <div className="rd-filters rd-filters--split"><h2 className="rd-section-title">การโทรในช่วงเวลา</h2><div className="rd-segment" role="group" aria-label="ช่วงเวลา">{([[7,'7 วัน'],[30,'30 วัน'],[0,'ทุกช่วงเวลา']] as const).map(([d,label])=><button key={d} type="button" aria-pressed={days===d} onClick={()=>setDays(d)}>{label}</button>)}</div></div>
    {error&&<p className="workspace-alert" role="alert">{error}{updatedAt?' · กำลังแสดงข้อมูลเดิมที่โหลดสำเร็จล่าสุด':''}</p>}
    <section className="rd-stats" aria-label="สรุปการโทรจากแคมเปญ" aria-busy={loading}>
      <article className="rd-card rd-card--tint rd-stat"><span className="rd-chip rd-chip--info">คำขอโทรทั้งหมด</span><p className="rd-stat__value">{value(total)}</p><p className="rd-stat__note">{days?`${days} วันที่ผ่านมา`:'ทุกช่วงเวลา'} · นับทุกครั้ง รวมการโทรซ้ำ</p></article>
      <Stat label="ตอบตกลง" tone="ok" value={value(counts.CONFIRMED)} share={share(counts.CONFIRMED)}/>
      <Stat label="ปฏิเสธ" tone="bad" value={value(counts.DECLINED)} share={share(counts.DECLINED)}/>
      <Stat label="ต้องการเจ้าหน้าที่" tone="warn" value={value(needingAgent)} share={share(needingAgent)}/>
    </section>
    {updatedAt&&total>0&&<section className="rd-card rd-pad rd-stack" aria-label="ผลตอบรับแคมเปญ">
      <h2 className="rd-section-title">ผลตอบรับจากการโทร</h2>
      <div className="rd-bar" style={{height:10,gap:2}} role="img" aria-label={breakdown.map(([key,count])=>`${displayLabels[key]} ${count}`).join(', ')}>{breakdown.map(([key,count])=><span key={key} style={{width:`${count/total*100}%`,background:color(key)}}/>)}</div>
      <ul className="rd-legend">{breakdown.map(([key,count])=><li key={key}><i style={{background:color(key)}}/>{displayLabels[key]} ({count})</li>)}</ul>
      <p className="rd-stat__note">นับทุกคำขอโทรตามตัวกรอง รวมการโทรซ้ำและแคมเปญเวอร์ชันก่อนหน้า ผลล่าสุดต่อคนดูได้ในหน้าแคมเปญ</p>
    </section>}
    <section className="rd-card rd-table-card" aria-labelledby="recent-activity-title">
      <div className="rd-table-card__head"><div><h2 id="recent-activity-title">ประวัติการโทรจากแคมเปญ</h2><span className="rd-muted">เรียงครั้งล่าสุดก่อน แยกสถานะสายออกจากคำตอบของผู้รับ</span></div>
        <SmoothSelect aria-label="ผลตอบรับ" value={filter} onChange={v=>{setFilter(v);setPage(0);}} options={[{value:'all',label:'ทุกผลตอบรับ'},...Object.entries(displayLabels).map(([key,label])=>({value:key,label}))]}/></div>
      {loading&&!updatedAt?<p className="rd-empty" role="status">กำลังโหลดประวัติ…</p>:!updatedAt?<p className="rd-empty">ยังแสดงประวัติไม่ได้ กรุณาลองรีเฟรชข้อมูล</p>:!visible.length?<p className="rd-empty">ไม่พบประวัติการโทรตามตัวกรองนี้ เลือกทุกแคมเปญหรือขยายช่วงเวลาเพื่อดูรายการอื่น</p>:<div className="rd-table-wrap"><table className="rd-table rd-table--cards"><thead><tr><th>ผู้ติดต่อ</th><th>แคมเปญ</th><th>เวลาส่งคำขอ</th><th>สถานะสาย</th><th>ผลตอบรับ</th><th>เจ้าหน้าที่</th><th><span className="sr-only">รายละเอียด</span></th></tr></thead><tbody>{visible.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(a=>{
        const result=effectiveOutcome(a.response), shown=callResultDisplay(a), campaign=campaigns.find(c=>c.id===a.metadata.campaign_id);
        return <tr key={a.id}><td><strong>{a.metadata.variables?.applicant_name||a.metadata.variables?.guest_name||a.metadata.variables?.name||a.destination}</strong><span className="rd-table__sub">{a.destination}</span></td><td className="rd-cell--half" data-label="แคมเปญ">{campaign?.name||a.metadata.campaign_name||'แคมเปญที่ไม่มีในรายการปัจจุบัน'}{Number.isInteger(a.metadata.contact_row)&&<span className="rd-table__sub">แถว {a.metadata.contact_row!+1}</span>}</td><td className="rd-cell--half" data-label="เวลาส่งคำขอ">{displayDate(a.created_at)}</td><td className="rd-cell--half" data-label="สถานะสาย"><span className="rd-chip rd-chip--plain">{labels[shownStatus(a.status,a.response?.followup?.failure_reason)]||'รอตรวจสอบ'}</span></td><td className="rd-cell--half" data-label="ผลตอบรับ"><span className="result-badge" data-result={shown.key}>{shown.label}</span><span className="rd-table__sub">{sourceLabel(result.source)}</span></td><td className="rd-cell--half" data-label="เจ้าหน้าที่">{result.needs_agent===null?'ยังไม่ทราบ':result.needs_agent?'ต้องการ':'ไม่ต้องการ'}</td><td className="rd-cell--half" style={{textAlign:'right'}}>{campaign?<a className="rd-link" href={`${routes.campaignCall(campaign.id)}&request=${encodeURIComponent(a.id)}#call-results`}>ดูรายละเอียดสาย</a>:<span className="rd-table__sub">แคมเปญนี้ไม่อยู่ในรายการที่บันทึกแล้ว</span>}</td></tr>;
      })}</tbody></table></div>}
      {updatedAt&&<nav className="rd-table-foot" aria-label="หน้าประวัติการโทร"><span>{visible.length} ครั้ง</span><div><Button size="compact" variant="secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)}>ย้อนกลับ</Button><span aria-live="polite">หน้า {page+1} / {pages}</span><Button size="compact" variant="secondary" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>ถัดไป</Button></div></nav>}
    </section>
  </>;
}
