import { useEffect, useState } from 'react';
import { Button } from './Button';
import { SmoothSelect } from './ui/smooth-select';
import { callTime, getCampaigns } from '../lib/campaigns';
import { supabase } from '../lib/supabase';
import { routes } from '../routes';
import { effectiveOutcome, type Outcome } from '../../shared/call-results.mjs';
import { callResultDisplay, displayLabels, displayPhone } from '../../shared/call-display.mjs';
import { shownStatus } from '../../shared/campaign-queue.mjs';

type Attempt = {
  id: string; call_id: string | null; destination: string; status: string; created_at: string;
  metadata: { campaign_id?: string; campaign_name?: string; campaign_version?: string; contact_row?: number; variables?: Record<string,string> };
  response: { review?: Outcome; callback?: { outcome: Outcome }; followup?: { outcome: Outcome; failure_reason?: string | null; final?: boolean } } | null;
};
const labels: Record<string,string> = { completed:'จบสาย',queued:'เข้าคิว',ringing:'กำลังเรียกสาย','in-progress':'กำลังคุย',failed:'โทรไม่สำเร็จ',busy:'สายไม่ว่าง','no-answer':'ไม่รับสาย',cancelled:'ยกเลิก',canceled:'ยกเลิก',unknown:'ยังไม่รู้สถานะ',submitting:'กำลังส่งคำขอ' };
const PAGE_SIZE=10;

function Stat({label,tone,value,share}:{label:string;tone:'ok'|'bad'|'staff';value:string;share:number}) {
  return <article className="rd-card rd-stat"><span className={`rd-chip rd-chip--${tone}`}>{label}</span><p className="rd-stat__value">{value}</p><div className={`rd-bar rd-bar--${tone}`} role="img" aria-label={`${share}% ของสายทั้งหมด`}><span style={{width:`${share}%`}}/></div></article>;
}

// Every campaign call in a period, redials included: the usage view. Per-guest answers live on the dashboard and campaign screen.
export function CampaignCallLog() {
  const campaigns=getCampaigns();
  const [campaignId,setCampaignId]=useState('all'), [days,setDays]=useState(7);
  const [items,setItems]=useState<Attempt[]>([]), [loading,setLoading]=useState(true), [error,setError]=useState('');
  const [updatedAt,setUpdatedAt]=useState(''), [page,setPage]=useState(0), [filter,setFilter]=useState('all');
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
          if(error)throw Error('โหลดประวัติการโทรไม่ได้ กดรีเฟรชเพื่อลองใหม่');
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
  },[campaignId,days]);
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
    <h2 className="rd-section-title">การโทรจากแคมเปญ</h2>
    <div className="rd-filters">
      <SmoothSelect aria-label="แคมเปญ" value={campaignId} onChange={v=>{setCampaignId(v);setPage(0);}} options={[{value:'all',label:'ทุกแคมเปญ'},...campaigns.map(c=>({value:c.id,label:c.name}))]}/>
      <div className="rd-segment" role="group" aria-label="ช่วงเวลา">{([[7,'7 วัน'],[30,'30 วัน'],[0,'ทั้งหมด']] as const).map(([d,label])=><button key={d} type="button" aria-pressed={days===d} onClick={()=>{setDays(d);setPage(0);}}>{label}</button>)}</div>
    </div>
    {error&&<p className="workspace-alert" role="alert">{error}</p>}
    <section className="rd-stats" aria-label="สรุปการโทรจากแคมเปญ" aria-busy={loading}>
      <article className="rd-card rd-card--tint rd-stat"><span className="rd-chip rd-chip--info">สายทั้งหมด</span><p className="rd-stat__value">{value(total)}</p></article>
      <Stat label={displayLabels.CONFIRMED} tone="ok" value={value(counts.CONFIRMED)} share={share(counts.CONFIRMED)}/>
      <Stat label={displayLabels.DECLINED} tone="bad" value={value(counts.DECLINED)} share={share(counts.DECLINED)}/>
      <Stat label={displayLabels.REQUEST_AGENT} tone="staff" value={value(needingAgent)} share={share(needingAgent)}/>
    </section>
    {updatedAt&&total>0&&<section className="rd-card rd-pad rd-stack" aria-label="ผลของทุกสาย">
      <div className="rd-bar" style={{height:10,gap:2}} role="img" aria-label={breakdown.map(([key,count])=>`${displayLabels[key]} ${count}`).join(', ')}>{breakdown.map(([key,count])=><span key={key} style={{width:`${count/total*100}%`,background:color(key)}}/>)}</div>
      <ul className="rd-legend">{breakdown.map(([key,count])=><li key={key}><i style={{background:color(key)}}/>{displayLabels[key]} ({count})</li>)}</ul>
    </section>}
    <section className="rd-card rd-table-card" aria-label="ประวัติการโทรจากแคมเปญ">
      <div className="rd-table-card__head"><SmoothSelect aria-label="กรองผล" value={filter} onChange={v=>{setFilter(v);setPage(0);}} options={[{value:'all',label:'ทุกผล'},...Object.entries(displayLabels).map(([key,label])=>({value:key,label}))]}/></div>
      {loading&&!updatedAt?<p className="rd-empty" role="status">กำลังโหลด…</p>:!updatedAt?<p className="rd-empty">ยังแสดงประวัติไม่ได้</p>:!visible.length?<p className="rd-empty">ไม่พบสายตามตัวกรองนี้</p>:<div className="rd-table-wrap"><table className="rd-table rd-table--cards"><thead><tr><th>แขก</th><th>แคมเปญ</th><th>เวลา</th><th>ผล</th><th><span className="sr-only">รายละเอียด</span></th></tr></thead><tbody>{visible.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(a=>{
        const shown=callResultDisplay(a), campaign=campaigns.find(c=>c.id===a.metadata.campaign_id);
        return <tr key={a.id}><td><strong>{a.metadata.variables?.applicant_name||a.metadata.variables?.guest_name||a.metadata.variables?.name||displayPhone(a.destination)}</strong><span className="rd-table__sub">{displayPhone(a.destination)}</span></td><td className="rd-cell--half" data-label="แคมเปญ">{campaign?.name||a.metadata.campaign_name||'—'}</td><td className="rd-cell--half" data-label="เวลา">{callTime(a.created_at)}<span className="rd-table__sub">{labels[shownStatus(a.status,a.response?.followup?.failure_reason)]||'ยังไม่รู้สถานะ'}</span></td><td className="rd-cell--half" data-label="ผล"><span className="result-badge" data-result={shown.key}>{shown.label}</span></td><td className="rd-cell--half" style={{textAlign:'right'}}>{campaign&&<a className="rd-link" href={`${routes.campaignCall(campaign.id)}&request=${encodeURIComponent(a.id)}`}>รายละเอียด</a>}</td></tr>;
      })}</tbody></table></div>}
      {updatedAt&&<nav className="rd-table-foot" aria-label="หน้าประวัติการโทร"><span>{visible.length.toLocaleString()} สาย</span><div><Button size="compact" variant="secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)}>ก่อนหน้า</Button><span aria-live="polite">หน้า {page+1} / {pages}</span><Button size="compact" variant="secondary" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>ถัดไป</Button></div></nav>}
    </section>
  </>;
}
