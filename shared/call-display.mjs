import { effectiveOutcome, outcomeLabels } from './call-results.mjs';
import { terminalCall } from './campaign-queue.mjs';

// A display state only: ending a call must not fabricate a recipient response.
export function callResultDisplay(attempt) {
  const outcome=effectiveOutcome(attempt.response);
  if(outcome.call_result==='UNDETERMINED'&&terminalCall(attempt.status)) {
    return {key:'ENDED_WITHOUT_RESULT',label:'ตัดสาย',note:'สายสิ้นสุดแล้ว โดยไม่มีผลตอบรับ'};
  }
  return {key:outcome.call_result,label:outcomeLabels[outcome.call_result]||'รอตรวจสอบ',note:null};
}

export function talkSeconds(attempt) {
  const followup=attempt.response?.followup;
  const start=typeof followup?.answered_at==='string'?Date.parse(followup.answered_at):NaN;
  const end=typeof followup?.completed_at==='string'?Date.parse(followup.completed_at):NaN;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
  return Math.floor((end-start)/1000);
}

export function talkDuration(attempt) {
  const seconds=talkSeconds(attempt);
  return seconds===null?'—':`${Math.floor(seconds/60)} นาที ${seconds%60} วินาที`;
}
