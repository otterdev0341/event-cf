export type Outcome = {call_result:string;needs_agent:boolean|null;source:string;evidence?:string;updated_at?:string;reviewed_by?:string};
export const outcomeLabels:Record<string,string>;
export function effectiveOutcome(response?:{review?:Outcome;callback?:{outcome:Outcome};followup?:{outcome:Outcome}} | null):Outcome;
export function latestContactCalls<T extends {id:string;created_at:string;metadata:{campaign_version?:string;contact_row?:number}}>(attempts:T[],version?:string,rowCount?:number):T[];
export function resultsCsv(headers:string[],rows:unknown[][]):string;
export function providerOutcome(call:unknown,log?:unknown):Outcome;
export function transcriptText(log:unknown):string;
export function matchingLogPath(files:unknown,call:unknown):string|null;
