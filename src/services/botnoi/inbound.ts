import { botnoiFetch } from './client';

export interface InboundNumber { did: string; agent_id: string | null; revision: string }
export interface InboundSetup {
  account_id: string; can_manage: boolean; configured: boolean; numbers: InboundNumber[];
  readiness: boolean | null; paused: boolean; trunk_state: string | null; notice: string | null; checked_at: string;
}
export interface InboundCall {
  id: string; started_at: string | null; status: string | null; number: string | null;
  phone_number: string | null; agent_id: string | null; agent_name: string | null; duration_seconds: number | null;
}
export interface InboundHistory { account_id: string; items: InboundCall[]; has_more: boolean; checked_at: string }
export const getInboundSetup = (signal?: AbortSignal) => botnoiFetch<InboundSetup>('/workspace/inbound', { signal });
export const getInboundHistory = (signal?: AbortSignal) => botnoiFetch<InboundHistory>('/workspace/inbound/history', { signal });
export const bindInboundNumber = (setup: InboundSetup, number: InboundNumber, agentId: string) =>
  botnoiFetch<InboundSetup>('/workspace/inbound/bind', { method: 'POST', body: {
    account_id: setup.account_id, did: number.did, agent_id: agentId, revision: number.revision, confirmed: true,
  } });
