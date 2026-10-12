import type { PreparedContact } from './campaign-inputs.mjs';
export interface CampaignAttempt { id: string; call_id: string | null; status: string; created_at: string; metadata: { contact_row?: number; campaign_id?: string; campaign_version?: string } }
export function terminalCall(status: string): boolean;
export function latestAttempt(attempts:CampaignAttempt[],index:number):CampaignAttempt|undefined;
export function planCampaignCalls(rows:PreparedContact[],attempts:CampaignAttempt[],indexes:number[]|null,redial?:boolean):(PreparedContact & {redialOf?:string})[];
export function campaignRequestId(campaignId:string,version:string,row:number,redialOf?:string):Promise<string>;
export function runCampaignQueue(options: {
  rows: (PreparedContact & {redialOf?:string})[]; attempts: CampaignAttempt[];
  submit: (row: PreparedContact & {redialOf?:string}) => Promise<{call_id: string; status?: string; persistence_warning?: string}>;
  readStatus: (id:string) => Promise<{status:string; reason?:string; error?:string}>;
  shouldStop: () => boolean;
  onUpdate: (index:number,status:string,message:string,callId?:string) => void;
  wait: (ms:number) => Promise<void>;
  now?: () => number; maxPolls?: number;
}): Promise<'paused'|'complete'>;
