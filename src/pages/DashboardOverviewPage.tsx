import { useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { MetricCard } from '../components/MetricCard';
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

export function DashboardOverviewPage() {
  const campaigns=getCampaigns();
  const [campaignId,setCampaignId]=useState('all'), [days,setDays]=useState(7);
  return <div className="dashboard-page"><AppHeader/><main className="dashboard-main page-shell">
    <header className="dashboard-title"><span className="ui-kicker">CAMPAIGN OVERVIEW</span><h1>ภาพรวมการโทร</h1><p>ติดตามการโทรและคำตอบของผู้ติดต่อจากแคมเปญในบัญชีของคุณ</p></header>
    <section className="report-filters" aria-label="ตัวกรองภาพรวม">
      <label>แคมเปญ<select className="workspace-select" value={campaignId} onChange={e=>setCampaignId(e.target.value)}><option value="all">ทุกแคมเปญ</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>ช่วงเวลา<select className="workspace-select" value={days} onChange={e=>setDays(Number(e.target.value))}><option value={7}>7 วันที่ผ่านมา</option><option value={30}>30 วันที่ผ่านมา</option><option value={0}>ทุกช่วงเวลา</option></select></label>
    </section>
    <CampaignOverview key={`${campaignId}:${days}`} campaignId={campaignId} days={days}/>
  </main></div>;
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
  const counts=Object.fromEntries(Object.keys(outcomeLabels).map(key=>[key,items.filter(a=>effectiveOutcome(a.response).call_result===key).length]));
  const needingAgent=items.filter(a=>effectiveOutcome(a.response).needs_agent===true).length;
  const visible=items.filter(a=>filter==='all'||effectiveOutcome(a.response).call_result===filter);
  const pages=Math.max(1,Math.ceil(visible.length/PAGE_SIZE));
  useEffect(()=>setPage(p=>Math.min(p,pages-1)),[pages]);
  const value=(n:number)=>!updatedAt?'—':n.toLocaleString('th-TH');
  const colors:Record<string,string>={CONFIRMED:'#0db98a',DECLINED:'#f04452',CALLBACK_REQUESTED:'#edaa36',REQUEST_AGENT:'#7451e8',WRONG_PERSON:'#5873a5',NO_ANSWER:'#b0a4cd',UNDETERMINED:'#c5c7d4'};
  let angle=0;
  const segments=Object.entries(counts).filter(([,count])=>count>0).map(([key,count])=>{const start=angle;angle+=count/items.length*360;return `${colors[key]} ${start}deg ${angle}deg`;});
  return <>
    <div className="report-update"><p>{loading?'กำลังโหลดข้อมูล…':updatedAt?`ข้อมูลที่บันทึกล่าสุด ${displayDate(updatedAt)} · ตรวจอัปเดตทุก 15 วินาทีขณะเปิดหน้านี้`:''}</p><Button size="compact" variant="secondary" disabled={loading} onClick={()=>{setLoading(true);setRevision(v=>v+1);}}>รีเฟรชข้อมูล</Button></div>
    {error&&<p className="workspace-alert" role="alert">{error}{updatedAt?' · กำลังแสดงข้อมูลเดิมที่โหลดสำเร็จล่าสุด':''}</p>}
    <section className="metric-grid" aria-label="สรุปการโทรจากแคมเปญ" aria-busy={loading}>
      <MetricCard label="คำขอโทรทั้งหมด" value={value(items.length)} description="นับทุกครั้ง รวมการโทรซ้ำ"/>
      <MetricCard label="ตอบตกลง" value={value(counts.CONFIRMED)} description="สายที่มีผลตอบรับว่าตกลง" tone="success"/>
      <MetricCard label="ปฏิเสธ" value={value(counts.DECLINED)} description="สายที่มีผลตอบรับว่าปฏิเสธ" tone="danger"/>
      <MetricCard label="ต้องการเจ้าหน้าที่" value={value(needingAgent)} description="สายที่ระบุว่าต้องการเจ้าหน้าที่" tone="warning"/>
    </section>
    <p className="workspace-note">ยอดสรุปและกราฟนับทุกคำขอโทรตามตัวกรอง รวมการโทรซ้ำและแคมเปญเวอร์ชันก่อนหน้า ผลล่าสุดต่อคนดูได้ในหน้าแคมเปญ</p>
    <section className="dashboard-visuals" aria-label="ผลตอบรับแคมเปญ">
      <article className="response-card report-response"><h2>ผลตอบรับจากการโทร</h2><div className="report-donut" role="img" aria-label={updatedAt?Object.entries(counts).map(([key,count])=>`${outcomeLabels[key]} ${count}`).join(', '):'ยังไม่มีข้อมูล'} style={{background:segments.length?`conic-gradient(${segments.join(', ')})`:'#e6e7ed'}}><div><span>ทั้งหมด</span><strong>{value(items.length)}</strong><span>ครั้ง</span></div></div>{updatedAt&&<ul className="response-legend">{Object.entries(counts).filter(([,count])=>count>0).map(([key,count])=><li key={key}><span className="response-legend__dot" style={{background:colors[key]}}/>{outcomeLabels[key]} ({count})</li>)}</ul>}</article>
      <article className="campaign-progress-card report-explanation"><h2>ติดตามคำตอบที่ยังไม่ครบ</h2><p><strong>{value(counts.UNDETERMINED)}</strong> สายยังไม่มีข้อสรุป</p><p>“จบสาย” เป็นสถานะการโทร ส่วนคำตอบว่าตกลงหรือปฏิเสธจะแสดงเมื่อ Agent ส่งผลหรือคุณบันทึกผลที่ตรวจสอบแล้ว</p><p className="workspace-note">เปิดรายละเอียดสายเพื่อตรวจผลจากบริการ และดูประวัติทุกครั้งของผู้ติดต่อ</p><Button size="compact" href={routes.campaigns}>ไปยังแคมเปญ</Button></article>
    </section>
    <section className="activity-section" aria-labelledby="recent-activity-title"><h2 id="recent-activity-title">ประวัติการโทรจากแคมเปญ</h2><p className="workspace-note">เรียงครั้งล่าสุดก่อน แยกสถานะสายออกจากคำตอบของผู้รับ</p>
      <label className="results-filter">ผลตอบรับ<select className="workspace-select" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="all">ทุกผลตอบรับ</option>{Object.entries(outcomeLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      {loading&&!updatedAt?<p role="status">กำลังโหลดประวัติ…</p>:!updatedAt?<p>ยังแสดงประวัติไม่ได้ กรุณาลองรีเฟรชข้อมูล</p>:!visible.length?<p className="workspace-note">ไม่พบประวัติการโทรตามตัวกรองนี้ เลือกทุกแคมเปญหรือขยายช่วงเวลาเพื่อดูรายการอื่น</p>:<div className="csv-preview"><table><thead><tr><th>ผู้ติดต่อ</th><th>แคมเปญ</th><th>เวลาส่งคำขอ</th><th>สถานะสาย</th><th>ผลตอบรับ</th><th>เจ้าหน้าที่</th><th>รายละเอียด</th></tr></thead><tbody>{visible.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE).map(a=>{
        const result=effectiveOutcome(a.response), campaign=campaigns.find(c=>c.id===a.metadata.campaign_id);
        return <tr key={a.id}><td><strong>{a.metadata.variables?.applicant_name||a.metadata.variables?.guest_name||a.metadata.variables?.name||a.destination}</strong><div>{a.destination}</div></td><td>{campaign?.name||a.metadata.campaign_name||'แคมเปญที่ไม่มีในรายการปัจจุบัน'}{Number.isInteger(a.metadata.contact_row)&&<small className="result-date">แถว {a.metadata.contact_row!+1}</small>}</td><td>{displayDate(a.created_at)}</td><td><span className="result-badge">{labels[a.status]||'รอตรวจสอบ'}</span></td><td><span className="result-badge" data-result={result.call_result}>{outcomeLabels[result.call_result]||'รอตรวจสอบ'}</span><small className="result-date">{sourceLabel(result.source)}</small></td><td>{result.needs_agent===null?'ยังไม่ทราบ':result.needs_agent?'ต้องการ':'ไม่ต้องการ'}</td><td>{campaign?<Button size="compact" variant="secondary" href={`${routes.campaignCall(campaign.id)}&request=${encodeURIComponent(a.id)}#call-results`}>ดูรายละเอียดสาย</Button>:<small>แคมเปญนี้ไม่อยู่ในรายการที่บันทึกแล้ว</small>}</td></tr>;
      })}</tbody></table></div>}
      {updatedAt&&<nav className="pagination" aria-label="หน้าประวัติการโทร"><p>{visible.length} ครั้ง</p><div className="pagination__controls"><button type="button" disabled={page===0} onClick={()=>setPage(p=>p-1)}>ย้อนกลับ</button><span aria-live="polite">หน้า {page+1} / {pages}</span><button type="button" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>ถัดไป</button></div></nav>}
    </section>
  </>;
}
