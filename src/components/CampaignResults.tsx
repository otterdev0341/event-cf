import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { SmoothSelect } from './ui/smooth-select';
import { supabase } from '../lib/supabase';
import { callTime, type CampaignDraft } from '../lib/campaigns';
import { botnoiFetch } from '../services/botnoi/client';
import { effectiveOutcome, resultsCsv, latestContactCalls, type Outcome } from '../../shared/call-results.mjs';
import { callResultDisplay, displayLabels, talkSeconds, talkDuration, readableTranscript, displayPhone } from '../../shared/call-display.mjs';
import { shownStatus } from '../../shared/campaign-queue.mjs';
import { terminalCall } from '../../shared/campaign-queue.mjs';

type Followup={checked_at:string;answered_at:string|null;completed_at:string|null;ended_by:string|null;outcome:Outcome;transcript?:string;final?:boolean;failure_reason?:string|null};
// The backend sets followup.final once nothing more will arrive (result and conversation log, or the 30-minute window closed).
const needsCheck=(a:{call_id:string|null;status:string;created_at:string;response:{followup?:Followup}|null})=>!!a.call_id && (!terminalCall(a.status) || (!a.response?.followup?.final && Date.now()-Date.parse(a.created_at)<60*60000));
type Attempt={id:string;call_id:string|null;destination:string;status:string;created_at:string;metadata:{campaign_version?:string;contact_row?:number;variables?:Record<string,string>;record_conversation?:boolean};response:{review?:Outcome;callback?:{outcome:Outcome;received_at:string};followup?:Followup;transcript?:{text:string;source:string;received_at:string;call_id:string}}|null;warning?:string};
const statusLabels:Record<string,string>={completed:'จบสาย',queued:'เข้าคิว',ringing:'กำลังเรียกสาย','in-progress':'กำลังคุย',failed:'โทรไม่สำเร็จ',busy:'สายไม่ว่าง','no-answer':'ไม่รับสาย',cancelled:'ยกเลิก',canceled:'ยกเลิก',unknown:'ยังไม่รู้สถานะ',submitting:'กำลังส่งคำขอ'};
const sourceLabel=(value:string)=>value==='manual'?'ผู้ใช้ตรวจและบันทึก':value==='agent_tool'?'Agent ส่งผลผ่าน Tool':value==='provider'?'ผลจากบริการ Voice Bot':'ยังไม่มีผลจากบริการ';
// One result: who gave it, the answer, and why.
const resultNote=(title:string,outcome:Outcome,time?:string|null)=><div className="workspace-notice result-note"><strong>{title}</strong><p>{displayLabels[outcome.call_result]||displayLabels.UNDETERMINED}</p>{outcome.evidence&&<p>{outcome.evidence}</p>}{time&&<small>{callTime(time)}</small>}</div>;
// Every call of the campaign and one call's detail. It also fetches late results, so the campaign screen keeps it mounted.
export function CampaignResults({campaign,queueRunning,revision,onStatus,onOpenGuest}:{campaign:CampaignDraft;queueRunning:boolean;revision:number;onStatus?:(row:number,status:string,callId:string,response:Attempt['response'])=>void;onOpenGuest?:(row:number)=>void}) {
  const [items,setItems]=useState<Attempt[]>([]), [loading,setLoading]=useState(true), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const [syncing,setSyncing]=useState(false), [page,setPage]=useState(0), [selected,setSelected]=useState<string|null>(null), [filter,setFilter]=useState('all');
  const linkedRequest = useRef(new URLSearchParams(window.location.search).get('request'));
  const detailPanel = useRef<HTMLElement|null>(null);
  const alive=useRef(true), syncingRef=useRef(false), stopSync=useRef(false), itemsRef=useRef<Attempt[]>([]), onStatusRef=useRef(onStatus);
  onStatusRef.current=onStatus;
  function replace(updated:Attempt) { if(!alive.current)return;setItems(old=>{const next=old.map(a=>a.id===updated.id?updated:a);itemsRef.current=next;return next;});
    const newer=itemsRef.current.some(a=>a.id!==updated.id&&a.metadata.campaign_version===updated.metadata.campaign_version&&a.metadata.contact_row===updated.metadata.contact_row&&(Date.parse(a.created_at)>Date.parse(updated.created_at)||a.created_at===updated.created_at&&a.id>updated.id));
    if(!newer&&updated.metadata.campaign_version===campaign.updatedAt && Number.isInteger(updated.metadata.contact_row) && updated.call_id) onStatusRef.current?.(updated.metadata.contact_row!,shownStatus(updated.status,updated.response?.followup?.failure_reason),updated.call_id,updated.response);
  }
  const load=useCallback(async()=>{
    if(!supabase)return; const all:Attempt[]=[];
    for(let offset=0;;offset+=500){const {data,error}=await supabase.from('voice_call_requests').select('id,call_id,destination,status,created_at,metadata,response').eq('metadata->>campaign_id',campaign.id).order('created_at',{ascending:false}).order('id').range(offset,offset+499);if(error)throw Error('โหลดผลการโทรไม่ได้ กรุณาลองอีกครั้ง');all.push(...data as Attempt[]);if(data.length<500)break;}
    if(alive.current){itemsRef.current=all;setItems(all);setLoading(false);} return all;
  },[campaign.id]);
  async function refresh(list:Attempt[],quiet=false){
    if(syncingRef.current || queueRunning)return;syncingRef.current=true;stopSync.current=false;setSyncing(true);if(!quiet){setError('');setNotice('');}let failed=0,done=0;
    // Each check fans out to several Voice Bot requests; run a few at once instead of one after another.
    const queue=list.filter(item=>item.call_id);const worker=async()=>{for(let item=queue.shift();item;item=queue.shift()){if(!alive.current || stopSync.current)break;try{replace(await botnoiFetch<Attempt>(`/workspace/calls/${item.id}/result`));done++;}catch{failed++;}}};
    try{await Promise.all(Array.from({length:4},worker));
      if(alive.current){if(failed)setError(`ตรวจผลไม่ได้ ${failed} สาย กดรีเฟรชเพื่อลองใหม่`);else setError('');if(!quiet)setNotice(`อัปเดต ${done} สาย${stopSync.current?' · หยุดแล้ว':''}`);}
    } finally{syncingRef.current=false;if(alive.current)setSyncing(false);}
  }
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;stopSync.current=true;};},[]);
  useEffect(()=>{let active=true;setLoading(true);void load().then(data=>{if(active && data && !queueRunning)void refresh(data.filter(needsCheck).slice(0,25),true);}).catch(e=>{if(active){setError(e.message);setLoading(false);}});return()=>{active=false;};},[load,revision,queueRunning]);
  const current=latestContactCalls(items,campaign.updatedAt,campaign.csv.rows.length);
  const visible=items.filter(a=>filter==='all' || callResultDisplay(a).key===filter);
  const pageItems=visible.slice(page*25,page*25+25);
  useEffect(()=>{setPage(p=>Math.min(p,Math.max(0,Math.ceil(visible.length/25)-1)));},[visible.length]);
  useEffect(()=>{if(queueRunning)return;const timer=window.setInterval(()=>{
    // Botnoi's analysis and call log land a little after the call ends; keep checking calls the backend has not finished.
    const rows=itemsRef.current.filter(needsCheck).slice(0,25);
    if(document.hidden || syncingRef.current)return;
    // Callback results may arrive after the phone status is terminal.
    void load().then(()=>{if(rows.length)void refresh(rows,true);}).catch(()=>setError('โหลดผลล่าสุดไม่ได้ กดรีเฟรชเพื่อลองใหม่'));

  },15000);return()=>window.clearInterval(timer);},[queueRunning,load]);
  const target=items.find(a=>a.id===selected);
  function open(item:Attempt){setSelected(item.id);setError('');}
  useEffect(()=>{
    if(loading || error || !linkedRequest.current)return;
    const id=linkedRequest.current;
    const item=items.find(a=>a.id===id);
    linkedRequest.current=null;
    if(item)open(item);
    else setNotice('ไม่พบสายนี้ในแคมเปญ');
  },[items,loading,error]);
  useEffect(()=>{
    if(selected)detailPanel.current?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  },[selected]);
  function exportResults(){
    const extra=['vc_csv_row','vc_call_id','vc_call_status','vc_call_result','vc_needs_agent','vc_result_source','vc_evidence','vc_checked_at','vc_talk_seconds'];
    const rows=campaign.csv.rows.flatMap((cells,index)=>{const matches=current.filter(a=>a.metadata.contact_row===index);return matches.length?matches.map(a=>{const result=effectiveOutcome(a.response);return [...cells,index+1,a.call_id,a.status,result.call_result,result.needs_agent===null?'':String(result.needs_agent),sourceLabel(result.source),result.evidence || '',a.response?.callback?.received_at || a.response?.followup?.checked_at || '',talkSeconds(a)??''];}):[[...cells,index+1,'','not_sent','','','','','','']];});
    const blob=new Blob([resultsCsv([...campaign.csv.headers,...extra],rows)],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`campaign-results-${campaign.id}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportHistory(){const headers=['vc_csv_row','vc_campaign_version','vc_requested_at','vc_request_id','vc_phone','vc_call_id','vc_call_status','vc_call_result','vc_needs_agent','vc_result_source','vc_evidence','vc_talk_seconds'];const rows=items.map(a=>{const result=effectiveOutcome(a.response);return [(a.metadata.contact_row??-1)+1,a.metadata.campaign_version||'',a.created_at,a.id,a.destination,a.call_id||'',a.status,result.call_result,result.needs_agent===null?'':String(result.needs_agent),sourceLabel(result.source),result.evidence||'',talkSeconds(a)??''];});const url=URL.createObjectURL(new Blob([resultsCsv(headers,rows)],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`campaign-history-${campaign.id}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const pages=Math.max(1,Math.ceil(visible.length/25));
  return <section className="campaign-results wizard-summary-card" id="call-results" aria-label="ประวัติการโทร">
    <header className="results-header"><div className="results-filter"><SmoothSelect aria-label="กรองผล" value={filter} onChange={v=>{setFilter(v);setPage(0);}} options={[{value:'all',label:`ทุกผล (${items.length})`},...Object.entries(displayLabels).map(([key,label])=>({value:key,label}))]}/></div><div className="draft-actions"><Button size="compact" variant="secondary" disabled={loading || syncing || queueRunning} onClick={()=>void load().then(data=>refresh(data || [])).catch(e=>setError(e.message))}>{syncing?'กำลังตรวจผล…':'รีเฟรช'}</Button>{syncing && <Button size="compact" variant="secondary" onClick={()=>{stopSync.current=true;}}>หยุด</Button>}<Button size="compact" variant="secondary" disabled={loading || syncing || queueRunning} onClick={exportResults}>ผลล่าสุด CSV</Button><Button size="compact" variant="secondary" disabled={loading || syncing || queueRunning||!items.length} onClick={exportHistory}>ทุกสาย CSV</Button></div></header>
    {items.some(a=>a.metadata.campaign_version!==campaign.updatedAt) && <p className="workspace-alert">มีสายจากไฟล์เวอร์ชันก่อน ไม่นับรวมในผลรายแขก</p>}
    {error && <p className="workspace-alert" role="alert">{error}</p>}{notice && <p className="workspace-notice" role="status">{notice}</p>}
    {loading?<p role="status">กำลังโหลด…</p>:items.length===0?<p className="rd-empty">ยังไม่มีสาย</p>:<>
    <div className="csv-preview"><table><thead><tr><th>แขก</th><th>เวลา</th><th>คุย</th><th>ผล</th><th><span className="sr-only">รายละเอียด</span></th></tr></thead><tbody>{pageItems.map(a=>{const shown=callResultDisplay(a);return <tr key={a.id}><td><strong>{a.metadata.variables?.applicant_name || a.metadata.variables?.guest_name || a.destination}</strong><div>{displayPhone(a.destination)}{a.metadata.campaign_version!==campaign.updatedAt?' · เวอร์ชันก่อน':''}</div></td><td>{callTime(a.created_at)}<span className="rd-table__sub">{statusLabels[shownStatus(a.status,a.response?.followup?.failure_reason)] || a.status}</span></td><td>{talkSeconds(a)===null?'—':talkDuration(a)}</td><td><span className="result-badge" data-result={shown.key}>{shown.label}</span></td><td><div className="result-links"><button type="button" className="rd-link" onClick={()=>open(a)}>รายละเอียด</button>{onOpenGuest&&Number.isInteger(a.metadata.contact_row)&&a.metadata.campaign_version===campaign.updatedAt&&<button type="button" className="rd-link" onClick={()=>onOpenGuest(a.metadata.contact_row!)}>แขก</button>}</div></td></tr>;})}</tbody></table></div>{!visible.length&&<p className="rd-empty">ไม่พบสายตามตัวกรองนี้</p>}<div className="rd-table-foot"><span>{visible.length.toLocaleString()} สาย</span><div><Button size="compact" variant="secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)}>ก่อนหน้า</Button><span>หน้า {page+1} / {pages}</span><Button size="compact" variant="secondary" disabled={page+1>=pages} onClick={()=>setPage(p=>p+1)}>ถัดไป</Button></div></div></>}
    {target && <section ref={detailPanel} className="result-detail" aria-label="รายละเอียดผลการโทร"><header className="results-header"><div><h3>{target.metadata.variables?.applicant_name || target.metadata.variables?.guest_name || target.destination}</h3><p className="rd-muted">{callTime(target.created_at)}{latestContactCalls(items,target.metadata.campaign_version).some(a=>a.id===target.id)?'':' · สายก่อนหน้า'}</p></div><Button size="compact" variant="secondary" onClick={()=>{setSelected(null);}}>ปิด</Button></header>
      <dl className="result-times"><div><dt>คุย</dt><dd>{talkSeconds(target)===null?'—':talkDuration(target)}</dd></div><div><dt>รับสาย</dt><dd>{callTime(target.response?.followup?.answered_at)}</dd></div><div><dt>จบสาย</dt><dd>{callTime(target.response?.followup?.completed_at)}</dd></div></dl>
      {target.response?.review && resultNote('บันทึกโดยผู้ใช้',target.response.review,target.response.review.updated_at)}
      {target.response?.callback && resultNote('บอทส่งระหว่างคุย',target.response.callback.outcome,target.response.callback.received_at)}
      {target.response?.followup?.outcome.source==='provider' && resultNote('Voice Bot สรุปหลังจบสาย',target.response.followup.outcome,target.response.followup.checked_at)}
      {(target.metadata.record_conversation === true || target.response?.followup?.transcript) && <section className="saved-call-conversation"><h4>บทสนทนา</h4>{target.response?.transcript ? <p className="saved-call-conversation__text">{readableTranscript(target.response.transcript.text)}</p> : target.response?.followup?.transcript ? <p className="saved-call-conversation__text">{readableTranscript(target.response.followup.transcript)}</p> : <p className="workspace-note">{terminalCall(target.status) ? 'ยังไม่ได้รับบทสนทนา' : 'รอจบสาย'}</p>}</section>}
      {onOpenGuest&&Number.isInteger(target.metadata.contact_row)&&target.metadata.campaign_version===campaign.updatedAt&&<button type="button" className="rd-link" onClick={()=>onOpenGuest(target.metadata.contact_row!)}>บันทึกผลหรือฟังเสียง →</button>}
    </section>}

  </section>;
}
