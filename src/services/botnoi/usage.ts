import { botnoiFetch } from './client';

export interface CallUsageCounts {
  call_count: number; completed: number; failed: number; other: number;
  duration_seconds: number; duration_count: number;
}
export interface CallUsage {
  window: { start_at: string; end_at: string; timezone: string };
  checked_at: string; source: string; summary: CallUsageCounts;
  series: (CallUsageCounts & { date: string })[];
}
export function getCallUsage(start: string, end: string, source: 'all' | 'outbound' | 'inbound') {
  const query = new URLSearchParams({ start_at: start, end_at: end, source });
  return botnoiFetch<CallUsage>(`/workspace/usage?${query}`);
}
