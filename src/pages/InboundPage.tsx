import { useEffect, useState } from 'react';
import { InboundKnowledge } from '../components/InboundKnowledge';
import { GeneralEventSetup } from '../components/GeneralEventSetup';
import { AgentRecordings } from '../components/AgentRecordings';
import { useAgentDetail } from '../hooks/useBotnoiData';
import { getInboundSetup } from '../services/botnoi/inbound';
import { routes } from '../routes';
import '../inbound.css';

// Caller knowledge and bot data, shown below the outbound board.
export function OutboundSetup() {
  const [error, setError] = useState('');
  // Agent bound to the account's first number; drives the event setup and recordings below.
  const [agentId, setAgentId] = useState('');
  const agent = useAgentDetail(agentId || undefined);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]);
    void getInboundSetup(signal).then(result => { if (!controller.signal.aborted) setAgentId(result.numbers[0]?.agent_id || ''); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'โหลดข้อมูล Agent ไม่ได้'); });
    return () => controller.abort();
  }, []);

  return <>
    {error && <div className="workspace-alert" role="alert">{error} <a href={routes.settings}>ตรวจบัญชีที่เชื่อม →</a></div>}
    {agentId && <GeneralEventSetup agentId={agentId} onConnected={agent.refetch} />}
    <InboundKnowledge callId="" />
    {agentId && <AgentRecordings key={agentId} agentId={agentId} />}
  </>;
}
