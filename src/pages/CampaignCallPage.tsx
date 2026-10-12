import { useEffect, useRef, useState } from 'react';
import { CampaignResults } from '../components/CampaignResults';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { getCampaigns, saveDraft } from '../lib/campaigns';
import { supabase } from '../lib/supabase';
import { botnoiApi } from '../services/botnoi';
import { useAgentDetail } from '../hooks/useBotnoiData';
import { prepareCampaignRows, promptVariables } from '../../shared/campaign-inputs.mjs';
import { runCampaignQueue, planCampaignCalls, campaignRequestId, terminalCall, type CampaignAttempt } from '../../shared/campaign-queue.mjs';
import { routes } from '../routes';

type RowState = {status:string; message:string; callId?:string};
const labels: Record<string,string> = {waiting:'รอส่ง',submitting:'กำลังส่งคำขอ',queued:'เข้าคิวแล้ว',ringing:'กำลังเรียกสาย','in-progress':'กำลังสนทนา',completed:'จบสาย',failed:'โทรไม่สำเร็จ',busy:'สายไม่ว่าง','no-answer':'ไม่รับสาย',cancelled:'ยกเลิก',canceled:'ยกเลิก',unknown:'รอตรวจสอบ'};
export function CampaignCallPage() {
  const [campaign] = useState(() => getCampaigns().find(c => c.id === new URLSearchParams(window.location.search).get('campaign')));
  const detail = useAgentDetail(campaign?.agentId);
  const prepared = prepareCampaignRows(campaign || null, detail.variables);
  const [states,setStates] = useState<Record<number,RowState>>({});
  const [historyReady,setHistoryReady] = useState(false);
  const [historyRevision,setHistoryRevision] = useState(0);
  const [resultsRevision,setResultsRevision] = useState(0);
  const [running,setRunning] = useState(false);
  const [editing,setEditing] = useState(false);
  const [consent,setConsent] = useState(false);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const [page,setPage] = useState(0);
  const [history,setHistory]=useState<CampaignAttempt[]>([]);
  const [scope,setScope]=useState<'pending'|'selected'>('pending');
  const [selectedRows,setSelectedRows]=useState<number[]>([]);
  const [redial,setRedial]=useState(false);
  const stopped = useRef(false), mounted = useRef(true), busy = useRef(false);
  const invalid = prepared.rows.filter(r => r.errors.length);
  const planned=planCampaignCalls(prepared.rows,history,scope==='selected'?selectedRows:null,scope==='selected'&&redial);
  const valid = !!detail.agent && !detail.loading && !detail.error && !prepared.errors.length && planned.length>0 && planned.every(row=>!row.errors.length);
  const repeatCount=planned.filter(row=>row.redialOf).length;
  function changeSelection(index:number){setConsent(false);setSelectedRows(old=>old.includes(index)?old.filter(i=>i!==index):[...old,index]);}
  const pageRows = prepared.rows.slice(page*25,page*25+25);
  async function attempts() {
    if (!supabase || !campaign) throw new Error('ไม่พบแคมเปญ');
    const all: CampaignAttempt[] = [];
    for (let offset=0;;offset+=500) {
      const {data,error} = await supabase.from('voice_call_requests').select('id,call_id,status,created_at,metadata').eq('metadata->>campaign_id',campaign.id).order('created_at').order('id').range(offset,offset+499);
      if (error) throw new Error('อ่านประวัติคำขอไม่ได้ จึงยังเริ่มคิวไม่ได้');
      all.push(...data as CampaignAttempt[]); if (data.length<500) {
        if (all.some(a => a.metadata.campaign_version !== campaign.updatedAt)) throw new Error('แคมเปญนี้มีคำขอจากเวอร์ชันก่อนหน้า กรุณาตรวจประวัติ หากต้องการโทรชุดใหม่ให้สร้างแคมเปญใหม่ เพื่อไม่โทรรายชื่อเดิมซ้ำ');
        return all;
      }
    }
  }
  useEffect(() => { mounted.current=true; return () => { mounted.current=false; stopped.current=true; }; },[]);
  useEffect(() => {
    let active=true; setHistoryReady(false);
    void attempts().then(data => { if (!active) return; setHistory(data);setStates(Object.fromEntries(data.filter(a=>Number.isInteger(a.metadata.contact_row)).map(a=>[a.metadata.contact_row!,{status:a.status,message:'คำขอที่บันทึกไว้ · ดูผลล่าสุดในส่วนผลตอบรับด้านล่าง',callId:a.call_id || undefined}]))); setHistoryReady(true); }).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[historyRevision]);
  useEffect(() => {
    if (!running) return;
    const warn = (event:BeforeUnloadEvent) => { event.preventDefault(); event.returnValue=''; };
    window.addEventListener('beforeunload',warn); return()=>window.removeEventListener('beforeunload',warn);
  },[running]);
  async function edit(path:string) {
    if (!campaign || running || busy.current) return;
    setEditing(true); setError('');
    try { await saveDraft(campaign); window.location.assign(path); } catch(e){setError((e as Error).message);setEditing(false);}
  }
  async function start() {
    if (!campaign || !valid || !historyReady || !consent || busy.current) return;
    busy.current=true; stopped.current=false; setRunning(true); setConsent(false); setError(''); setMessage('กำลังตรวจ Agent คู่สาย และประวัติคำขอเดิม…');
    try {
      await navigator.locks.request(`voice-campaign:${campaign.id}`,{ifAvailable:true},async lock=>{
        if(!lock) throw new Error('แคมเปญนี้กำลังทำงานในอีกแท็บ');
        const agent = await botnoiApi.getAgent(campaign.agentId);
        const checked = prepareCampaignRows(campaign,promptVariables(agent));
        if(checked.errors.length) throw new Error('ตัวแปร Agent เปลี่ยนแล้ว กรุณากลับไปตรวจการจับคู่ CSV');
        const account = await botnoiApi.getAccount();
        const overview = await botnoiApi.getProvisioningOverview(account._id,{include:'tenant,trunk_status'});
        const config=overview.sections.tenant, trunk=overview.sections.trunk_status;
        if(!config?.ok || !trunk?.ok || !config.data.outbound?.enabled || trunk.data.disabled_at || !config.data.readiness?.pbx?.ready || (trunk.data.mode!=='ip' && trunk.data.registration?.state!=='registered')) throw new Error('คู่สายโทรศัพท์ยังไม่พร้อม กรุณาตรวจการเชื่อมต่อ');
        const latestHistory = await attempts();
        const chosen=planCampaignCalls(checked.rows,latestHistory,scope==='selected'?selectedRows:null,scope==='selected'&&redial);
        if(!chosen.length)throw new Error('ไม่มีรายชื่อที่ต้องโทร เลือกรายชื่อใหม่ หรือเปิดตัวเลือกโทรซ้ำหากต้องการโทรคนที่จบสายแล้ว');
        if(chosen.some(row=>row.errors.length))throw new Error('ข้อมูลของรายชื่อที่เลือกยังไม่ครบ กรุณาตรวจ CSV');
        if(chosen.some(row=>row.redialOf!==planned.find(p=>p.index===row.index)?.redialOf))throw new Error('ประวัติการโทรเปลี่ยนแล้ว กรุณาตรวจและยืนยันใหม่');
        const result = await runCampaignQueue({rows:chosen,attempts:latestHistory,
          shouldStop:()=>stopped.current || !mounted.current,
          wait:ms=>new Promise(resolve=>window.setTimeout(resolve,ms)),
          submit:async row=>botnoiApi.placeCall(account._id,row.destination,campaign.agentId,{requestId:await campaignRequestId(campaign.id,campaign.updatedAt!,row.index,row.redialOf),redialOf:row.redialOf,variables:{},campaignId:campaign.id,contactRow:row.index,campaignBatch:true,campaignVersion:campaign.updatedAt}),
          readStatus:id=>botnoiApi.getCallStatus(account._id,id),
          onUpdate:(index,status,message,callId)=>{if(mounted.current){setStates(prev=>({...prev,[index]:{status,message,callId:callId || (['waiting','submitting'].includes(status)?undefined:prev[index]?.callId)}}));setMessage(`แถว ${index+1}/${checked.rows.length} · ${labels[status] || status}`);}}
        });
        if(mounted.current)setMessage(result==='complete'?`ดำเนินการครบ ${chosen.length} รายชื่อที่เลือกแล้ว ดูผลจริงของแต่ละสายได้ในตาราง`:'หยุดส่งรายชื่อถัดไปแล้ว สายที่ส่งไปก่อนหน้ายังอาจทำงานอยู่');
      });
    } catch(e) { if(mounted.current){setError((e as Error).message);setMessage('คิวหยุดแล้ว กรุณาตรวจสาเหตุก่อนดำเนินการต่อ');} }
    finally { busy.current=false; if(mounted.current){setRunning(false);setResultsRevision(v=>v+1);setHistoryRevision(v=>v+1);} }
  }
  if(!campaign) return <div><AppHeader /><main className="page-shell real-data-page"><h1>ไม่พบแคมเปญในบัญชีนี้</h1><Button href={routes.campaigns}>กลับไปแคมเปญ</Button></main></div>;
  return <div><AppHeader /><main className="page-shell real-data-page">
    <header><span className="ui-kicker">CAMPAIGN CALLS</span><h1>โทรตามรายชื่อ CSV</h1><p>{campaign.name} · {detail.agent?.bot_name || campaign.agentId} · {prepared.rows.length.toLocaleString()} รายชื่อ</p><a href="#call-results">ดูผลตอบรับและบทสนทนา ↓</a></header>
    <section className="wizard-agent-banner"><div><h2>{campaign.fileName}</h2><p>หนึ่งแถวต่อหนึ่งผู้ติดต่อ · ใช้ข้อมูลของแถวนั้นในการโทร</p></div><div className="draft-actions"><Button size="compact" variant="secondary" disabled={running || editing} onClick={()=>edit(routes.dataMapping)}>แก้ไขการจับคู่</Button><Button size="compact" variant="secondary" disabled={running || editing} onClick={()=>edit(routes.createCampaign)}>เปลี่ยนไฟล์ CSV</Button></div></section>
    <section className="wizard-summary-card"><h2>ตรวจความพร้อมก่อนเริ่ม</h2>{detail.loading?<p role="status">กำลังอ่าน Agent…</p>:<><p>ข้อมูลครบ {prepared.errors.length?0:prepared.rows.length-invalid.length} / {prepared.rows.length} รายชื่อ</p><div className="wizard-variable-list">{detail.variables.map(v=><code key={v}>{v} ← {prepared.bindings[v]?.source==='output'?'ผลลัพธ์หลังโทร':(prepared.bindings[v] as {column?:string})?.column || 'ยังไม่เลือกคอลัมน์'}</code>)}</div></>}
      {detail.error && <p className="workspace-alert" role="alert">{detail.error}</p>}{prepared.errors.map(e=><p className="workspace-alert" key={e}>{e}</p>)}
      {invalid.length>0 && <p className="workspace-alert">พบ {invalid.length} แถวที่ต้องแก้ข้อมูลก่อนเริ่ม ตรวจรายละเอียดในตารางด้านล่าง</p>}
      <p className="workspace-note">ตัวแปรที่เป็นผลลัพธ์หลังสนทนาให้กำหนดในหน้าจับคู่ ระบบจะไม่เติมค่าจำลองให้</p>
      <Button size="compact" variant="secondary" disabled={running || editing} onClick={()=>{detail.refetch();setHistoryRevision(v=>v+1);setError('');setConsent(false);}}>ตรวจข้อมูลล่าสุด</Button>
    </section>
    <section className="wizard-summary-confirm" id="call-selection"><h2>เลือกรายชื่อที่จะโทร</h2><p>โทรเรียงทีละคน รอจบสายก่อนส่งคนถัดไป เว้นคำขออย่างน้อย 13 วินาที กรุณาเปิดหน้านี้และให้เครื่องทำงานไว้</p>
      <div className="call-scope" role="group" aria-label="ขอบเขตการโทร"><label><input type="radio" name="call-scope" checked={scope==='pending'} disabled={running} onChange={()=>{setScope('pending');setRedial(false);setConsent(false);}}/>รายชื่อที่ยังไม่จบทั้งหมด</label><label><input type="radio" name="call-scope" checked={scope==='selected'} disabled={running} onChange={()=>{setScope('selected');setConsent(false);}}/>เลือกเฉพาะบางคน</label></div>
      {scope==='selected'&&<><p>ติ๊กเลือกผู้ติดต่อในตารางด้านล่าง เลือกข้ามหน้าได้</p><div className="draft-actions"><Button size="compact" variant="secondary" disabled={running||!historyReady} onClick={()=>{setSelectedRows(prepared.rows.filter(row=>!row.errors.length).map(row=>row.index));setConsent(false);}}>เลือกทุกคนที่ข้อมูลครบ</Button><Button size="compact" variant="secondary" disabled={running||!selectedRows.length} onClick={()=>{setSelectedRows([]);setConsent(false);}}>ล้างการเลือก</Button></div><label><input type="checkbox" checked={redial} disabled={running} onChange={e=>{setRedial(e.target.checked);setConsent(false);}}/>โทรซ้ำรายชื่อที่เลือกและจบสายแล้ว</label></>}
      <div className="call-selection-count" role="status"><strong>{historyReady?planned.length:'…'}</strong><span>รายชื่อที่จะดำเนินการ{scope==='selected'?` · เลือกไว้ ${selectedRows.length} คน`:''}{repeatCount?` · โทรซ้ำ ${repeatCount} คน`:''}</span></div>
      {scope==='selected'&&!redial&&selectedRows.some(index=>terminalCall(states[index]?.status))&&<p className="workspace-note">รายชื่อที่จบสายแล้วจะถูกข้าม เปิดตัวเลือกโทรซ้ำหากต้องการโทรอีกครั้ง</p>}
      {repeatCount>0&&<p className="workspace-alert">จะโทรออกใหม่ {repeatCount} คนที่เคยจบสายแล้ว ประวัติและผลสายเดิมยังอยู่</p>}
      <label><input type="checkbox" checked={consent} disabled={running || !valid || !historyReady} onChange={e=>setConsent(e.target.checked)}/>ฉันตรวจรายชื่อและยืนยันดำเนินการ {planned.length} คน{repeatCount?` รวมโทรซ้ำ ${repeatCount} คน`:''}</label><div className="draft-actions"><Button disabled={running || editing || !valid || !historyReady || !consent || !navigator.locks} onClick={start}>เริ่ม / ดำเนินคิวที่เลือก {planned.length} คน</Button>{running && <Button variant="secondary" onClick={()=>{stopped.current=true;setConsent(false);setMessage('กำลังหยุดส่งรายชื่อถัดไป สายที่ส่งแล้วจะไม่ถูกยกเลิก');}}>หยุดคิว</Button>}</div><p className="workspace-note">สายที่ยังทำงานจะตรวจต่อโดยไม่ส่งซ้ำ หากปิดหน้าหรือเครื่องพัก คิวจะหยุดส่งรายชื่อถัดไป</p>{!navigator.locks && <p role="alert">เบราว์เซอร์นี้ไม่รองรับการล็อกคิว กรุณาใช้ Chrome หรือ Edge รุ่นปัจจุบัน</p>}</section>
    {message && <p className="workspace-notice" role="status">{message}</p>}{error && <p className="workspace-alert" role="alert">{error}</p>}
    <section className="wizard-summary-card"><h2>รายชื่อและสถานะการโทร</h2><div className="csv-preview"><table><thead><tr><th>เลือก</th><th>แถว</th><th>เบอร์โทร</th><th>ข้อมูลจาก CSV</th><th>สถานะ / สิ่งที่ต้องแก้</th></tr></thead><tbody>{pageRows.map(row=><tr key={row.index} className={scope==='selected'&&selectedRows.includes(row.index)?'call-row-selected':''}><td><input type="checkbox" aria-label={`เลือกโทรแถว ${row.index+1} เบอร์ ${row.destination}`} checked={scope==='selected'?selectedRows.includes(row.index):planned.some(p=>p.index===row.index)} disabled={running||!historyReady||scope!=='selected'||!!row.errors.length||!!prepared.errors.length} onChange={()=>changeSelection(row.index)}/></td><td>{row.index+1}</td><td>{row.destination || '—'}</td><td>{Object.entries(row.variables).map(([key,value])=><div key={key}><strong>{key}:</strong> {value}</div>)}</td><td>{row.errors.length?row.errors.join(' · '):prepared.errors.length?'ต้องแก้การจับคู่ข้อมูล':labels[states[row.index]?.status] || states[row.index]?.status || 'ยังไม่ส่ง'}{states[row.index]?.message && <p>{states[row.index].message}</p>}{states[row.index]?.callId && <small>Call ID: {states[row.index].callId}</small>}</td></tr>)}</tbody></table></div><div className="wizard-summary-actions"><Button variant="secondary" size="compact" disabled={page===0} onClick={()=>setPage(p=>p-1)}>ก่อนหน้า</Button><span>หน้า {page+1} / {Math.max(1,Math.ceil(prepared.rows.length/25))}</span><Button variant="secondary" size="compact" disabled={(page+1)*25>=prepared.rows.length} onClick={()=>setPage(p=>p+1)}>ถัดไป</Button></div></section>
    <p className="workspace-note">“จบสาย” หมายถึงสถานะสายจากบริการ ไม่ได้แปลว่าผู้ติดต่อยืนยันตอบรับ การตั้งเวลาและการทำงานเบื้องหลังยังไม่รองรับในคิวนี้</p>
    <CampaignResults campaign={campaign} queueRunning={running} revision={resultsRevision+historyRevision} onStatus={(row,status,callId)=>{setStates(prev=>({...prev,[row]:{status,callId,message:'อัปเดตจากบริการแล้ว'}}));setHistory(prev=>prev.map(a=>a.call_id===callId?{...a,status}:a));}} />
    {!running && <Button href={routes.campaigns} variant="secondary">กลับไปแคมเปญ</Button>}
  </main></div>;
}
