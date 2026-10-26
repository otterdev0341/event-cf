import { useRef, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { Dropdown } from '../components/Dropdown';
import { ConversationLog } from '../components/ConversationLog';
import { BotTestRoom } from '../components/BotTestRoom';
import { AgentResultSetup } from '../components/AgentResultSetup';
import { AgentRecordings } from '../components/AgentRecordings';
import { useAgents, useAgentDetail, useCallLogs } from '../hooks/useBotnoiData';
import type { PreviewData } from '../hooks/useVoicePreview';
import { parseCsv, type CsvData } from '../lib/campaigns';
import '../voice-preview.css';

export function LiveAgentPage() {
  const { agents, loading, error, refetch } = useAgents();
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const agentId = agents.find(agent => agent.agent_id === selected)?.agent_id || '';
  function openPreview(data: PreviewData) { setPreview(data); window.scrollTo({ top: 0, behavior: 'instant' }); }
  return <div className="live-agent-page"><AppHeader /><main className="page-shell real-data-page preview-page">
    {preview ? <BotTestRoom data={preview} onBack={() => setPreview(null)} /> : <header className="preview-heading"><div><span className="ui-kicker">AGENT PLAYGROUND</span><h1>ลองคุยกับบอทของคุณ</h1><p>เลือก Agent เตรียมข้อมูล แล้วโทรทดสอบเข้าเบอร์ของคุณ</p></div><span className="preview-chip">ทดสอบผ่านโทรศัพท์</span></header>}
    <div hidden={Boolean(preview)}>
      <ol className="preview-steps" aria-label="ขั้นตอนทดสอบ"><li className={!agentId ? 'current' : 'done'}><b>1</b> เลือกบอท</li><li className={agentId ? 'current' : ''}><b>2</b> เตรียมข้อมูล</li><li><b>3</b> ทดสอบบทสนทนา</li></ol>
      <section className="preview-card"><div className="preview-section-head"><div><span className="ui-kicker">YOUR AGENT</span><h2>เลือกบอทที่จะทดสอบ</h2></div><Button size="compact" variant="secondary" onClick={refetch} disabled={loading}>รีเฟรช Agent</Button></div>
        <div className="preview-field">Agent<Dropdown label="Agent" value={agentId} disabled={loading} onChange={setSelected} options={[{ value: '', label: 'เลือก Agent ของคุณ' }, ...agents.map(agent => ({ value: agent.agent_id, label: agent.name }))]} /></div>
        {loading && <p role="status">กำลังโหลด Agent…</p>}{error && <p role="alert" className="workspace-alert">{error}</p>}
        {!loading && !error && !agents.length && <p>ยังไม่มี Agent ในบัญชีที่เชื่อมไว้ <a href="/settings">ตรวจการเชื่อมต่อบัญชี</a></p>}
      </section>
      {agentId ? <AgentPreparation key={agentId} agentId={agentId} onTest={openPreview} /> : <section className="preview-empty"><span aria-hidden="true">✦</span><h2>เริ่มจากบอทที่อยากคุยด้วย</h2><p>เมื่อเลือกแล้ว ตัวแปรจาก Prompt จะปรากฏให้คุณเตรียมข้อมูล</p></section>}
    </div>
    {(preview?.agentId || agentId) && <AgentRecordings key={preview?.agentId || agentId} agentId={preview?.agentId || agentId} />}
  </main></div>;
}

function AgentPreparation({ agentId, onTest }: { agentId: string; onTest: (data: PreviewData) => void }) {
  const { agent, variables, loading, error, refetch } = useAgentDetail(agentId);
  const [csv, setCsv] = useState<CsvData | null>(null);
  const [fileName, setFileName] = useState('');
  const [row, setRow] = useState(0);
  const [sources, setSources] = useState<Record<string, string>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState('');
  const [reading, setReading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const upload = useRef(0);
  const sourceOf = (key: string) => sources[key] ?? (['call_result', 'needs_agent'].includes(key) ? 'output' : 'manual');
  const valueOf = (key: string) => sourceOf(key).startsWith('csv:') ? csv?.rows[row]?.[Number(sourceOf(key).slice(4))] || '' : manual[key] || '';
  const inputs = variables.filter(key => sourceOf(key) !== 'output');
  const complete = inputs.filter(key => valueOf(key).trim() && valueOf(key).length <= 2000).length;
  async function loadCsv(file?: File) {
    const version = ++upload.current;
    if (!file) return;
    setReading(true); setFileError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('รองรับไฟล์ CSV ขนาดไม่เกิน 2 MB');
      const parsed = parseCsv(await file.text());
      if (version !== upload.current) return;
      setCsv(parsed); setFileName(file.name); setRow(0);
      setSources(Object.fromEntries(variables.map(key => {
        const column = parsed.headers.findIndex(header => header.toLowerCase() === key.toLowerCase());
        return [key, sourceOf(key) === 'output' ? 'output' : column >= 0 ? `csv:${column}` : 'manual'];
      })));
    } catch (caught) { if (version === upload.current) setFileError(caught instanceof Error ? caught.message : 'อ่าน CSV ไม่สำเร็จ'); }
    finally { if (version === upload.current) setReading(false); }
  }
  return <>
    <section className="preview-card"><div className="preview-section-head"><div><span className="ui-kicker">TEST DATA</span><h2>เตรียมข้อมูลสำหรับบทสนทนา</h2><p>กรอกค่าทดสอบ หรือจับคู่คอลัมน์จาก CSV โดยเลือกใช้ข้อมูลครั้งละ 1 แถว</p></div><Button variant="secondary" size="compact" onClick={refetch} disabled={loading}>ดึงตัวแปรล่าสุด</Button></div>
      {loading ? <p role="status">กำลังดึงตัวแปรจาก Agent…</p> : error ? <p className="workspace-alert" role="alert">{error}</p> : agent && <>
        <div className="preview-import"><div><strong>ใช้ข้อมูลจากไฟล์ CSV</strong><p>{fileName || 'ไม่บังคับอัปโหลด คุณกรอกค่าทดสอบเองได้'}</p></div><label className="button button--secondary button--compact preview-upload">{reading ? 'กำลังอ่าน…' : csv ? 'เปลี่ยนไฟล์ CSV' : 'เลือกไฟล์ CSV'}<input type="file" accept=".csv,text/csv" disabled={reading} onChange={event => { void loadCsv(event.target.files?.[0]); event.target.value = ''; }} /></label></div>
        {fileError && <p role="alert" className="workspace-alert">{fileError}</p>}
        {csv && <div className="preview-field">แถวข้อมูลที่ใช้ทดสอบ<Dropdown label="แถวข้อมูลที่ใช้ทดสอบ" value={String(row)} onChange={v => setRow(Number(v))} options={csv.rows.map((cells, index) => ({ value: String(index), label: `แถว ${index + 1} · ${cells.slice(0, 3).join(' · ').slice(0, 110)}` }))} /></div>}
        {variables.length ? <div className="preview-bindings"><div className="preview-binding-labels"><span>ตัวแปรของบอท</span><span>แหล่งข้อมูล</span><span>ค่าที่ใช้ทดสอบ</span></div>{variables.map(key => <div key={key} className="preview-binding"><code>{`{{${key}}}`}</code><Dropdown label={`แหล่งข้อมูล ${key}`} value={sourceOf(key)} onChange={v => setSources(previous => ({ ...previous, [key]: v }))} options={[{ value: 'manual', label: 'กรอกค่าทดสอบ' }, ...(csv?.headers ?? []).map((header, index) => ({ value: `csv:${index}`, label: header })), { value: 'output', label: 'ผลลัพธ์หลังสนทนา' }]} />{sourceOf(key) === 'output' ? <span className="preview-output">รอคำตอบจากบทสนทนา</span> : sourceOf(key) === 'manual' ? <input aria-label={`ค่าทดสอบ ${key}`} maxLength={2000} placeholder={`ใส่ค่า ${key}`} value={manual[key] || ''} onChange={event => setManual(previous => ({ ...previous, [key]: event.target.value }))} /> : <span className={valueOf(key).trim() ? 'preview-csv-value' : 'preview-missing'}>{valueOf(key) || 'แถวนี้ไม่มีข้อมูล'}</span>}</div>)}</div> : <p className="preview-info">Agent นี้ไม่มีตัวแปรใน Prompt สามารถเปิดห้องทดสอบได้เลย</p>}
        <p className="workspace-note">ตัวแปรที่บอทใช้เก็บคำตอบ เช่น call_result ให้เลือก “ผลลัพธ์หลังสนทนา”</p>
        <AgentResultSetup agentId={agentId} onConnected={refetch} onBusy={setConnecting} />
        <div className="preview-start-bar"><div><strong>ข้อมูลพร้อม {complete} / {inputs.length} ตัวแปร</strong><p>ขั้นต่อไปตรวจเบอร์และยืนยันให้ {agent.bot_name || 'บอท'} โทรหาคุณ</p></div><Button disabled={complete !== inputs.length || reading || connecting} onClick={() => onTest({ agentId, name: agent.bot_name || 'Voice Agent', variables: Object.fromEntries(inputs.map(key => [key, valueOf(key).trim()])), outputs: variables.filter(key => sourceOf(key) === 'output') })}>ทดสอบบอท <span aria-hidden="true">→</span></Button></div>
      </>}
    </section>
    <details className="preview-records" onToggle={event => setShowRecords(event.currentTarget.open)}><summary>บันทึกสนทนาจากบริการ</summary>{showRecords && <AgentRecords agentId={agentId} />}</details>
  </>;
}

function AgentRecords({ agentId }: { agentId: string }) {
  const records = useCallLogs(agentId);
  const [conversationId, setConversationId] = useState('');
  return <section className="activity-section"><Button size="compact" variant="secondary" onClick={() => { setConversationId(''); records.refetch(); }} disabled={records.loading}>รีเฟรชบันทึก</Button>{records.loading ? <p role="status">กำลังโหลดบันทึก…</p> : records.error ? <p role="alert" className="workspace-alert">{records.error}</p> : records.logs.length ? <div className="preview-field">เลือกบันทึก<Dropdown label="เลือกบันทึก" value={conversationId} onChange={setConversationId} options={[{ value: '', label: 'เลือกบทสนทนา' }, ...records.logs.map(log => ({ value: log.conversation_id, label: `${Number.isFinite(Date.parse(log.started_at)) ? new Date(log.started_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ไม่ระบุเวลา'} · ${log.display_name || log.conversation_id}` }))]} /></div> : <p>ยังไม่มีบันทึกสนทนาของ Agent นี้</p>}<ConversationLog conversationId={conversationId || undefined} /></section>;
}
