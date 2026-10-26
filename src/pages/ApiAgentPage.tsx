import { Dropdown } from '../components/Dropdown';
import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { CampaignStepIndicator } from '../components/CampaignStepIndicator';
import { AgentResultSetup } from '../components/AgentResultSetup';
import { useAgents, useAgentDetail } from '../hooks/useBotnoiData';
import { getDraft, saveDraft, mappingForAgent } from '../lib/campaigns';
import { routes } from '../routes';
import { botnoiApi } from '../services/botnoi';
import { botnoiFetch } from '../services/botnoi/client';
export function ApiAgentPage() {
  const [draft] = useState(getDraft);
  const [agentId, setAgentId] = useState(draft?.agentId ?? '');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [recordConversation, setRecordConversation] = useState(draft?.recordConversation === true);
  const [connectionMessage, setConnectionMessage] = useState('');
  const { agents, loading, error, refetch } = useAgents();
  const selected = agents.find(a => a.agent_id === agentId);
  const detail = useAgentDetail(selected?.agent_id);
  const ready = Boolean(selected && detail.agent && !loading && !error && !detail.loading && !detail.error && !connecting);
  async function next() {
    if (!draft || saving || !ready) return;
    setSaving(true); setMessage('');
    try {
      if (recordConversation) {
        setConnectionMessage('กำลังตรวจและเชื่อม Tool บันทึกบทสนทนา…');
        const path = `/workspace/agents/${encodeURIComponent(agentId)}/transcript-setup`;
        const status = await botnoiFetch<{ connected: boolean; revision: string }>(path);
        if (!status.connected) {
          const connected = await botnoiFetch<{ connected: boolean }>(path, { method: 'POST', body: { confirm: true, expected_revision: status.revision } });
          if (!connected.connected) throw new Error('ยังยืนยันการเชื่อมบันทึกบทสนทนาไม่ได้ กรุณาลองใหม่');
        }
        setConnectionMessage('เชื่อมบันทึกบทสนทนาแล้ว กำลังบันทึกแคมเปญ…');
      }
      const variables = Object.fromEntries(Object.entries(draft.variables || {}).filter(([key]) => detail.variables.includes(key)));
      const account=await botnoiApi.getAccount();
      const changed=draft.agentId!==agentId || Boolean(draft.voiceAccountId && draft.voiceAccountId!==account._id);
      await saveDraft({ ...draft, recordConversation, voiceAccountId:account._id, agentId, variables, variableBindings: changed ? {} : Object.fromEntries(Object.entries(draft.variableBindings || {}).filter(([key]) => detail.variables.includes(key))), mapping: mappingForAgent(draft.csv, draft.mapping, detail.variables, changed) });
      window.location.assign(routes.dataMapping);
    } catch (err) { setConnectionMessage(''); setMessage((err as Error).message); } finally { setSaving(false); }
  }
  return <div className="api-agent-page"><AppHeader /><main className="api-agent-main page-shell">
    <header className="api-agent-title"><span className="ui-kicker">ขั้นตอนที่ 2 จาก 4</span><h1>เลือก Agent และเชื่อมระบบรับผล</h1><p>เลือกบอท แล้วกดเชื่อมระบบรับผลในขั้นตอนนี้ ก่อนจับคู่ข้อมูลจาก CSV</p></header>
    <CampaignStepIndicator activeStep={2} />
    {!draft ? <section className="workspace-empty"><h2>ยังไม่มีฉบับร่าง</h2><p>ตั้งค่าแคมเปญและอัปโหลด CSV ก่อนเลือก Agent</p><Button href={routes.createCampaign}>สร้างแคมเปญ</Button></section> : <>
      <section className="api-preview-panel"><header className="api-preview-panel__header"><div><h2>{draft.name}</h2><p>{draft.csv.rows.length.toLocaleString()} รายชื่อ · {draft.fileName}</p></div></header>
        <div className="campaign-form__field"><span>Voice Agent</span><Dropdown label="Voice Agent" value={agentId} disabled={loading || saving || connecting} onChange={id => { setAgentId(id); setMessage(''); }} options={[{ value: '', label: 'เลือก Agent สำหรับแคมเปญ' }, ...(agentId && !selected ? [{ value: agentId, label: `Agent เดิม (${agentId}) — ยังไม่พบในรายการ` }] : []), ...agents.map(a => ({ value: a.agent_id, label: a.name }))]} /></div>
        {error && <p className="workspace-alert" role="alert">โหลดรายชื่อ Agent ไม่สำเร็จ: {error}</p>}
        {!loading && !error && !agents.length && <p role="status">บัญชีนี้ยังไม่มี Agent</p>}
        <Button variant="secondary" size="compact" disabled={loading || saving || connecting} onClick={refetch}>{loading ? 'กำลังโหลด Agent…' : 'รีเฟรชรายชื่อ Agent'}</Button>
        {!selected && <p className="workspace-note">เมื่อเลือก Agent ระบบจะตรวจการเชื่อมรับผลให้ หากยังไม่เชื่อม คุณกดเชื่อมได้ที่นี่</p>}
        {selected && <AgentResultSetup key={agentId} agentId={agentId} onConnected={detail.refetch} onBusy={setConnecting} />}
        <section className={`campaign-conversation-option${recordConversation ? ' enabled' : ''}`} aria-label="การบันทึกบทสนทนา"><label><input type="checkbox" checked={recordConversation} disabled={saving || connecting} onChange={event => { setRecordConversation(event.target.checked); setMessage(''); }} /><span><strong>บันทึกบทสนทนา</strong><small>เก็บข้อความที่ผู้รับกับบอทคุยกัน ให้เปิดอ่านย้อนหลังในรายละเอียดแต่ละสาย</small></span></label><p>{recordConversation ? 'เมื่อกดถัดไป ระบบจะสร้างหรือเชื่อม Tool ให้ Agent ที่เลือกอัตโนมัติ และเปิดการบันทึกสำหรับแคมเปญนี้' : 'ติ๊กเพื่อให้ระบบเชื่อม Tool บันทึกบทสนทนาอัตโนมัติในขั้นตอนนี้'}</p><p className="workspace-note">บันทึกเป็นข้อความที่บอทส่งกลับ หากวางสายก่อนส่งบันทึกอาจไม่มีข้อมูล · การบันทึกไฟล์เสียงเป็นอีกบริการหนึ่ง</p>{connectionMessage && <p role="status">{connectionMessage}</p>}</section>
        {selected && <div className="wizard-agent-detail" aria-live="polite"><h3>ตัวแปรจาก {selected.name}</h3>
          {detail.loading ? <p role="status">กำลังอ่านบทสนทนาล่าสุด…</p> : detail.error ? <p className="workspace-alert" role="alert">{detail.error}</p> : <><div className="wizard-variable-list">{detail.variables.map(v => <code key={v}>{v}</code>)}</div>{!detail.variables.length && <p>ไม่พบตัวแปรในบทสนทนา จับคู่หมายเลขโทรศัพท์ได้ในขั้นตอนถัดไป</p>}<p className="workspace-note">อ่านจากข้อความทักทายและ Prompt ตัวแปรที่พบอาจมีทั้งข้อมูลก่อนโทรและผลลัพธ์หลังสนทนา</p></>}
          <Button variant="secondary" size="compact" disabled={detail.loading || saving || connecting} onClick={detail.refetch}>อ่านตัวแปรใหม่</Button>
        </div>}
        {draft.agentId && draft.agentId !== agentId && <p className="workspace-notice">เมื่อเปลี่ยน Agent ระบบจะเก็บการจับคู่ที่ตัวใหม่รองรับ และให้คุณตรวจอีกครั้งในขั้นตอนถัดไป</p>}
      </section>
      {message && <p className="workspace-alert" role="alert">{message}</p>}
      <section className="api-agent-actions"><Button href={routes.createCampaign} size="compact" variant="secondary">ย้อนกลับ: ตั้งค่าแคมเปญ</Button><Button size="compact" disabled={saving || !ready} onClick={next}>{saving ? recordConversation ? 'กำลังเชื่อมและบันทึก…' : 'กำลังบันทึก…' : 'ถัดไป: จับคู่ข้อมูล →'}</Button></section>
    </>}
  </main></div>;
}
