import { botnoiFetch } from './client';

export interface InboundNumber { did: string; agent_id: string | null; revision: string }
export interface InboundSetup {
  account_id: string; can_manage: boolean; configured: boolean; numbers: InboundNumber[];
  readiness: boolean | null; paused: boolean; trunk_state: string | null; notice: string | null; checked_at: string;
}
export const getInboundSetup = (signal?: AbortSignal) => botnoiFetch<InboundSetup>('/workspace/inbound', { signal });
