import { botnoiFetch } from "./client";
import type {
  TelephonyConfig,
  TenantOverviewResponse,
  TrunkStatus,
} from "./types";

/**
 * Get Telephony configuration for a tenant (PBX, trunk, outbound, inbound)
 * GET /v1/provisioning/tenants/{tenant_id}
 */
export async function getTelephonyConfig(tenantId: string): Promise<TelephonyConfig> {
  return botnoiFetch<TelephonyConfig>(`/v1/provisioning/tenants/${tenantId}`);
}

/**
 * Create or update Telephony configuration for a tenant
 * PUT /v1/provisioning/tenants/{tenant_id}
 */
export async function updateTelephonyConfig(
  tenantId: string,
  payload: Partial<TelephonyConfig>,
): Promise<TelephonyConfig> {
  return botnoiFetch<TelephonyConfig>(`/v1/provisioning/tenants/${tenantId}`, {
    method: "PUT",
    body: payload,
  });
}

/**
 * Delete Telephony configuration for a tenant
 * DELETE /v1/provisioning/tenants/{tenant_id}
 */
export async function deleteTelephonyConfig(tenantId: string): Promise<void> {
  await botnoiFetch<void>(`/v1/provisioning/tenants/${tenantId}`, {
    method: "DELETE",
  });
}

/**
 * Get live SIP trunk registration and reachability status
 * GET /v1/provisioning/tenants/{tenant_id}/trunk/status
 */
export async function getTrunkStatus(tenantId: string): Promise<TrunkStatus> {
  return botnoiFetch<TrunkStatus>(`/v1/provisioning/tenants/${tenantId}/trunk/status`);
}

/**
 * Update SIP trunk password
 * POST /v1/provisioning/tenants/{tenant_id}/trunk/password
 */
export async function updateTrunkPassword(
  tenantId: string,
  password: string,
): Promise<{ ok: boolean }> {
  return botnoiFetch<{ ok: boolean }>(`/v1/provisioning/tenants/${tenantId}/trunk/password`, {
    method: "POST",
    body: { password },
  });
}

/**
 * Get consolidated Provisioning Overview (tenant config + trunk status + usage) in one round trip
 * GET /v1/provisioning/tenants/{tenant_id}/overview
 */
export async function getProvisioningOverview(
  tenantId: string,
  options?: { include?: string; month?: string },
): Promise<TenantOverviewResponse> {
  const params = new URLSearchParams();
  if (options?.include) params.set("include", options.include);
  if (options?.month) params.set("month", options.month);

  const query = params.toString() ? `?${params.toString()}` : "";
  return botnoiFetch<TenantOverviewResponse>(`/v1/provisioning/tenants/${tenantId}/overview${query}`);
}

/**
 * Enable tenant telephony
 * POST /v1/provisioning/tenants/{tenant_id}/enable
 */
export async function enableTenant(tenantId: string): Promise<void> {
  await botnoiFetch<void>(`/v1/provisioning/tenants/${tenantId}/enable`, {
    method: "POST",
  });
}

/**
 * Disable tenant telephony
 * POST /v1/provisioning/tenants/{tenant_id}/disable
 */
export async function disableTenant(tenantId: string): Promise<void> {
  await botnoiFetch<void>(`/v1/provisioning/tenants/${tenantId}/disable`, {
    method: "POST",
  });
}
