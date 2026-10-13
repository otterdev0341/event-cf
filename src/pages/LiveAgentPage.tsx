import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { ConversationLog } from '../components/ConversationLog';
import { useAgents, useAgentDetail, useCallLogs } from '../hooks/useBotnoiData';
import { routes } from '../routes';
export function LiveAgentPage() {
  const { agents, loading, error, refetch } = useAgents();
  const [selected, setSelected] = useState('');
  const agentId = agents.find(agent => agent.agent_id === selected)?.agent_id || agents[0]?.agent_id;
  return <div className="live-agent-page"><AppHeader /><main className="page-shell real-data-page"><header><span className="ui-kicker">VOICE AGENTS</span><h1>Agent และบทสนทนา</h1><p>ดูการตั้งค่า Agent และบันทึกการสนทนา</p></header><div className="workspace-toolbar"><label>เลือก Agent<select className="workspace-select" value={agentId || ''} disabled={loading || !agents.length} onChange={e => setSelected(e.target.value)}>{!agents.length && <option value="">ยังไม่มีข้อมูล Agent</option>}{agents.map(agent => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}</select></label><Button size="compact" variant="secondary" onClick={refetch} disabled={loading}>รีเฟรช Agent</Button></div>
    {loading && <p role="status">กำลังโหลด Agent…</p>}{error && <p role="alert" className="workspace-alert">{error}</p>}
    <div className="workspace-local-note"><p>ทดสอบบทสนทนาผ่านสายโทรศัพท์ <span>เลือก Agent แล้วไปหน้าโทรทดสอบเพื่อตรวจการพูดและการรับผล</span></p><a href={routes.apiTest}>ไปหน้าโทรทดสอบ ↗</a></div>
    {agentId && <AgentRecords key={agentId} agentId={agentId} />}
    {!loading && !error && !agents.length && <section className="workspace-empty">ไม่พบ Agent ในบัญชีนี้</section>}
    <Button size="compact" href={routes.apiTest}>ไปหน้าโทรทดสอบ</Button>
  </main></div>;
}
function AgentRecords({ agentId }: { agentId: string }) {
  const { agent, variables, loading, error } = useAgentDetail(agentId);
  const records = useCallLogs(agentId);
  const [conversationId, setConversationId] = useState('');
  return <><section className="activity-section"><h2>การตั้งค่า Agent</h2>{loading ? <p role="status">กำลังโหลดรายละเอียด…</p> : error ? <p role="alert" className="workspace-alert">{error}</p> : agent ? <><p>{agent.bot_name} · {agent.agent_id}</p><h3>ข้อความทักทายที่ตั้งไว้</h3><p className="real-text">{agent.agent_data?.greeting_text || 'ไม่ได้ระบุข้อความทักทาย'}</p><p>ตัวแปรใน Prompt: {variables.length ? variables.map(variable => `{{${variable}}}`).join(', ') : 'ไม่พบตัวแปร'}</p></> : <p>ไม่มีข้อมูล Agent</p>}</section>
    <section className="activity-section"><h2>บันทึกสนทนาล่าสุด</h2><p className="workspace-note">สูงสุด 100 รายการจากบริการบันทึกสนทนา</p><Button size="compact" variant="secondary" onClick={() => { setConversationId(''); records.refetch(); }} disabled={records.loading}>รีเฟรชบันทึก</Button>{records.loading ? <p role="status">กำลังโหลดบันทึก…</p> : records.error ? <p role="alert" className="workspace-alert">{records.error}</p> : records.logs.length ? <label>เลือกบันทึก<select className="workspace-select" value={conversationId} onChange={e => setConversationId(e.target.value)}><option value="">เลือกบทสนทนา</option>{records.logs.map(log => <option key={log.conversation_id} value={log.conversation_id}>{Number.isFinite(Date.parse(log.started_at)) ? new Date(log.started_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ไม่ระบุเวลา'} · {log.display_name || log.conversation_id}</option>)}</select></label> : <p>ยังไม่มีบันทึกสนทนาของ Agent นี้</p>}
      <ConversationLog conversationId={conversationId || undefined} />
    </section></>;
}
