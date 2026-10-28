import { useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { SmoothSelect } from '../components/ui/smooth-select';
import { getCampaigns } from '../lib/campaigns';
import { supabase } from '../lib/supabase';
import { routes } from '../routes';
import { effectiveOutcome, type Outcome } from '../../shared/call-results.mjs';
import { callResultDisplay, displayLabels } from '../../shared/call-display.mjs';
import { shownStatus } from '../../shared/campaign-queue.mjs';

type Attempt = {
  id: string; call_id: string | null; destination: string; status: string; created_at: string;
  metadata: { campaign_id?: string; campaign_name?: string; contact_row?: number; variables?: Record<string,string> };
  response: { review?: Outcome; callback?: { outcome: Outcome }; followup?: { outcome: Outcome; failure_reason?: string | null } } | null;
};
const labels: Record<string,string> = { completed:'จบสาย',queued:'เข้าคิว',ringing:'กำลังเรียกสาย','in-progress':'กำลังสนทนา',failed:'โทรไม่สำเร็จ',busy:'สายไม่ว่าง','no-answer':'ไม่รับสาย',cancelled:'ยกเลิก',canceled:'ยกเลิก',unknown:'รอตรวจสอบ',submitting:'กำลังส่งคำขอ' };
const displayDate = (value:string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}) : '—';
const sourceLabel = (value:string) => value==='manual'?'ผู้ใช้ตรวจและบันทึก':value==='agent_tool'?'Agent ส่งผลผ่าน Tool':value==='provider'?'ผลจากบริการ Voice Bot':'ยังไม่มีผลตอบรับ';
const PAGE_SIZE=10;

export function DashboardOverviewPage() {
  const campaigns=getCampaigns();
  const [campaignId,setCampaignId]=useState('all'), [days,setDays]=useState(7);
  return <div className="dashboard-page"><AppHeader/><main className="dashboard-main page-shell">
    <header className="rd-head"><div><span className="ui-kicker">CAMPAIGN OVERVIEW</span><h1>ภาพรวมการโทร</h1><p>ติดตามการโทรและคำตอบของผู้ติดต่อจากแคมเปญในบัญชีของคุณ</p></div><div className="rd-head__actions"><Button href={routes.createCampaign}>+ สร้างแคมเปญ</Button></div></header>
    <section className="rd-filters" aria-label="ตัวกรองภาพรวม">
      <SmoothSelect aria-label="แคมเปญ" value={campaignId} onChange={setCampaignId} options={[{value:'all',label:'ทุกแคมเปญ'},...campaigns.map(c=>({value:c.id,label:c.name}))]}/>
      <div className="rd-segment" role="group" aria-label="ช่วงเวลา">{([[7,'7 วัน'],[30,'30 วัน'],[0,'ทุกช่วงเวลา']] as const).map(([d,label])=><button key={d} type="button" aria-pressed={days===d} onClick={()=>setDays(d)}>{label}</button>)}</div>
    </section>
    <CampaignOverview key={`${campaignId}:${days}`} campaignId={campaignId} days={days}/>
  </main></div>;
}

function Stat({label,tone,value,share}:{label:string;tone:'ok'|'bad'|'warn';value:string;share:number}) {
  return <article className="rd-card rd-stat"><span className={`rd-chip rd-chip--${tone}`}>{label}</span><p className="rd-stat__value">{value}</p><div className={`rd-bar rd-bar--${tone}`} role="img" aria-label={`${share}% ของคำขอโทรทั้งหมด`}><span style={{width:`${share}%`}}/></div></article>;
}

