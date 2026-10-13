import { useEffect, useRef, useState } from "react";
import { botnoiApi } from "../services/botnoi";
import { promptVariables } from "../../shared/campaign-inputs.mjs";
import { getCallUsage } from '../services/botnoi/usage';

function useRemote<T>(key: string, request: () => Promise<T>, enabled = true) {
  const requestRef = useRef(request);
  requestRef.current = request;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: T | null; loading: boolean; error: string | null }>({ key: '', data: null, loading: enabled, error: null });
  const requestKey = `${key}:${revision}`;
  useEffect(() => {
    let active = true;
    setResult({ key: requestKey, data: null, loading: enabled, error: null });
    if (enabled) void requestRef.current().then(data => {
      if (active) setResult({ key: requestKey, data, loading: false, error: null });
    }).catch(error => {
      if (active) setResult({ key: requestKey, data: null, loading: false, error: error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ' });
    });
    return () => { active = false; };
  }, [requestKey, enabled]);
  const current = result.key === requestKey ? result : { data: null, loading: enabled, error: null };
  return { ...current, refetch: () => setRevision(value => value + 1) };
}
export function useAccount() {
  const result = useRemote('account', async () => {
    const account = await botnoiApi.getAccount();
    if (!account?._id) throw new Error('API ไม่ส่งข้อมูลบัญชีที่ใช้งานได้');
    return account;
  });
  return { ...result, account: result.data, tenantId: result.data?._id };
}
export function useAgents() {
  const result = useRemote('agents', async () => {
    const agents = await botnoiApi.listAgents();
    if (!Array.isArray(agents)) throw new Error('รูปแบบรายชื่อ Agent ไม่ถูกต้อง');
    return agents;
  });
  return { ...result, agents: result.data ?? [] };
}
export function useAgentDetail(agentId?: string) {
  const result = useRemote(`agent:${agentId}`, () => botnoiApi.getAgent(agentId!), Boolean(agentId));
  const variables = promptVariables(result.data);
  return { ...result, agent: result.data, variables };
}
export function useCallLogs(agentId?: string) {
  const result = useRemote(`logs:${agentId}`, async () => {
    const response = await botnoiApi.listCallLogsPlatform(agentId, 100);
    if (!Array.isArray(response?.items)) throw new Error('รูปแบบประวัติสนทนาไม่ถูกต้อง');
    return response.items.filter(item => !agentId || item.agent_id === agentId);
  }, Boolean(agentId));
  return { ...result, logs: result.data ?? [] };
}
export function useConversationDetail(conversationId?: string) {
  const result = useRemote(`conversation:${conversationId}`, async () => {
    const response = await botnoiApi.getCallLogPlatform(conversationId!);
    if (!response.success || !response.data) throw new Error('ไม่พบข้อมูลบทสนทนา');
    return response.data;
  }, Boolean(conversationId));
  return { ...result, messages: result.data ? botnoiApi.parseConversationMessages(result.data.messages) : [] };
}
export function useTelephonyOverview(tenantId?: string) {
  const result = useRemote(`telephony:${tenantId}`, () => botnoiApi.getProvisioningOverview(tenantId!), Boolean(tenantId));
  return { ...result, overview: result.data };
}
export function useDashboardOverview(period: '7-days' | 'month' = '7-days', source: 'all' | 'outbound' | 'preview' = 'all') {
  const result = useRemote(`dashboard:${period}:${source}`, () => {
    const end = new Date();
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(end);
    const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
    const start = new Date(Date.UTC(part('year'), part('month') - 1, period === 'month' ? 1 : part('day') - 6) - 7 * 3600000);
    return botnoiApi.getDashboardOverview({ startAt: start.toISOString(), endAt: end.toISOString(), granularity: 'day', timezone: 'Asia/Bangkok', ...(source === 'all' ? {} : { source }) });
  });
  return { ...result, overview: result.data };
}
export function usePlatformTools() {
  const result = useRemote('tools', async () => {
    const tools = await botnoiApi.listPlatformTools();
    if (!Array.isArray(tools)) throw new Error('รูปแบบรายการเครื่องมือไม่ถูกต้อง');
    return tools;
  });
  return { ...result, tools: result.data ?? [] };
}

export function useCallUsage(period: '7-days' | 'month', source: 'all' | 'outbound' | 'inbound') {
  const result = useRemote(`call-usage:${period}:${source}`, () => {
    const end = new Date();
    const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(end);
    const part = (type: string) => Number(parts.find(item => item.type === type)?.value);
    const start = new Date(Date.UTC(part('year'), part('month') - 1, period === 'month' ? 1 : part('day') - 6) - 7 * 3600000);
    return getCallUsage(start.toISOString(), end.toISOString(), source);
  });
  return { ...result, report: result.data };
}
