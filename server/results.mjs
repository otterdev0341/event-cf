import { outcomeLabels, providerOutcome, transcriptText, matchingLogPath } from '../shared/call-results.mjs';
import { terminalCall } from '../shared/campaign-queue.mjs';

export async function handleCallResult({id,method,body,db,upstream,user,fail,send}) {
  const {data:record,error}=await db.from('voice_call_requests').select('id,owner_id,call_id,agent_id,status,response,destination,metadata,created_at').eq('id',id).eq('owner_id',user.id).maybeSingle();
  if(error || !record) fail(404,'ไม่พบคำขอโทรในบัญชีนี้');
  const original=record.response;
  let response={...(original || {})};
  let status=record.status;
  if(method==='POST') {
    if(!body || !Object.hasOwn(outcomeLabels,body.call_result) || ![true,false,null].includes(body.needs_agent) || typeof body.evidence!=='string' || !body.evidence.trim() || body.evidence.length>2000) fail(400,'กรุณาเลือกผลและระบุข้อความหรือเหตุผลที่ตรวจสอบแล้ว');
    if((body.expected_review_at ?? null)!==(response.review?.updated_at ?? null)) fail(409,'ผลถูกแก้ไขแล้ว กรุณารีเฟรชก่อนบันทึก');
    response.review={call_result:body.call_result,needs_agent:body.needs_agent,evidence:body.evidence.trim(),updated_at:new Date().toISOString(),reviewed_by:user.id,source:'manual'};
  } else {
    if(!record.call_id) { send(200,{...record,warning:'ยังไม่มี Call ID จึงตรวจผลจากบริการไม่ได้'}); return; }
    const account=await upstream('/me');
    const call=await upstream(`/v1/provisioning/tenants/${encodeURIComponent(account._id)}/calls/${encodeURIComponent(record.call_id)}`);
    if(call.call_id!==record.call_id) fail(502,'Call ID จากบริการไม่ตรงกับคำขอ');
    if(typeof call.status!=='string') fail(502,'บริการไม่ระบุสถานะสาย');
    status=call.status;
    let text=transcriptText(call), log=null, logPath=null, logState=text?'available':'pending';
    if(terminalCall(status) && !text) {
      try {
        const files=await upstream(`/logs/list_file/?agent_id=${encodeURIComponent(record.agent_id)}`);
        logPath=matchingLogPath(files,call);
        if(logPath) {log=await upstream(`/logs/read_log/?file_path=${encodeURIComponent(logPath)}`);text=transcriptText(log);}
        logState=text?'available':'not_available';
      } catch {logState='error';}
    }
    const outcome=providerOutcome(call,log);
    // Preserve already retrieved evidence if the provider temporarily stops returning it.
    const previous=response.followup;
    response.followup={checked_at:new Date().toISOString(),answered_at:call.answered_at || null,completed_at:call.completed_at || null,ended_by:typeof call.ended_by==='string'?call.ended_by:null,
      outcome:outcome.source==='unavailable' && previous?.outcome?.source==='provider'?previous.outcome:outcome,
      transcript:text || previous?.transcript || '',log_path:logPath || previous?.log_path || null,log_state:logState};
    if(response.followup.transcript && !text) response.followup.log_state='cached';
  }
  let update=db.from('voice_call_requests').update({status,response}).eq('id',id).eq('owner_id',user.id).eq('status',record.status);
  for (const [path,value] of [['response->callback->>received_at',original?.callback?.received_at],['response->review->>updated_at',original?.review?.updated_at],['response->followup->>checked_at',original?.followup?.checked_at]]) {
    update=value ? update.eq(path,value) : update.is(path,null);
  }
  const {data:saved,error:writeError}=await update.select('id');
  if(writeError || !saved?.length) fail(409,'บันทึกผลไม่ได้หรือมีการอัปเดตพร้อมกัน กรุณารีเฟรชอีกครั้ง');
  send(200,{...record,status,response});
}