function CampaignOverview({campaignId,days}:{campaignId:string;days:number}) {
  const campaigns=getCampaigns();
  const [items,setItems]=useState<Attempt[]>([]), [loading,setLoading]=useState(true), [error,setError]=useState('');
  const [updatedAt,setUpdatedAt]=useState(''), [revision,setRevision]=useState(0), [page,setPage]=useState(0);
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
    void load();
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
  const colors:Record<string,string>={CONFIRMED:'#0db98a',DECLINED:'#f04452',CALLBACK_REQUESTED:'#edaa36',REQUEST_AGENT:'#7451e8',WRONG_PERSON:'#5873a5',NO_ANSWER:'#b0a4cd',ENDED_WITHOUT_RESULT:'#9aa0b4',UNDETERMINED:'#c5c7d4'};
  const total=items.length, share=(n:number)=>total?Math.round(n/total*100):0;
  const breakdown=Object.entries(counts).filter(([,count])=>count>0);
  return <>
    <div className="rd-filters" style={{justifyContent:'flex-end'}}><Button size="compact" variant="secondary" disabled={loading} onClick={()=>{setLoading(true);setRevision(v=>v+1);}}>รีเฟรชข้อมูล</Button></div>
    {error&&<p className="workspace-alert" role="alert">{error}{updatedAt?' · กำลังแสดงข้อมูลเดิมที่โหลดสำเร็จล่าสุด':''}</p>}
    <section className="rd-stats" aria-label="สรุปการโทรจากแคมเปญ" aria-busy={loading}>
      <article className="rd-card rd-card--tint rd-stat"><span className="rd-chip rd-chip--info">คำขอโทรทั้งหมด</span><p className="rd-stat__value">{value(total)}</p><p className="rd-stat__note">{days?`${days} วันที่ผ่านมา`:'ทุกช่วงเวลา'} · นับทุกครั้ง รวมการโทรซ้ำ</p></article>
      <Stat label="ตอบตกลง" tone="ok" value={value(counts.CONFIRMED)} share={share(counts.CONFIRMED)}/>
      <Stat label="ปฏิเสธ" tone="bad" value={value(counts.DECLINED)} share={share(counts.DECLINED)}/>
      <Stat label="ต้องการเจ้าหน้าที่" tone="warn" value={value(needingAgent)} share={share(needingAgent)}/>
    </section>
    <div className="rd-banner">
      <div className="rd-banner__body"><span className="rd-banner__icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 8v5M12 16h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/></svg></span><p><strong>{value(counts.UNDETERMINED)}</strong> สายยังไม่มีข้อสรุป<small>“จบสาย” เป็นสถานะการโทร คำตอบจะแสดงเมื่อ Agent ส่งผลหรือคุณบันทึกผลที่ตรวจสอบแล้ว</small></p></div>
      <a className="rd-link" href={routes.campaigns}>ติดตามคำตอบที่ยังไม่ครบ →</a>
    </div>
    {updatedAt&&total>0&&<section className="rd-card rd-pad rd-stack" aria-label="ผลตอบรับแคมเปญ">
      <h2 className="rd-section-title">ผลตอบรับจากการโทร</h2>
      <div className="rd-bar" style={{height:10,gap:2}} role="img" aria-label={breakdown.map(([key,count])=>`${displayLabels[key]} ${count}`).join(', ')}>{breakdown.map(([key,count])=><span key={key} style={{width:`${count/total*100}%`,background:colors[key]}}/>)}</div>
      <ul className="rd-legend">{breakdown.map(([key,count])=><li key={key}><i style={{background:colors[key]}}/>{displayLabels[key]} ({count})</li>)}</ul>
      <p className="rd-stat__note">นับทุกคำขอโทรตามตัวกรอง รวมการโทรซ้ำและแคมเปญเวอร์ชันก่อนหน้า ผลล่าสุดต่อคนดูได้ในหน้าแคมเปญ</p>
    </section>}
    <section className="rd-card rd-table-card" aria-labelledby="recent-activity-title">
      <div className="rd-table-card__head"><div><h2 id="recent-activity-title">ประวัติการโทรจากแคมเปญ</h2><span className="rd-muted">เรียงครั้งล่าสุดก่อน แยกสถานะสายออกจากคำตอบของผู้รับ</span></div>
        <SmoothSelect aria-label="ผลตอบรับ" value={filter} onChange={v=>{setFilter(v);setPage(0);}} options={[{value:'all',label:'ทุกผลตอบรับ'},...Object.entries(displayLabels).map(([key,label])=>({value:key,label}))]}/></div>
      {loading&&!updatedAt?<p className="rd-empty" role="status">กำลังโหลดประวัติ…</p>:!updatedAt?<p className="rd-empty">ยังแสดงประวัติไม่ได้ กรุณาลองรีเฟรชข้อมูล</p>:!visible.length?<p className="rd-empty">ไม่พบประวัติการโทรตามตัวกรองนี้ เลือกทุกแคมเปญหรือขยายช่วงเวลาเพื่อดูรายการอื่น</p>:<div className="rd-table-wrap"><table className="rd-table"><thead><tr><th>ผู้ติดต่อ</th><th>แคมเปญ</th><th>เวลาส่งคำขอ</th><th>สถานะสาย</th><th>ผลตอบรับ</th><th>เจ้าหน้าที่</th><th><span className="sr-only">รายละเอียด</span></th></tr></thead><tbody>{visible.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(a=>{
        const result=effectiveOutcome(a.response), shown=callResultDisplay(a), campaign=campaigns.find(c=>c.id===a.metadata.campaign_id);
        return <tr key={a.id}><td><strong>{a.metadata.variables?.applicant_name||a.metadata.variables?.guest_name||a.metadata.variables?.name||a.destination}</strong><span className="rd-table__sub">{a.destination}</span></td><td>{campaign?.name||a.metadata.campaign_name||'แคมเปญที่ไม่มีในรายการปัจจุบัน'}{Number.isInteger(a.metadata.contact_row)&&<span className="rd-table__sub">แถว {a.metadata.contact_row!+1}</span>}</td><td>{displayDate(a.created_at)}</td><td><span className="rd-chip rd-chip--plain">{labels[shownStatus(a.status,a.response?.followup?.failure_reason)]||'รอตรวจสอบ'}</span></td><td><span className="result-badge" data-result={shown.key}>{shown.label}</span><span className="rd-table__sub">{sourceLabel(result.source)}</span></td><td>{result.needs_agent===null?'ยังไม่ทราบ':result.needs_agent?'ต้องการ':'ไม่ต้องการ'}</td><td style={{textAlign:'right'}}>{campaign?<a className="rd-link" href={`${routes.campaignCall(campaign.id)}&request=${encodeURIComponent(a.id)}#call-results`}>ดูรายละเอียดสาย</a>:<span className="rd-table__sub">แคมเปญนี้ไม่อยู่ในรายการที่บันทึกแล้ว</span>}</td></tr>;
      })}</tbody></table></div>}
      {updatedAt&&<nav className="rd-table-foot" aria-label="หน้าประวัติการโทร"><span>{visible.length} ครั้ง</span><div><Button size="compact" variant="secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)}>ย้อนกลับ</Button><span aria-live="polite">หน้า {page+1} / {pages}</span><Button size="compact" variant="secondary" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>ถัดไป</Button></div></nav>}
    </section>
  </>;
}
