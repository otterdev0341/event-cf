import { botnoiFetch } from "./client";

export interface AssignDidResponse {
  canonical_did?: string;
  did?: string;
  agent_id?: string | null;
}

/**
 * Assign a new DID phone number to the tenant, optionally binding it to an agent
 * POST /v1/provisioning/tenants/{tenant_id}/dids/assign
 */
export async function assignDid(
  tenantId: string,
  agentId?: string | null,
): Promise<AssignDidResponse> {
  return botnoiFetch<AssignDidResponse>(`/v1/provisioning/tenants/${tenantId}/dids/assign`, {
    method: "POST",
    body: agentId ? { agent_id: agentId } : null,
  });
}

/**
 * Bind or rebind a DID phone number to a specific Agent ID
 * PUT /v1/provisioning/tenants/{tenant_id}/dids/{did}
 */
export async function bindDidToAgent(
  tenantId: string,
  did: string,
  agentId: string | null,
): Promise<{ ok: boolean }> {
  return botnoiFetch<{ ok: boolean }>(`/v1/provisioning/tenants/${tenantId}/dids/${encodeURIComponent(did)}`, {
    method: "PUT",
    body: { agent_id: agentId },
  });
}

/**
 * Detach/release a DID phone number from the tenant
 * DELETE /v1/provisioning/tenants/{tenant_id}/dids/{did}
 */
export async function detachDid(
  tenantId: string,
  did: string,
): Promise<void> {
  await botnoiFetch<void>(`/v1/provisioning/tenants/${tenantId}/dids/${encodeURIComponent(did)}`, {
    method: "DELETE",
  });
}

/**
 * Resync all DIDs with telephony routing rules
 * POST /v1/provisioning/tenants/{tenant_id}/dids/resync
 */
export async function resyncDids(tenantId: string): Promise<{ ok: boolean }> {
  return botnoiFetch<{ ok: boolean }>(`/v1/provisioning/tenants/${tenantId}/dids/resync`, {
    method: "POST",
  });
}
