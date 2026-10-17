import { useEffect, useState } from 'react';
import { Button } from './Button';
import { botnoiFetch } from '../services/botnoi/client';
import { activeSchedule, scheduleLabel } from '../../shared/campaign-schedule.mjs';
type Job = {id:string;campaign_id:string;run_at:string;status:string;last_error:string|null};
export function CampaignSchedule({campaignId,onActive}:{campaignId:string;onActive?:(active:boolean)=>void}) {
  const [job,setJob]=useState<Job|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    let live=true;
    const load=()=>botnoiFetch<{job:Job|null}>(`/workspace/campaigns/${campaignId}/schedule`).then(result=>{if(live){setJob(result.job);onActive?.(activeSchedule(result.job));setError('');}}).catch(e=>{if(live)setError(e.message);});
    void load();const timer=window.setInterval(()=>void load(),15000);
    return()=>{live=false;window.clearInterval(timer);};
  },[campaignId,onActive]);
  async function cancel() {
    if(!job)return;setBusy(true);setError('');
    try {const result=await botnoiFetch<{job:Job}>(`/workspace/campaigns/${campaignId}/schedule`,{method:'POST',body:{action:'cancel',job_id:job.id}});setJob(result.job);onActive?.(false);}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  if(!job)return error?<p className="workspace-alert">{error}</p>:null;
  const labels:Record<string,string>={scheduled:'รอถึงเวลาโทร',running:'กำลังดำเนินคิวอัตโนมัติ',completed:'ดำเนินคิวครบแล้ว',cancelled:'ยกเลิกคิวแล้ว',failed:'คิวหยุด · ต้องตรวจสอบ'};
  return <section className="workspace-notice" aria-label="คิวโทรอัตโนมัติ"><strong>{labels[job.status] || job.status}</strong><p>เริ่ม {scheduleLabel(job.run_at)} น. · เวลาไทย</p>{activeSchedule(job)&&<><p>ปิดเว็บหรือปิดคอมได้ ระบบตรวจคิวทุกนาทีและรอจบสายก่อนโทรคนถัดไป</p><Button size="compact" variant="secondary" disabled={busy} onClick={cancel}>{busy?'กำลังยกเลิก…':'ยกเลิกคิวที่เหลือ'}</Button><small>สายที่ส่งคำขอไปแล้วอาจยังทำงานต่อ</small></>}{job.last_error&&<p role="alert">{job.last_error} ตรวจการเชื่อมต่อแล้วเปิดหน้าโทรเพื่อดำเนินคิวที่เหลือต่อได้</p>}{error&&<p role="alert">{error}</p>}</section>;
}
