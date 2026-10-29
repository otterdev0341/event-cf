import { effectiveOutcome, outcomeLabels } from './call-results.mjs';
import { terminalCall, finalResults, latestAttempt, planCampaignCalls } from './campaign-queue.mjs';

// On screen, a call with no answer yet says so plainly; exports keep the shared outcome labels.
export const displayLabels={...outcomeLabels,UNDETERMINED:'ยังไม่มีคำตอบ',ENDED_WITHOUT_RESULT:'วางสายก่อนตอบ'};

// A display state only: ending a call must not fabricate a recipient response.
export function callResultDisplay(attempt) {
  const outcome=effectiveOutcome(attempt.response);
  if(outcome.call_result==='UNDETERMINED'&&['failed','no-answer'].includes(attempt.status)) {
    return {key:'NO_ANSWER',label:displayLabels.NO_ANSWER,note:null};
  }
  if(outcome.call_result==='UNDETERMINED'&&attempt.status==='completed') {
    return {key:'ENDED_WITHOUT_RESULT',label:displayLabels.ENDED_WITHOUT_RESULT,note:null};
  }
  return {key:outcome.call_result,label:displayLabels[outcome.call_result]||displayLabels.UNDETERMINED,note:null};
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
  if(callResultDisplay(attempt).key==='NO_ANSWER')return '—';
  const seconds=talkSeconds(attempt);
  return seconds===null?'ยังไม่มีข้อมูลเวลา':`${Math.floor(seconds/60)} นาที ${seconds%60} วินาที`;
}

// The first real answer in the order unansweredRows and the scheduler's retryKind read them.
const answerOf=attempt=>{
  const r=attempt.response;
  return [r?.review?.call_result,r?.callback?.outcome?.call_result,r?.followup?.outcome?.call_result].find(v=>v&&v!=='UNDETERMINED');
};

// The guest still has to be reached: the call ended without a final answer.
// Same precedence as unansweredRows and the scheduler's retryKind, so counts match the redial scope.
export function needsFollowUp(attempt) {
  return terminalCall(attempt.status)&&!finalResults.includes(answerOf(attempt));
}

// One group per guest, from their latest call, shared by the dashboard, the board and the call page so
// every screen counts the same people. "redial" plus "awaiting" is the redial scope: a call that ended within the hour
// may still get its result, so it waits in "awaiting" instead of being called again. "calling" is only a call still on the line.
export const bucketLabels={pending:'ยังไม่โทร',calling:'กำลังโทร',awaiting:'รอผล',confirmed:'มางาน',declined:'ไม่มา',staff:'ต้องโทรหาเอง',redial:'ต้องโทรซ้ำ'};
export function guestBucket(attempt,now=Date.now()) {
  if(!attempt)return 'pending';
  if(!terminalCall(attempt.status))return 'calling';
  if(awaitingResult(attempt,now))return 'awaiting';
  const answer=answerOf(attempt);
  if(answer==='CONFIRMED')return 'confirmed';
  if(answer==='DECLINED')return 'declined';
  // A guest who asked for a person, or a wrong number, needs a human rather than another bot call.
  if(answer==='REQUEST_AGENT'||answer==='WRONG_PERSON')return 'staff';
  return 'redial';
}
// The same group while this tab is placing calls: a live status the saved record has not caught up with wins.
export function liveBucket(attempt,liveStatus,now=Date.now()) {
  const status=liveStatus??attempt?.status;
  if(!status||status==='waiting')return 'pending';
  if(!terminalCall(status)||!attempt)return 'calling';
  return guestBucket(attempt,now);
}

// A completed call whose result can still arrive: the backend sets followup.final once nothing more will come.
export function awaitingResult(attempt,now=Date.now()) {
  return attempt.status==='completed'&&effectiveOutcome(attempt.response).call_result==='UNDETERMINED'&&!attempt.response?.followup?.final&&now-Date.parse(attempt.created_at)<60*60000;
}

// The calling plans on the campaign screen, from the current version's calls.
// Redial takes exactly the "ต้องโทรซ้ำ" group, never "รอผล". Fresh also picks up calls left unfinished, to check them, not to redial.
// Next is the one call button: guests never called first, then redials.
export function callChoices(rows,attempts,now=Date.now()) {
  const redialRows=rows.filter(row=>guestBucket(latestAttempt(attempts,row.index),now)==='redial').map(row=>row.index);
  const fresh=planCampaignCalls(rows,attempts,null,false),redial=planCampaignCalls(rows,attempts,redialRows,true);
  return {fresh,redial,next:[...fresh,...redial]};
}

// Call logs tag lines with turn ids and English speaker names; organisers read บอท and แขก.
export function readableTranscript(text) {
  return String(text||'').replace(/\[turn=[^\]]*\]\s*/g,'').replace(/^[ \t]*(?:agent|assistant|bot)[ \t]*:/gim,'บอท:').replace(/^[ \t]*(?:user|customer|human)[ \t]*:/gim,'แขก:');
}

// Thai numbers as people dial them: +66812385265 and 0812385265 both read 081-238-5265.
export function displayPhone(phone) {
  const digits=String(phone||'').replace(/^\+66/,'0').replace(/\D/g,'');
  if(/^0\d{9}$/.test(digits))return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  if(/^0\d{8}$/.test(digits))return `${digits.slice(0,2)}-${digits.slice(2,5)}-${digits.slice(5)}`;
  return phone||'';
}
