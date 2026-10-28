import type { Outcome } from './call-results.mjs';
type DisplayAttempt={status:string;response?:{review?:Outcome;callback?:{outcome:Outcome};followup?:{outcome?:Outcome;answered_at?:string|null;completed_at?:string|null}}|null};
export const displayLabels:Record<string,string>;
export function callResultDisplay(attempt:DisplayAttempt):{key:string;label:string;note:string|null};
export function talkSeconds(attempt:DisplayAttempt):number|null;
export function talkDuration(attempt:DisplayAttempt):string;
