import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { CampaignStepIndicator } from '../components/CampaignStepIndicator';
import { AgentResultSetup } from '../components/AgentResultSetup';
import { useAgents, useAgentDetail } from '../hooks/useBotnoiData';
import { getDraft, saveDraft, mappingForAgent } from '../lib/campaigns';
import { routes } from '../routes';
import { botnoiApi } from '../services/botnoi';
export function ApiAgentPage() {
  const [draft] = useState(getDraft);
  const [agentId, setAgentId] = useState(draft?.agentId ?? '');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const { agents, loading, error, refetch } = useAgents();
  const selected = agents.find(a => a.agent_id === agentId);
  const detail = useAgentDetail(selected?.agent_id);
  const ready = Boolean(selected && detail.agent && !loading && !error && !detail.loading && !detail.error && !connecting);
  async function next() {
    if (!draft || saving || !ready) return;
    setSaving(true); setMessage('');
    try {
      const variables = Object.fromEntries(Object.entries(draft.variables || {}).filter(([key]) => detail.variables.includes(key)));
      const account=await botnoiApi.getAccount();
      const changed=draft.agentId!==agentId || Boolean(draft.voiceAccountId && draft.voiceAccountId!==account._id);
      await saveDraft({ ...draft, voiceAccountId:account._id, agentId, variables, variableBindings: changed ? {} : Object.fromEntries(Object.entries(draft.variableBindings || {}).filter(([key]) => detail.variables.includes(key))), mapping: mappingForAgent(draft.csv, draft.mapping, detail.variables, changed) });
      window.location.assign(routes.dataMapping);
    } catch (err) { setMessage((err as Error).message); } finally { setSaving(false); }
  }
  return <div className="api-agent-page"><AppHeader /><main className="api-agent-main page-shell">
    <header className="api-agent-title"><span className="ui-kicker">ขั้นตอนที่ 2 จาก 4</span><h1>เลือก Voice Agent</h1><p>เลือกบอทก่อน เพื่อใช้ตัวแปรในบทสนทนาของบอทจับคู่กับรายชื่อ</p></header>
    <CampaignStepIndicator activeStep={2} />
    {!draft ? <section className="workspace-empty"><h2>ยังไม่มีฉบับร่าง</h2><p>ตั้งค่าแคมเปญและอัปโหลด CSV ก่อนเลือก Agent</p><Button href={routes.createCampaign}>สร้างแคมเปญ</Button></section> : <>
      <section className="api-preview-panel"><header className="api-preview-panel__header"><div><h2>{draft.name}</h2><p>{draft.csv.rows.length.toLocaleString()} รายชื่อ · {draft.fileName}</p></div></header>
        <label className="campaign-form__field"><span>Voice Agent</span><select className="workspace-select" value={agentId} onChange={e => { setAgentId(e.target.value); setMessage(''); }} disabled={loading || saving || connecting}><option value="">เลือก Agent สำหรับแคมเปญ</option>{agentId && !selected && <option value={agentId}>Agent เดิม ({agentId}) — ยังไม่พบในรายการ</option>}{agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.name}</option>)}</select></label>
        {error && <p className="workspace-alert" role="alert">โหลดรายชื่อ Agent ไม่สำเร็จ: {error}</p>}
        {!loading && !error && !agents.length && <p role="status">บัญชีนี้ยังไม่มี Agent</p>}
        <Button variant="secondary" size="compact" disabled={loading || saving} onClick={refetch}>{loading ? 'กำลังโหลด Agent…' : 'รีเฟรชรายชื่อ Agent'}</Button>
        {selected && <AgentResultSetup key={agentId} agentId={agentId} onConnected={detail.refetch} onBusy={setConnecting} />}
        {selected && <div className="wizard-agent-detail" aria-live="polite"><h3>ตัวแปรจาก {selected.name}</h3>
          {detail.loading ? <p role="status">กำลังอ่านบทสนทนาล่าสุด…</p> : detail.error ? <p className="workspace-alert" role="alert">{detail.error}</p> : <><div className="wizard-variable-list">{detail.variables.map(v => <code key={v}>{v}</code>)}</div>{!detail.variables.length && <p>ไม่พบตัวแปรในบทสนทนา จับคู่หมายเลขโทรศัพท์ได้ในขั้นตอนถัดไป</p>}<p className="workspace-note">อ่านจากข้อความทักทายและ Prompt ตัวแปรที่พบอาจมีทั้งข้อมูลก่อนโทรและผลลัพธ์หลังสนทนา</p></>}
          <Button variant="secondary" size="compact" disabled={detail.loading || saving} onClick={detail.refetch}>อ่านตัวแปรใหม่</Button>
        </div>}
        {draft.agentId && draft.agentId !== agentId && <p className="workspace-notice">เมื่อเปลี่ยน Agent ระบบจะเก็บการจับคู่ที่ตัวใหม่รองรับ และให้คุณตรวจอีกครั้งในขั้นตอนถัดไป</p>}
      </section>
      {message && <p className="workspace-alert" role="alert">{message}</p>}
      <section className="api-agent-actions"><Button href={routes.createCampaign} size="compact" variant="secondary">ย้อนกลับ: ตั้งค่าแคมเปญ</Button><Button size="compact" disabled={saving || !ready} onClick={next}>{saving ? 'กำลังบันทึก…' : 'ถัดไป: จับคู่ข้อมูล →'}</Button></section>
    </>}
  </main></div>;
}
