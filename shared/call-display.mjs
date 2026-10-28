import { effectiveOutcome, outcomeLabels } from './call-results.mjs';

export const displayLabels={...outcomeLabels,ENDED_WITHOUT_RESULT:'จบสายโดยไม่ได้คำตอบ'};

// A display state only: ending a call must not fabricate a recipient response.
export function callResultDisplay(attempt) {
  const outcome=effectiveOutcome(attempt.response);
  if(outcome.call_result==='UNDETERMINED'&&['failed','no-answer'].includes(attempt.status)) {
    return {key:'NO_ANSWER',label:displayLabels.NO_ANSWER,note:'โทรไม่สำเร็จ หรือไม่มีผู้รับสาย'};
  }
  if(outcome.call_result==='UNDETERMINED'&&attempt.status==='completed') {
    return {key:'ENDED_WITHOUT_RESULT',label:displayLabels.ENDED_WITHOUT_RESULT,note:'สายถูกรับแล้วจบโดยไม่มีผลตอบรับ เช่น ผู้รับวางสายทันที หรือข้อความแจ้งของเครือข่ายเมื่อปิดเครื่อง'};
  }
  return {key:outcome.call_result,label:displayLabels[outcome.call_result]||'รอตรวจสอบ',note:null};
}

export function talkSeconds(attempt) {
  const followup=attempt.response?.followup;
  // A refreshed unsuccessful call with no answer has no connected talk time.
  if(['failed','no-answer','busy'].includes(attempt.status)&&followup?.answered_at===null)return 0;
  const start=typeof followup?.answered_at==='string'?Date.parse(followup.answered_at):NaN;
  const end=typeof followup?.completed_at==='string'?Date.parse(followup.completed_at):NaN;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)return null;
  return Math.floor((end-start)/1000);
}

export function talkDuration(attempt) {
  if(callResultDisplay(attempt).key==='NO_ANSWER')return '-';
  const seconds=talkSeconds(attempt);
  return seconds===null?'ยังไม่มีข้อมูลเวลา':`${Math.floor(seconds/60)} นาที ${seconds%60} วินาที`;
}
