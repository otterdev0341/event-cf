import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { CampaignStepIndicator } from '../components/CampaignStepIndicator';
import { AgentResultSetup } from '../components/AgentResultSetup';
import { useIsDev } from '../components/WorkspaceGate';
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
  const isDev = useIsDev();
  // Recording connects a Tool to the shared Agent, so only devs may turn it on.
  const [recordConversation, setRecordConversation] = useState(isDev && draft?.recordConversation === true);
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
  const locked = loading || saving || connecting;
  const pick = (id: string) => { setAgentId(id); setMessage(''); };
  return <div className="api-agent-page"><AppHeader /><main className="api-agent-main page-shell">
    <header className="rd-head"><div><a className="rd-back" href={routes.createCampaign}>← ย้อนกลับ: ตั้งค่าแคมเปญ</a><h1>เลือก Agent สำหรับแคมเปญ</h1><p>เลือกบอท แล้วเชื่อมระบบรับผลในขั้นตอนนี้ ก่อนจับคู่ข้อมูลจาก CSV</p></div></header>
    <CampaignStepIndicator activeStep={2} />
    {!draft ? <section className="workspace-empty"><h2>ยังไม่มีฉบับร่าง</h2><p>ตั้งค่าแคมเปญและอัปโหลด CSV ก่อนเลือก Agent</p><Button href={routes.createCampaign}>สร้างแคมเปญ</Button></section> : <>
      <div className="rd-split">
        <section className="rd-stack" aria-labelledby="agent-list-title">
          <div className="rd-filters" style={{justifyContent:'space-between'}}><div><h2 id="agent-list-title" className="rd-section-title">Voice Agent ในบัญชีของคุณ</h2><span className="rd-muted">{draft.name} · {draft.csv.rows.length.toLocaleString()} รายชื่อ · {draft.fileName}</span></div><Button variant="secondary" size="compact" disabled={locked} onClick={refetch}>{loading ? 'กำลังโหลด…' : 'รีเฟรช'}</Button></div>
          {error && <p className="workspace-alert" role="alert">โหลดรายชื่อ Agent ไม่สำเร็จ: {error}</p>}
          {!loading && !error && !agents.length && <p className="rd-card rd-empty" role="status">บัญชีนี้ยังไม่มี Agent</p>}
          <div className="rd-choices" role="radiogroup" aria-label="Voice Agent">
            {agentId && !selected && !loading && <button type="button" role="radio" aria-checked className="rd-choice" disabled={locked}><span className="rd-choice__ring" aria-hidden="true"/><span className="rd-choice__body"><strong>Agent เดิม</strong><span>{agentId} — ยังไม่พบในรายการ</span></span></button>}
            {agents.map(a => <button key={a.agent_id} type="button" role="radio" aria-checked={a.agent_id === agentId} className="rd-choice" disabled={locked} onClick={() => pick(a.agent_id)}>
              <span className="rd-choice__ring" aria-hidden="true"/>
              <span className="rd-choice__body"><strong>{a.name}</strong><span>{a.agent_id}</span></span>
              {a.agent_id === agentId && !detail.loading && !detail.error && <span className="rd-chip rd-chip--info rd-chip--plain">{detail.variables.length} ตัวแปร</span>}
            </button>)}
          </div>
          {draft.agentId && draft.agentId !== agentId && <p className="workspace-notice">เมื่อเปลี่ยน Agent ระบบจะเก็บการจับคู่ที่ตัวใหม่รองรับ และให้คุณตรวจอีกครั้งในขั้นตอนถัดไป</p>}
        </section>

        <aside className="rd-aside rd-stack">
          <section className="rd-card rd-pad rd-stack" aria-live="polite">
            <div className="rd-filters" style={{justifyContent:'space-between'}}><h2 className="rd-section-title" style={{fontSize:16}}>ตัวแปร Agent</h2>{selected && <button className="rd-link" type="button" disabled={detail.loading || saving || connecting} onClick={detail.refetch}>อ่านตัวแปรใหม่</button>}</div>
            {!selected ? <p className="rd-muted" style={{margin:0}}>เลือก Agent เพื่ออ่านตัวแปรจาก Prompt</p>
              : detail.loading ? <p className="rd-muted" role="status" style={{margin:0}}>กำลังอ่านบทสนทนาล่าสุด…</p>
              : detail.error ? <p className="workspace-alert" role="alert">{detail.error}</p>
              : <><span className="rd-muted">อ่านจาก Prompt ของ “{selected.name}”</span><div className="rd-codes">{detail.variables.map(v => <code key={v}>{v}</code>)}</div>{!detail.variables.length && <p className="rd-muted" style={{margin:0}}>ไม่พบตัวแปรในบทสนทนา จับคู่หมายเลขโทรศัพท์ได้ในขั้นตอนถัดไป</p>}<p className="rd-stat__note">ตัวแปรที่พบอาจมีทั้งข้อมูลก่อนโทรและผลลัพธ์หลังสนทนา</p></>}
          </section>
          <section className="rd-card rd-pad rd-stack">
            <h2 className="rd-section-title" style={{fontSize:16}}>ระบบรับผลหลังโทร</h2>
            {!isDev ? <p className="rd-muted" style={{margin:0}}>ทีมพัฒนาเป็นผู้เชื่อมระบบรับผลให้ Agent หากโทรไม่ได้เพราะยังไม่เชื่อม กรุณาแจ้งทีมพัฒนา</p> : selected ? <AgentResultSetup key={agentId} agentId={agentId} onConnected={detail.refetch} onBusy={setConnecting} /> : <p className="rd-muted" style={{margin:0}}>เมื่อเลือก Agent ระบบจะตรวจการเชื่อมรับผลให้ หากยังไม่เชื่อม คุณกดเชื่อมได้ที่นี่</p>}
          </section>
          {isDev && <section className={`rd-card rd-pad campaign-conversation-option${recordConversation ? ' enabled' : ''}`} aria-label="การบันทึกบทสนทนา"><label className="rd-toggle-row"><input type="checkbox" checked={recordConversation} disabled={saving || connecting} onChange={event => { setRecordConversation(event.target.checked); setMessage(''); }} /><span><strong>บันทึกบทสนทนา</strong><small>เก็บข้อความที่ผู้รับกับบอทคุยกัน ให้เปิดอ่านย้อนหลังในรายละเอียดแต่ละสาย</small></span></label><p className="rd-stat__note">{recordConversation ? 'เมื่อกดถัดไป ระบบจะสร้างหรือเชื่อม Tool ให้ Agent ที่เลือกอัตโนมัติ และเปิดการบันทึกสำหรับแคมเปญนี้' : 'ติ๊กเพื่อให้ระบบเชื่อม Tool บันทึกบทสนทนาอัตโนมัติในขั้นตอนนี้'} · หากวางสายก่อนส่งบันทึกอาจไม่มีข้อมูล · การบันทึกไฟล์เสียงเป็นอีกบริการหนึ่ง</p>{connectionMessage && <p role="status" className="rd-muted">{connectionMessage}</p>}</section>}
        </aside>
      </div>
      {message && <p className="workspace-alert" role="alert">{message}</p>}
      <footer className="rd-wizard-foot"><Button href={routes.createCampaign} variant="secondary">← ย้อนกลับ</Button><div><span className="rd-muted">ขั้นตอนที่ 2 จาก 4</span><Button disabled={saving || !ready} onClick={next}>{saving ? recordConversation ? 'กำลังเชื่อมและบันทึก…' : 'กำลังบันทึก…' : 'ถัดไป: จับคู่ข้อมูล →'}</Button></div></footer>
    </>}
  </main></div>;
}
