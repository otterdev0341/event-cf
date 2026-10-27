import { useEffect, useState } from 'react';
import { StatusBadge } from './StatusBadge';
import { Button } from './Button';
import { useAgentDetail } from '../hooks/useBotnoiData';
import { supabase } from '../lib/supabase';
import type { CampaignDraft } from '../lib/campaigns';
import { prepareCampaignRows } from '../../shared/campaign-inputs.mjs';
import { latestContactCalls } from '../../shared/call-results.mjs';
import { terminalCall, type CampaignAttempt } from '../../shared/campaign-queue.mjs';

type Status = { label: string; tone: 'neutral'|'success'|'warning'|'primary'; description: string };
export function CampaignStatus({ campaign }: { campaign: CampaignDraft }) {
  const detail = useAgentDetail(campaign.agentId);
  const [history, setHistory] = useState<CampaignAttempt[] | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true, busy = false;
    setHistory(null); setError(false);
    async function load() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        if (!supabase) throw Error('No database');
        const attempts: CampaignAttempt[] = [];
        for (let offset = 0; ; offset += 500) {
          const {data,error} = await supabase.from('voice_call_requests')
            .select('id,call_id,status,created_at,metadata')
            .eq('metadata->>campaign_id', campaign.id)
            .eq('metadata->>campaign_version', campaign.updatedAt)
            .order('created_at',{ascending:false}).order('id').range(offset,offset+499);
          if (error) throw error;
          if (!alive) return;
          attempts.push(...data as CampaignAttempt[]);
          if (data.length < 500) break;
        }
        if (alive) { setHistory(attempts); setError(false); }
      } catch { if (alive) setError(true); }
      finally { busy = false; }
    }
    void load();
    const timer = window.setInterval(()=>void load(),15000);
    const focus = ()=>void load();
    window.addEventListener('focus',focus); document.addEventListener('visibilitychange',focus);
    return ()=>{ alive=false; window.clearInterval(timer); window.removeEventListener('focus',focus); document.removeEventListener('visibilitychange',focus); };
  },[campaign.id,campaign.updatedAt,revision]);
  const latest = latestContactCalls(history || [],campaign.updatedAt,campaign.csv.rows.length);
  const ended = latest.filter(a=>terminalCall(a.status)).length;
  const unresolved = latest.some(a=>!terminalCall(a.status));
  const prepared = prepareCampaignRows(campaign,detail.variables);
  let status: Status;
  if (error) status={label:'ตรวจสถานะไม่ได้',tone:'warning',description:'แคมเปญบันทึกแล้ว แต่โหลดประวัติการโทรไม่สำเร็จ กรุณาลองใหม่'};
  else if (!history) status={label:'กำลังตรวจสถานะ',tone:'neutral',description:'กำลังอ่านประวัติการโทรของแคมเปญนี้'};
  else if (unresolved) status={label:'มีสายรอตรวจสถานะ',tone:'primary',description:`จบสายแล้ว ${ended}/${campaign.csv.rows.length} รายชื่อ · เปิดหน้าโทรเพื่อตรวจสายที่ยังไม่จบหรือยังไม่ทราบสถานะ`};
  else if (latest.length && ended === campaign.csv.rows.length) status={label:'โทรครบแล้ว',tone:'success',description:`จบการโทรครบ ${ended} รายชื่อ · รวมสายไม่รับและโทรไม่สำเร็จ ดูผลตอบรับรายคนในหน้าแคมเปญ`};
  else if (latest.length) status={label:'โทรแล้วบางส่วน',tone:'primary',description:`จบสายแล้ว ${ended}/${campaign.csv.rows.length} รายชื่อ · เลือกโทรรายชื่อที่เหลือหรือดูผลเดิมได้`};
  else if (!campaign.agentId) status={label:'รอเลือก Agent',tone:'warning',description:'บันทึกแคมเปญแล้ว เลือก Agent และจับคู่ข้อมูลก่อนเริ่มโทร'};
  else if (detail.loading) status={label:'กำลังตรวจข้อมูล',tone:'neutral',description:'กำลังตรวจ Agent และข้อมูลรายชื่อก่อนโทร'};
  else if (detail.error || !detail.agent) status={label:'รอตรวจการเชื่อมต่อ',tone:'warning',description:'ยังยืนยันข้อมูล Agent ไม่ได้ กรุณาตรวจบัญชี Voice Bot แล้วลองใหม่'};
  else if (prepared.errors.length || prepared.rows.some(row=>row.errors.length)) status={label:'ต้องแก้ข้อมูล',tone:'warning',description:'ตรวจ Agent การจับคู่คอลัมน์ และข้อมูล CSV ให้ครบก่อนเริ่มโทร'};
  else status={label:'พร้อมโทร',tone:'success',description:'ข้อมูลรายชื่อและ Agent ครบแล้ว กด “โทร / ดูผลแคมเปญ” แล้วเลือกรายชื่อและยืนยันเริ่มโทร'};
  const total = campaign.csv.rows.length;
  return <div className="campaign-lifecycle" aria-live="polite"><StatusBadge size="campaign" tone={status.tone}>{status.label}</StatusBadge><p>{status.description}</p>{history&&total>0&&<div className="rd-progress"><div className="rd-progress__label"><span>โทรจบแล้ว</span><span>{ended.toLocaleString()} / {total.toLocaleString()}</span></div><div className="rd-bar" role="progressbar" aria-label="โทรจบแล้ว" aria-valuemin={0} aria-valuemax={total} aria-valuenow={ended}><span style={{width:`${ended/total*100}%`}}/></div></div>}{(error||detail.error)&&<Button size="compact" variant="secondary" onClick={()=>{setRevision(v=>v+1);detail.refetch();}}>ตรวจสถานะอีกครั้ง</Button>}</div>;
}
