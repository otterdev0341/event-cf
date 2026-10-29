import type { Outcome } from './call-results.mjs';
type DisplayAttempt={status:string;created_at?:string;response?:{review?:Outcome;callback?:{outcome:Outcome};followup?:{outcome?:Outcome;answered_at?:string|null;completed_at?:string|null;final?:boolean}}|null};
export const displayLabels:Record<string,string>;
export function callResultDisplay(attempt:DisplayAttempt):{key:string;label:string;note:string|null};
export function talkSeconds(attempt:DisplayAttempt):number|null;
export function talkDuration(attempt:DisplayAttempt):string;
export function needsFollowUp(attempt:DisplayAttempt):boolean;
export function awaitingResult(attempt:DisplayAttempt&{created_at:string},now?:number):boolean;
