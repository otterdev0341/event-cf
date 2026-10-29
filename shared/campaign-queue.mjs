export const terminalCall = status => ['completed','failed','busy','no-answer','cancelled','canceled'].includes(status);
// Botnoi reports a missed call as failed with reason no_answer, busy or rejected; show the recipient-side status instead.
export function shownStatus(status, reason) {
  const r=String(reason||'').toLowerCase().replaceAll('_','-');
  if(status!=='failed')return status;
  return r==='busy'?'busy':['no-answer','rejected'].includes(r)?'no-answer':status;
}

export function latestAttempt(attempts, index) {
  return attempts.filter(a=>a.metadata?.contact_row===index).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||String(b.id).localeCompare(String(a.id)))[0];
}
// Rows whose last call ended without a final answer, with the same precedence and final results as the scheduler's retryKind.
export const finalResults=['CONFIRMED','DECLINED','WRONG_PERSON','REQUEST_AGENT'];
export function unansweredRows(rows, attempts) {
  return rows.filter(row=>{
    const last=latestAttempt(attempts,row.index);
    if(!last||!terminalCall(last.status))return false;
    return !finalResults.includes([last.review,last.callback,last.followup].find(r=>r&&r!=='UNDETERMINED'));
  }).map(row=>row.index);
}
export function planCampaignCalls(rows, attempts, indexes, redial=false) {
  return rows.filter(row=>indexes===null || indexes.includes(row.index)).flatMap(row=>{
    const previous=latestAttempt(attempts,row.index);
    if(previous&&terminalCall(previous.status))return redial?[{...row,redialOf:previous.id}]:[];
    return [{...row,redialOf:undefined}];
  });
}
export async function campaignRequestId(campaignId,version,row,redialOf) {
  const source=redialOf?`voice-campaign-redial-v1:${campaignId}:${version}:${row}:${redialOf}`:`voice-campaign-v1:${campaignId}:${version}:${row}`;
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source))).slice(0,16);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// Submit sequentially; every accepted/uncertain attempt is recovered from durable history.
export async function runCampaignQueue({ rows, attempts, submit, readStatus, shouldStop, onUpdate, wait, now = Date.now, maxPolls = 120 }) {
  let lastSubmitted = Math.max(0, ...attempts.map(a => Date.parse(a.created_at) || 0));
  for (const row of rows) {
    if (shouldStop()) return 'paused';
    const matches=attempts.filter(a=>a.metadata?.contact_row===row.index);
    const latest=latestAttempt(attempts,row.index);
    if(matches.length>1&&!matches.every(a=>a===latest||terminalCall(a.status)))throw new Error(`แถว ${row.index+1} มีคำขอที่ยังไม่จบ กรุณาตรวจประวัติก่อนดำเนินการต่อ`);
    const previous=row.redialOf?[]:latest?[latest]:[];
    if(row.redialOf&&(!latest||latest.id!==row.redialOf||!terminalCall(latest.status)))throw new Error(`ประวัติแถว ${row.index+1} เปลี่ยนแล้ว กรุณาเลือกและยืนยันใหม่`);
    let callId = previous[0]?.call_id;
    if (previous.length && !callId) throw new Error(`แถว ${row.index + 1} ยังยืนยันผลคำขอเดิมไม่ได้ หยุดคิวเพื่อป้องกันโทรซ้ำ`);
    if (!callId) {
      while (now() - lastSubmitted < 13000) {
        onUpdate(row.index, 'waiting', 'รอเว้นระยะส่งคำขอ');
        await wait(Math.min(1000, 13000 - (now() - lastSubmitted)));
        if (shouldStop()) return 'paused';
      }
      if (shouldStop()) return 'paused';
      onUpdate(row.index, 'submitting', 'กำลังส่งคำขอโทร');
      let result;
      try { result = await submit(row); }
      catch (error) { onUpdate(row.index, 'unknown', error.message); throw error; }
      callId = result.call_id;
      if (!callId) { onUpdate(row.index,'unknown','ไม่ได้รับ Call ID'); throw new Error(`แถว ${row.index + 1} ไม่ได้รับ Call ID กรุณาตรวจประวัติก่อนโทรซ้ำ`); }
      lastSubmitted = now();
      onUpdate(row.index, result.status || 'queued', 'บริการรับคำขอแล้ว', callId);
      if (result.persistence_warning) throw new Error(result.persistence_warning);
    }
    let terminal = false;
    for (let poll = 0; poll < maxPolls; poll++) {
      if (shouldStop()) return 'paused';
      const status = await readStatus(callId);
      const shown = shownStatus(status.status, status.reason);
      onUpdate(row.index, shown, shown !== status.status ? '' : status.reason || status.error || '', callId);
      if (terminalCall(status.status)) { terminal = true; break; }
      await wait(3000);
    }
    if (!terminal) throw new Error(`รอตรวจสถานะสายแถว ${row.index + 1} นานเกินไป หยุดคิวไว้ก่อน กดดำเนินการต่อเพื่อตรวจสายเดิม`);
  }
  return 'complete';
}
