import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { SmoothSelect } from './ui/smooth-select';
import { DatePicker, TimePicker } from './Pickers';
import { botnoiFetch } from '../services/botnoi/client';
import { activeSchedule, firstScheduleTime, scheduleLabel } from '../../shared/campaign-schedule.mjs';
import './CampaignSchedule.css';
type Job = {id:string;campaign_id:string;run_at:string;status:string;last_error:string|null;recurrence:'once'|'daily'|'weekly';weekdays:number[];local_time:string;redial:boolean;completed_runs:number;next_run_at?:string|null;max_attempts?:number};
const days=[{id:1,label:'จ.',name:'วันจันทร์'},{id:2,label:'อ.',name:'วันอังคาร'},{id:3,label:'พ.',name:'วันพุธ'},{id:4,label:'พฤ.',name:'วันพฤหัสบดี'},{id:5,label:'ศ.',name:'วันศุกร์'},{id:6,label:'ส.',name:'วันเสาร์'},{id:0,label:'อา.',name:'วันอาทิตย์'}];
const clockIcon=<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2" strokeLinecap="round"/></svg>;
function initialTime(){return new Date(Date.now()+8*3600000).toISOString().slice(0,16).split('T');}
export function CampaignSchedule({campaignId,onActive,configure=false,version,rows=null,total=0,pendingCount=total,disabled=false}:{campaignId:string;onActive?:(active:boolean)=>void;configure?:boolean;version?:string;rows?:number[]|null;total?:number;pendingCount?:number;disabled?:boolean}) {
  const [job,setJob]=useState<Job|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[ready,setReady]=useState(false);
  const [open,setOpen]=useState(false),[recurrence,setRecurrence]=useState<'once'|'daily'|'weekly'>('once');
  const [date,setDate]=useState(()=>initialTime()[0]),[time,setTime]=useState(()=>initialTime()[1]);
  const [weekdays,setWeekdays]=useState<number[]>([1,2,3,4,5]),[redial,setRedial]=useState(false);
  const [requestId,setRequestId]=useState(''),[formError,setFormError]=useState('');
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    let live=true;
    const load=()=>botnoiFetch<{job:Job|null;ready:boolean}>(`/workspace/campaigns/${campaignId}/schedule`).then(result=>{if(live){setJob(result.job);setReady(result.ready);onActive?.(activeSchedule(result.job));setError('');}}).catch(e=>{if(live){setError(e.message);setReady(false);}});
    void load();const timer=window.setInterval(()=>void load(),15000);
    return()=>{live=false;window.clearInterval(timer);};
  },[campaignId,onActive]);
  useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
  const next=firstScheduleTime({date,time,recurrence,weekdays});
  const count=redial?(rows===null?total:rows.length):pendingCount;
  // The worker re-checks a running job every minute; a later next_run_at means it is waiting for a retry to fall due.
  const retryAt=job?.status==='running'&&job.next_run_at&&Date.parse(job.next_run_at)-Date.now()>90000?job.next_run_at:null;
  const labels:Record<string,string>={scheduled:'ตั้งเวลาแล้ว',running:'กำลังโทรตามเวลา',completed:'โทรครบแล้ว',cancelled:'ยกเลิกการตั้งเวลาแล้ว',failed:'คิวหยุด · ต้องตรวจสอบ'};
  const repeatLabel=job?.recurrence==='daily'?'ทุกวัน':job?.recurrence==='weekly'?`ทุก${days.filter(d=>job.weekdays?.includes(d.id)).map(d=>d.label).join(' / ')}`:'ครั้งเดียว';
  function showSettings(){
    if(disabled || activeSchedule(job))return;
    // A redial scope has nobody left uncalled, so the only useful target is calling the chosen people again.
    const [day,hour]=initialTime();setDate(day);setTime(job?.local_time || hour);setRecurrence(job?.recurrence || 'once');setWeekdays(job?.weekdays?.length?job.weekdays:[1,2,3,4,5]);setRedial(rows!==null&&!pendingCount&&rows.length>0);setRequestId(crypto.randomUUID());setFormError('');setOpen(true);
  }
  async function cancel() {
    if(!job)return;setBusy(true);setError('');
    try {const result=await botnoiFetch<{job:Job}>(`/workspace/campaigns/${campaignId}/schedule`,{method:'POST',body:{action:'cancel',job_id:job.id}});setJob(result.job);onActive?.(false);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function save() {
    if(!next || !ready || !version || !count || busy)return;
    setBusy(true);setFormError('');
    try {
      const result=await botnoiFetch<{job:Job}>(`/workspace/campaigns/${campaignId}/schedule`,{method:'POST',body:{action:'configure',request_id:requestId,consent:true,campaign_version:version,contact_rows:rows,schedule:{date,time,recurrence,weekdays,redial}}});
      setJob(result.job);onActive?.(activeSchedule(result.job));setOpen(false);
    }catch(e){setFormError((e as Error).message);}finally{setBusy(false);}
  }
  if(!configure && !job)return error?<p className="workspace-alert">{error}</p>:null;
  const [hour,minute]=time.split(':').map(Number);
  const active=activeSchedule(job);
  // Idle on the campaign screen this is one button; the bar appears once a schedule exists (or failed).
  const bar=active || job?.status==='failed' || (!configure && job);
  const often=recurrence==='daily'?' ทุกวัน':recurrence==='weekly'?' ตามวันที่เลือก':'';
  return <>
    {bar&&job?<section className="campaign-schedule-bar" aria-label="ตั้งเวลาโทร">
      <span className="campaign-schedule-icon">{clockIcon}</span>
      <div className="campaign-schedule-copy"><strong>{retryAt?'รอโทรซ้ำ':labels[job.status]}</strong>{(retryAt||active)&&<p>{retryAt?`รอบถัดไปประมาณ ${scheduleLabel(retryAt)} น.`:`${repeatLabel} · ${scheduleLabel(job.run_at)} น.`}</p>}{job.status==='failed'&&<p role="alert">{job.last_error}</p>}</div>
      {active?<Button size="compact" variant="secondary" disabled={busy} onClick={cancel}>{busy?'กำลังยกเลิก…':'ยกเลิกการตั้งเวลา'}</Button>:configure?<Button size="compact" variant="secondary" disabled={disabled || busy} onClick={showSettings}>{clockIcon} ตั้งเวลาใหม่</Button>:null}
    </section>:configure?<Button variant="secondary" disabled={disabled || busy} onClick={showSettings}>{clockIcon} ตั้งเวลาโทร</Button>:null}
    {error&&<p className="workspace-alert" role="alert">{error}</p>}
    {configure&&<dialog ref={dialog} className="schedule-dialog" aria-labelledby="schedule-title" onCancel={e=>{e.preventDefault();if(!busy)setOpen(false);}} onClick={e=>{if(e.target===e.currentTarget&&!busy)setOpen(false);}}>
      <div className="schedule-dialog-content">
        <header><h2 id="schedule-title">ตั้งเวลาโทร</h2><button className="schedule-close" type="button" aria-label="ปิดการตั้งเวลา" disabled={busy} onClick={()=>setOpen(false)}>×</button></header>
        <fieldset className="schedule-frequency"><legend>ความถี่</legend><div>{([['once','ครั้งเดียว'],['daily','ทุกวัน'],['weekly','เลือกวัน']] as const).map(([value,label])=><label key={value} className={recurrence===value?'is-selected':''}><input type="radio" name="schedule-frequency" value={value} checked={recurrence===value} disabled={busy} onChange={()=>{setRecurrence(value);}}/>{label}</label>)}</div></fieldset>
        <div className="schedule-time-block">
          <svg className="schedule-clock-face" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46"/><path className="schedule-clock-ticks" d="M50 10v5 M90 50h-5 M50 90v-5 M10 50h5"/><line className="schedule-hour-hand" x1="50" y1="50" x2="50" y2="28" transform={`rotate(${((hour||0)%12)*30+(minute||0)/2} 50 50)`}/><line className="schedule-minute-hand" x1="50" y1="50" x2="50" y2="17" transform={`rotate(${(minute||0)*6} 50 50)`}/><circle className="schedule-clock-pin" cx="50" cy="50" r="3"/></svg>
          <div className="schedule-time-field"><span>เวลาโทร</span><TimePicker label="เวลาโทร (เวลาไทย)" value={time} disabled={busy} onChange={v=>{setTime(v);}}/></div>
        </div>
        <div className="schedule-date"><span>{recurrence==='once'?'วันที่โทร':'เริ่มตั้งแต่วันที่'}</span><DatePicker label="วันที่โทร" value={date} disabled={busy} onChange={v=>{setDate(v);}}/></div>
        {recurrence==='weekly'&&<fieldset className="schedule-weekdays"><legend>วันที่โทรซ้ำ</legend><div>{days.map(day=><button type="button" key={day.id} aria-label={day.name} aria-pressed={weekdays.includes(day.id)} disabled={busy} onClick={()=>{setWeekdays(old=>old.includes(day.id)?old.filter(v=>v!==day.id):[...old,day.id]);}}>{day.label}</button>)}</div></fieldset>}
        <label className="schedule-target"><span>โทรใคร</span><SmoothSelect value={redial?'all':'pending'} disabled={busy} onChange={v=>{setRedial(v==='all');}} options={[{value:'pending',label:`${rows===null?'คน':'คนที่เลือกและ'}ที่ยังไม่โทร (${pendingCount})`},{value:'all',label:rows===null?`ทุกคน รวมคนที่โทรแล้ว (${total})`:`ทุกคนที่เลือก รวมคนที่โทรแล้ว (${rows.length})`}]}/></label>
        {!count&&<p className="workspace-note">ไม่มีคนที่ยังไม่โทร เลือก “รวมคนที่โทรแล้ว” ถ้าจะโทรอีกครั้ง</p>}
        {/* Retry rules live in backend/scheduler.go (retryKind); 3 attempts is the max_attempts default in 202610280001_campaign_retries.sql. */}
        <div className="schedule-next" role="status"><span>รอบแรก</span><strong>{next?`${scheduleLabel(next)} น.`:'เลือกวันและเวลาในอนาคต'}</strong><details><summary>กติกาการโทรซ้ำ</summary><small>ปิดเว็บได้ ระบบโทรซ้ำคนที่ไม่รับสาย ติดต่อไม่ได้ ขอให้โทรกลับ หรือวางสายก่อนตอบ สูงสุด 3 ครั้งต่อคน เฉพาะ 09:00–20:00 น.</small></details></div>
        {redial&&<p className="workspace-alert">จะโทรหาคนที่โทรแล้วอีกครั้ง{recurrence!=='once'?'ทุกรอบ':''}</p>}
        {!ready&&<p className="workspace-alert" role="alert">ระบบตั้งเวลายังไม่พร้อม ยังกดโทรเองได้</p>}
        {formError&&<p className="workspace-alert" role="alert">{formError}</p>}
        <footer><Button size="compact" variant="secondary" disabled={busy} onClick={()=>setOpen(false)}>ยกเลิก</Button><Button size="compact" disabled={busy||!next||!ready||!count} onClick={save}>{busy?'กำลังบันทึก…':`ตั้งเวลาโทร ${count} คน${often}`}</Button></footer>
      </div>
    </dialog>}
  </>;
}
