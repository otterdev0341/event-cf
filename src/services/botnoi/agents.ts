import { botnoiFetch } from "./client";
import type { AgentDetail, AgentListItem } from "./types";

export async function listAgents(): Promise<AgentListItem[]> {
  return botnoiFetch<AgentListItem[]>("/agents");
}

export async function getAgent(agentId: string): Promise<AgentDetail> {
  return botnoiFetch<AgentDetail>(`/agents/${agentId}`);
}

export async function createOrUpdateAgent(
  data: Record<string, unknown>,
): Promise<{ success: boolean; bot_info: { agent_id: string } }> {
  return botnoiFetch<{ success: boolean; bot_info: { agent_id: string } }>(
    "/agent/create_update_agent",
    {
      method: "PUT",
      body: JSON.stringify(data),
    },
  );
}

export async function deleteAgent(
  agentId: string,
): Promise<{ success: boolean; message?: string }> {
  return botnoiFetch<{ success: boolean; message?: string }>(
    `/agent/delete/${agentId}`,
    {
      method: "DELETE",
    },
  );
}
