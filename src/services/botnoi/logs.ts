import { botnoiFetch, botnoiFetchBlob } from "./client";
import type {
  CallLogPlatformDetail,
  CallLogPlatformItem,
  ParsedConversationMessage,
  ReadLogResponse,
} from "./types";

export async function listCallLogsPlatform(
  agentId?: string,
  limit: number = 50,
): Promise<{ items: CallLogPlatformItem[] }> {
  const query = new URLSearchParams();
  if (agentId) query.set("agent_id", agentId);
  if (limit) query.set("limit", limit.toString());

  const queryString = query.toString();
  return botnoiFetch<{ items: CallLogPlatformItem[] }>(
    `/logs/call_logs_platform${queryString ? `?${queryString}` : ""}`,
  );
}

export async function getCallLogPlatform(
  conversationId: string,
): Promise<{ success: boolean; data: CallLogPlatformDetail }> {
  return botnoiFetch<{ success: boolean; data: CallLogPlatformDetail }>(
    `/logs/call_logs_platform/${encodeURIComponent(conversationId)}`,
  );
}

export function parseConversationMessages(rawMessages: string): ParsedConversationMessage[] {
  if (typeof rawMessages !== "string" || !rawMessages.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(rawMessages);
    if (Array.isArray(parsed)) return parsed.flatMap(item => {
      if (item === null || item === undefined) return [];
      const record = typeof item === "object" ? item as Record<string, unknown> : {};
      const role: ParsedConversationMessage["role"] = record.role === "assistant" || record.role === "agent" ? "assistant" : record.role === "user" ? "user" : "system";
      const text = typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : typeof item === "string" ? item : JSON.stringify(item);
      return text.trim() ? [{ role, text }] : [];
    });
  } catch { /* Preserve non-JSON transcripts as received. */ }
  return [{ role: "system", text: rawMessages }];
}

export async function listLogFiles(
  agentId: string,
  startDate?: string,
  endDate?: string,
): Promise<string[]> {
  const query = new URLSearchParams({ agent_id: agentId });
  if (startDate) query.set("start_date", startDate);
  if (endDate) query.set("end_date", endDate);

  // Note: Trailing slash is strictly required by Botnoi documentation
  return botnoiFetch<string[]>(`/logs/list_file/?${query.toString()}`);
}

export async function readLog(filePath: string): Promise<ReadLogResponse> {
  // Note: Trailing slash is strictly required by Botnoi documentation
  const query = new URLSearchParams({ file_path: filePath });
  return botnoiFetch<ReadLogResponse>(`/logs/read_log/?${query.toString()}`);
}


/**
 * Fetch a selected owned recording through the authenticated workspace route.
 */
export async function fetchAudioBlob(agentId: string, recordingId: string, startDate: string, endDate: string): Promise<Blob> {
  const query = new URLSearchParams({ start_date: startDate, end_date: endDate });
  return botnoiFetchBlob(`/workspace/agents/${encodeURIComponent(agentId)}/audio/${encodeURIComponent(recordingId)}?${query.toString()}`);
}

