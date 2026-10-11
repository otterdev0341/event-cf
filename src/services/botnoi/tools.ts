import { botnoiFetch } from "./client";
import type { PlatformToolItem } from "./types";

/**
 * List all available platform tools (e.g. get_weather)
 * GET /platform-config/tools
 */
export async function listPlatformTools(): Promise<PlatformToolItem[]> {
  return botnoiFetch<PlatformToolItem[]>("/platform-config/tools");
}

/**
 * Create a new platform tool
 * POST /platform-config/tools
 */
export async function createPlatformTool(
  tool: Partial<PlatformToolItem>,
): Promise<PlatformToolItem> {
  return botnoiFetch<PlatformToolItem>("/platform-config/tools", {
    method: "POST",
    body: tool,
  });
}

/**
 * Update an existing platform tool
 * PUT /platform-config/tools/{tool_id}
 */
export async function updatePlatformTool(
  toolId: string,
  tool: Partial<PlatformToolItem>,
): Promise<PlatformToolItem> {
  return botnoiFetch<PlatformToolItem>(`/platform-config/tools/${encodeURIComponent(toolId)}`, {
    method: "PUT",
    body: tool,
  });
}

/**
 * Delete a platform tool
 * DELETE /platform-config/tools/{tool_id}
 */
export async function deletePlatformTool(toolId: string): Promise<void> {
  await botnoiFetch<void>(`/platform-config/tools/${encodeURIComponent(toolId)}`, {
    method: "DELETE",
  });
}

/**
 * Check backend health status
 * GET /health
 */
export async function checkHealth(): Promise<{ status: string }> {
  return botnoiFetch<{ status: string }>("/health");
}

/**
 * Check provisioning subsystem health
 * GET /v1/provisioning/healthz
 */
export async function checkProvisioningHealth(): Promise<{ status: string }> {
  return botnoiFetch<{ status: string }>("/v1/provisioning/healthz");
}
