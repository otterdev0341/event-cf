import { useEffect, useRef, useState } from 'react';
import { ApiCodePanel } from '../components/ApiCodePanel';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { botnoiApi } from '../services/botnoi';
import type { AccountProfile, TrunkStatus, TelephonyConfig, CallStatusResponse } from '../services/botnoi';
import { getCampaigns, getDraft, saveDraft, mappingErrors, normalizePhone, formatDialDestination, DEFAULT_DIAL_FORMAT, resolveVariables } from '../lib/campaigns';
import { routes } from '../routes';
import { useAgents, useAgentDetail } from '../hooks/useBotnoiData';
type TestState = 'idle' | 'loading' | 'success' | 'error';
export function ApiTestWorkspacePage() {
  const [campaignId] = useState(() => new URLSearchParams(window.location.search).get('campaign'));
  const campaignMode = campaignId !== null;
  const [draft] = useState(() => campaignMode ? getCampaigns().find(c => c.id === campaignId) ?? null : getDraft());
  const phoneForRow = (row: number) => draft?.csv.rows[row]?.[draft.csv.headers.findIndex(h => draft.mapping[h] === 'phone')] || '';
  const initialRow = campaignMode && draft ? 0 : -1;
  const { agents, loading: agentsLoading, error: agentsError } = useAgents();
  const [selectedAgentId, setSelectedAgentId] = useState(draft?.agentId || '');
  const agentId = agents.some(agent => agent.agent_id === selectedAgentId) ? selectedAgentId : '';
  const detail = useAgentDetail(agentId);
  const [contactRow, setContactRow] = useState(initialRow);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const [saveBusy, setSaveBusy] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [uncertainRequest, setUncertainRequest] = useState(false);
  const [state, setState] = useState<TestState>('idle');
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [trunk, setTrunk] = useState<TrunkStatus | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [message, setMessage] = useState('ยังไม่ได้ทดสอบการเชื่อมต่อ');
  const [error, setError] = useState('');
  const [phone, setPhone] = useState(() => phoneForRow(initialRow));
  const resolvedVariables = resolveVariables(draft, contactRow, variableValues);
  // A destination column can also supply the Agent's phone_number input.
  if (campaignMode && detail.variables.includes('phone_number') && !resolvedVariables.phone_number?.trim() && !Object.prototype.hasOwnProperty.call(variableValues, 'phone_number')) resolvedVariables.phone_number = phone;
  const missingVariables = detail.variables.filter(key => !resolvedVariables[key]?.trim());
  const variablesReady = Boolean(detail.agent) && !detail.loading && !detail.error && missingVariables.length === 0;
  const [consent, setConsent] = useState(false);
  const [calling, setCalling] = useState(false);
  const [callMessage, setCallMessage] = useState('');
  const [setup, setSetup] = useState<TelephonyConfig | null>(null);
  const [phoneFormat, setPhoneFormat] = useState<'international' | 'entered'>(DEFAULT_DIAL_FORMAT);
  const [callId, setCallId] = useState('');
  const [callStatus, setCallStatus] = useState<CallStatusResponse | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [watchCall, setWatchCall] = useState(false);
  const statusRequest = useRef(false);
  const statusVersion = useRef(0);
  const callPending = Boolean(callStatus && !['completed', 'failed', 'busy', 'no-answer', 'cancelled', 'canceled'].includes(callStatus.status));
  const destination = formatDialDestination(phone, phoneFormat);
  const requestBusy = useRef(false);
  const callBusy = useRef(false);
  const phoneValid = /^\+[1-9]\d{7,14}$/.test(normalizePhone(phone));
  const registered = trunk?.registration?.state === 'registered';
  const trunkReady = setup?.outbound?.enabled === true && !trunk?.disabled_at && setup?.readiness?.pbx?.ready === true && (trunk?.mode === 'ip' || registered);
  async function refreshCallStatus() {
    if (!account || !callId.trim() || statusRequest.current) return;
    const version = statusVersion.current;
    statusRequest.current = true; setStatusBusy(true); setStatusError('');
    try {
      const result = await botnoiApi.getCallStatus(account._id, callId.trim());
      if (version !== statusVersion.current) return;
      setCallStatus(result);
      if (['completed', 'failed', 'busy', 'no-answer', 'cancelled', 'canceled'].includes(result.status)) setWatchCall(false);
    } catch (err) {
      if (version === statusVersion.current) { setStatusError((err as Error).message); setWatchCall(false); }
    } finally { statusRequest.current = false; setStatusBusy(false); }
  }
  useEffect(() => {
    if (!watchCall || !callId || !account) return;
    let remaining = 20;
    const timer = window.setInterval(() => {
      void refreshCallStatus();
      if (--remaining <= 0) setWatchCall(false);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [watchCall, callId, account]);
  useEffect(() => () => { statusVersion.current++; }, []);
  async function testConnection() {
    if (requestBusy.current) return;
    requestBusy.current = true; setState('loading'); setAccount(null); setTrunk(null); setSetup(null); setLatency(null);
    setMessage('กำลังตรวจสอบบัญชีและคู่สายโทรศัพท์...');
    const start = performance.now();
    try {
      const data = await botnoiApi.getAccount();
      if (!data._id) throw new Error('API ไม่ส่งข้อมูลบัญชีที่ใช้งานได้');
      setAccount(data);
      const overview = await botnoiApi.getProvisioningOverview(data._id, { include: 'tenant,trunk_status' });
      if (!overview.sections.tenant?.ok || !overview.sections.trunk_status?.ok) throw new Error('อ่านการตั้งค่าหรือสถานะคู่สายไม่สำเร็จ');
      const config = overview.sections.tenant.data;
      const result = overview.sections.trunk_status.data;
      setSetup(config);
      setTrunk(result); setLatency(Math.round(performance.now() - start));
      if (!config.outbound?.enabled || result.disabled_at) throw new Error('บัญชีนี้ยังไม่เปิดใช้งานโทรออก');
      if (config.readiness?.pbx?.ready !== true || (result.mode !== 'ip' && result.registration?.state !== 'registered')) throw new Error('เชื่อมบัญชีได้ แต่การตั้งค่าคู่สายยังไม่พร้อม');
      setState('success'); setMessage('อ่านบัญชีและการตั้งค่าคู่สายได้แล้ว ต้องดูสถานะสายเพื่อยืนยันผลการโทร');
    } catch (err) { setState('error'); setMessage((err as Error).message); }
    finally { requestBusy.current = false; }
  }
  async function call() {
    if (callBusy.current || callPending || statusBusy || !account || !agentId || !phoneValid || !consent || state !== 'success' || !trunkReady || !variablesReady || uncertainRequest) return;
    callBusy.current = true; setCalling(true); setConsent(false); setWatchCall(false); statusVersion.current++; setCallId(''); setCallStatus(null); setStatusError(''); setCallMessage('กำลังส่งคำขอโทร...');
    try {
      const result = await botnoiApi.placeCall(account._id, destination, agentId, { requestId, variables: resolvedVariables, campaignId: draft?.id, contactRow: contactRow >= 0 ? contactRow : undefined });
      if (!result.call_id) throw new Error('API ไม่ส่งรหัสการโทรกลับมา');
      setCallId(result.call_id);
      setCallStatus({ ...result, status: result.status || 'queued', destination });
      setRequestId(crypto.randomUUID()); setWatchCall(true); setCallMessage(result.persistence_warning || 'API รับคำขอแล้ว กำลังติดตามผลการโทร');
    } catch (err) { setUncertainRequest(true); setCallMessage(`ยังยืนยันผลการส่งคำขอไม่ได้: ${(err as Error).message} กรุณาตรวจประวัติการโทรก่อนส่งซ้ำ`); }
    finally { callBusy.current = false; setCalling(false); }
  }
  async function save() {
    if (!draft || saveBusy) return;
    setSaveBusy(true);
    try {
      const issues = mappingErrors(draft.csv, draft.mapping);
      if (issues.length) { setError(issues.join(' ')); return; }
      await saveDraft({ ...draft, agentId, variables: { ...draft.variables, ...(contactRow < 0 ? variableValues : {}) } }); window.location.assign(routes.campaignSummary);
    } catch (err) { setError((err as Error).message); } finally { setSaveBusy(false); }
  }
  if (campaignMode && !draft) return <div className="api-test-page"><AppHeader /><main className="page-shell real-data-page"><h1>ไม่พบแคมเปญนี้ในบัญชีของคุณ</h1><p>กลับไปเลือกแคมเปญที่ต้องการโทรอีกครั้ง</p><Button href={routes.campaigns}>กลับไปแคมเปญ</Button></main></div>;
  return <div className="api-test-page"><AppHeader /><main className="api-test-main page-shell">
    <header className="api-test-titlebar"><div><span className="api-test-eyebrow">REVIEW & CONNECTION</span><h1>{campaignMode ? 'โทรจากแคมเปญ' : 'โทรทดสอบ Voice Agent'}</h1><p>{draft ? `${draft.name} · ${draft.csv.rows.length.toLocaleString()} รายชื่อ` : 'ทดสอบการเชื่อมต่อบัญชี Voice Bot'}</p></div><span className="api-test-result-badge status-result" data-state={state}>{state === 'success' ? 'เชื่อมต่อแล้ว' : state === 'loading' ? 'กำลังตรวจสอบ' : state === 'error' ? 'เชื่อมต่อไม่สำเร็จ' : 'ยังไม่ทดสอบ'}</span></header>
    {campaignMode && <section className="workspace-notice"><strong>โทรทีละรายชื่อ</strong><p>1. ตรวจการเชื่อมต่อ → 2. เลือกรายชื่อและตรวจข้อมูล → 3. ยืนยันเบอร์แล้วกดโทร</p><p>เปิดหน้านี้ยังไม่เริ่มโทร ระบบจะส่งคำขอเฉพาะรายชื่อที่คุณเลือก</p></section>}
    <section className="api-test-success status-result" data-state={state} aria-live="polite"><div className="api-test-success__summary"><div><strong>{state === 'success' ? 'ตรวจสอบการตั้งค่าแล้ว' : 'สถานะการเชื่อมต่อ'}</strong><span>{message}</span></div></div><Button size="compact" variant="secondary" onClick={testConnection} disabled={state === 'loading' || calling || watchCall || statusBusy}>{state === 'loading' ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}</Button></section>
    <section className="api-test-workspace"><details open={!campaignMode}><summary>รายละเอียดการเชื่อมต่อ</summary><div className="api-test-code-grid"><article className="api-test-code-column"><h2>คำขอตรวจสอบบัญชี</h2><ApiCodePanel heading="GET /me"><code className="api-code-block"><span>Authorization: Bearer [configured token]</span><span>ตามด้วยการตรวจสอบคู่สายของบัญชีนี้</span></code></ApiCodePanel></article><article className="api-test-code-column"><h2>ผลการเชื่อมต่อ</h2><ApiCodePanel heading={latency === null ? 'รอผลจาก API' : `${latency} ms`} variant="response"><code className="api-code-block"><span>บัญชี: {account?.username || '—'}</span><span>คู่สาย: {trunk?.registration?.state || 'ยังไม่ทราบ'}</span><span>เส้นทางเริ่มต้น: {setup?.outbound?.default_path || '—'}</span><span>Agent: {agentId || 'ยังไม่ได้เลือก'}</span></code></ApiCodePanel></article></div></details>
      {setup?.readiness?.pbx?.warnings?.map(warning => <p key={warning.code} className="workspace-alert" role="status">{warning.code === 'trunk_unprobeable' ? 'คู่สายใช้ hostname จึงไม่มีผลตรวจการเข้าถึงด้วย OPTIONS สถานะลงทะเบียนยังไม่ยืนยันว่าโทรถึงปลายทาง' : warning.detail} ({warning.code})</p>)}
      <div className="workspace-toolbar"><div><h3>{campaignMode ? "โทรหาผู้ติดต่อ" : "ทดสอบโทรออกจริง"}</h3><p className="workspace-note">{campaignMode ? "ตรวจรายชื่อ เบอร์ปลายทาง และข้อมูลบทสนทนาก่อนยืนยันโทร" : "ระบุเบอร์ของคุณและเลือก Agent ก่อนทดสอบ"}</p></div></div>
      <label className="campaign-form__field"><span>{campaignMode ? "Agent ของแคมเปญ" : "Agent ที่จะโทรทดสอบ"}</span><select className="workspace-select" value={agentId} disabled={campaignMode || agentsLoading || calling || callPending} onChange={e => { setSelectedAgentId(e.target.value); setVariableValues({}); setConsent(false); }}><option value="">เลือก Agent</option>{agents.map(agent => <option key={agent.agent_id} value={agent.agent_id}>{agent.name}</option>)}</select></label>
      {campaignMode && !agentsLoading && !agentsError && !agentId && <p className="workspace-alert" role="alert">ไม่พบ Agent ของแคมเปญ กรุณากลับไปแก้ไขแคมเปญและเลือก Agent ใหม่</p>}
      {agentsError && <p className="workspace-alert" role="alert">{agentsError}</p>}
      <section className="activity-section"><h3>ข้อมูลที่แนบไปกับการโทร</h3>
      <p className="workspace-note">ส่งข้อมูลผ่าน metadata.variables ตามข้อมูลที่คุณตรวจด้านล่าง ผู้ดูแล Voice Bot ต้องยืนยันว่าบอทรองรับการนำค่านี้ไปแทนตัวแปรใน Prompt</p>
      {draft && <label className="campaign-form__field"><span>ใช้ข้อมูลจากรายชื่อ</span><select className="workspace-select" value={contactRow} disabled={calling || callPending} onChange={e => { const row = Number(e.target.value); setContactRow(row); if (campaignMode) setPhone(phoneForRow(row)); setVariableValues({}); setConsent(false); }}>{!campaignMode && <option value={-1}>กรอกข้อมูลทดสอบเอง</option>}{draft.csv.rows.map((row, index) => <option key={index} value={index}>แถว {index + 1} · {row[draft.csv.headers.findIndex(h => draft.mapping[h] === 'guest_name')] || row[draft.csv.headers.findIndex(h => /^(ชื่อ|name|guest_name|full_name)$/i.test(h.trim()))] || 'ไม่ระบุชื่อ'}{campaignMode ? ` · ${phoneForRow(index) || 'ไม่มีเบอร์ที่จับคู่'}` : ''}</option>)}</select></label>}
      <p className="workspace-note">{campaignMode ? "เบอร์ปลายทางดึงจากคอลัมน์ที่จับคู่ไว้ เปลี่ยนรายชื่อแล้วต้องตรวจและยืนยันเบอร์ใหม่ทุกครั้ง" : "เลือกแถวเพื่อใช้ข้อมูลบทสนทนาเท่านั้น เบอร์โทรทดสอบต้องกรอกและยืนยันเอง"}</p>
      {detail.loading ? <p role="status">กำลังอ่านตัวแปร Agent…</p> : detail.error ? <p role="alert">{detail.error}</p> : detail.variables.map(variable => <label className="campaign-form__field" key={variable}><span>{variable} *</span><input className="workspace-search" maxLength={2000} value={resolvedVariables[variable] || ''} disabled={calling || callPending} onChange={e => { setVariableValues(values => ({ ...values, [variable]: e.target.value })); setConsent(false); }} /></label>)}
      {missingVariables.length > 0 && <p className="workspace-alert">ข้อมูลยังไม่ครบ: {missingVariables.join(', ')}</p>}
      {detail.agent?.agent_data?.greeting_text && <div className="workspace-note"><strong>ตัวอย่างข้อความทักทายจากค่าที่กรอก</strong><p className="real-text">{detail.agent.agent_data.greeting_text.replace(/\{\{([a-zA-Z0-9_-]+)\}\}/g, (match, key: string) => resolvedVariables[key] || match)}</p><small>ตัวอย่างข้อความในเว็บ ยังไม่ยืนยันผลการแทนค่าของบอทขณะโทร</small></div>}
      {contactRow >= 0 && <p className="workspace-note">ค่าที่แก้สำหรับแถวนี้ใช้กับสายทดสอบนี้เท่านั้น ข้อมูล CSV ต้นฉบับยังคงเดิม</p>}
      {variablesReady && <p className="workspace-note">ข้อมูลตัวแปรครบ พร้อมแนบกับคำขอโทร</p>}
      </section>
      <label className="campaign-form__field"><span>{campaignMode ? "หมายเลขโทรศัพท์ปลายทาง" : "หมายเลขโทรศัพท์ทดสอบ"}</span><input disabled={calling || callPending} className="workspace-search" type="tel" value={phone} placeholder="08x xxx xxxx หรือ +66..." onChange={e => { setPhone(e.target.value); setConsent(false); }} /></label>
      <label className="campaign-form__field"><span>รูปแบบเบอร์ที่ส่ง</span><select className="workspace-select" disabled={calling || callPending} value={phoneFormat} onChange={e => { setPhoneFormat(e.target.value as 'international' | 'entered'); setConsent(false); }}><option value="entered">ตามที่กรอก (ค่าเริ่มต้นสำหรับคู่สายนี้)</option><option value="international">รหัสประเทศ +66 (เลือกเมื่อคู่สายรองรับ)</option></select></label>
      <p className="workspace-note">เบอร์ที่จะส่งจริง: <strong>{destination || '—'}</strong> · เส้นทาง: {setup?.outbound?.default_path || 'ตามบัญชี'} · เลือกรูปแบบตามที่ผู้ดูแลคู่สายกำหนด</p>
      <p className="workspace-note"><label><input type="checkbox" disabled={calling || callPending} checked={consent} onChange={e => setConsent(e.target.checked)} /> ฉันต้องการให้ระบบโทรจริงไปยังหมายเลขนี้</label></p>
      <Button size="compact" onClick={call} disabled={calling || callPending || statusBusy || state !== 'success' || !trunkReady || !agentId || !phoneValid || !consent || !variablesReady || uncertainRequest || saveBusy}>{calling ? 'กำลังส่งคำขอ...' : campaignMode ? 'ยืนยันโทรหารายชื่อนี้' : 'โทรทดสอบ'}</Button>
      {uncertainRequest && <p className="workspace-alert">หยุดส่งซ้ำเพื่อป้องกันโทรซ้อน ตรวจประวัติคำขอในหน้าตั้งค่าก่อนเริ่มคำขอใหม่</p>}
      {callMessage && <p className="workspace-note" role="status">{callMessage}</p>}
      <hr />
      <h3>ตรวจสถานะสาย</h3>
      <p className="workspace-note">ใช้รหัสสายเดิมเพื่อตรวจผลได้โดยไม่โทรใหม่ หลังส่งคำขอจะติดตามทุก 3 วินาที สูงสุด 1 นาที</p>
      <label className="campaign-form__field"><span>รหัสสาย (Call ID)</span><input className="workspace-search" value={callId} disabled={calling || watchCall || statusBusy} placeholder="oc_..." onChange={e => { statusVersion.current++; setCallId(e.target.value); setCallStatus(null); setStatusError(''); }} /></label>
      <Button size="compact" variant="secondary" onClick={refreshCallStatus} disabled={!account || !callId.trim() || statusBusy || calling}>{statusBusy ? 'กำลังอ่านสถานะ...' : 'ตรวจสถานะสายเดิม'}</Button>
      {watchCall && <p className="workspace-note" role="status">กำลังติดตามสถานะสาย…</p>}
      {statusError && <p className="workspace-alert" role="alert">{statusError}</p>}
      {callStatus && <div className="workspace-note" role="status"><p><strong>สถานะสาย: {callStatus.status}</strong></p><p>ปลายทาง: {callStatus.destination || '—'} · เส้นทาง: {callStatus.path || '—'}</p><p>สาเหตุ: {callStatus.reason || callStatus.error || 'API ไม่ระบุ'}</p>{callStatus.reason === 'unreachable' && <p>เชื่อมต่อปลายทางไม่สำเร็จ ต้องตรวจเส้นทาง PBX และรูปแบบเบอร์กับผู้ดูแล ข้อมูลนี้ยังระบุสาเหตุย่อยไม่ได้</p>}{callStatus.answered_at && <p>รับสายเมื่อ: {callStatus.answered_at}</p>}</div>}
    </section>
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    <footer className="api-test-footer"><p>{campaignMode ? 'โทรครั้งละ 1 รายชื่อ ติดตามผลจากสถานะสายด้านบน การตั้งเวลาและโทรทั้งแคมเปญอัตโนมัติยังไม่เปิดใช้งาน' : draft ? 'บันทึกฉบับร่างในบัญชีของคุณ โดยยังไม่เริ่มโทรหาผู้ติดต่อ' : 'การโทรจะเริ่มเมื่อเลือก Agent ระบุเบอร์ และกดโทรทดสอบเท่านั้น'}</p><div className="draft-actions"><Button href={campaignMode ? routes.campaigns : draft ? routes.campaignSummary : routes.campaigns} size="compact" variant="secondary">ย้อนกลับ</Button>{!campaignMode && draft && <Button size="compact" disabled={saveBusy || calling || watchCall} onClick={save}>บันทึกข้อมูลและกลับไปสรุป</Button>}</div></footer>
  </main></div>;
}
