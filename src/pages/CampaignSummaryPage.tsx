import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { CampaignStepIndicator } from '../components/CampaignStepIndicator';
import { useAgentDetail } from '../hooks/useBotnoiData';
import { completeDraft, getDraft, mappingErrors } from '../lib/campaigns';
import { prepareCampaignRows } from '../../shared/campaign-inputs.mjs';
import { routes } from '../routes';
const dateLabel = (value: string) => value ? new Date(value + 'T00:00:00').toLocaleDateString('th-TH') : 'ยังไม่ระบุ';
export function CampaignSummaryPage() {
  const [draft] = useState(getDraft);
  const detail = useAgentDetail(draft?.agentId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const issues = draft ? mappingErrors(draft.csv, draft.mapping) : [];
  const staleMappings = draft && detail.agent ? Object.values(draft.mapping).filter(v => v && v !== 'phone' && !detail.variables.includes(v)) : [];
  const canSave = Boolean(draft?.agentId && detail.agent && !detail.loading && !detail.error && !issues.length && !staleMappings.length);
  const prepared = prepareCampaignRows(draft, detail.variables);
  const invalidRows = prepared.rows.filter(row => row.errors.length);
  async function save() {
    if (!draft || saving || !canSave || !confirmed) return;
    setSaving(true); setError('');
    try { await completeDraft(draft); window.location.assign(routes.campaigns); }
    catch (err) { setError((err as Error).message); } finally { setSaving(false); }
  }
  return <div className="campaign-summary-page"><AppHeader /><main className="wizard-summary-main page-shell">
    <header className="form-page-heading"><span className="ui-kicker">ขั้นตอนที่ 4 จาก 4</span><h1>สรุปแคมเปญ</h1><p>ตรวจรายละเอียดและการจับคู่ข้อมูลก่อนบันทึก</p></header>
    <CampaignStepIndicator activeStep={4} />
    {!draft ? <section className="workspace-empty"><h2>ยังไม่มีฉบับร่างให้สรุป</h2><Button href={routes.campaigns}>กลับไปแคมเปญ</Button></section> : <>
      <div className="wizard-summary-grid">
        <section className="wizard-summary-card"><header><h2>01 · รายละเอียดแคมเปญ</h2><a href={routes.createCampaign}>แก้ไข</a></header><dl>
          <div><dt>ชื่อแคมเปญ</dt><dd>{draft.name}</dd></div><div><dt>วันและเวลาจัดงาน</dt><dd>{dateLabel(draft.eventDate)}{draft.eventTime ? ` · ${draft.eventTime} น.` : ''}</dd></div>
        </dl></section>
        <section className="wizard-summary-card"><header><h2>02 · Voice Agent</h2><a href={routes.apiAgent}>เปลี่ยน Agent</a></header>
          <p className={draft.recordConversation ? 'workspace-notice' : 'workspace-note'}>บันทึกบทสนทนา: {draft.recordConversation ? 'เปิด · ส่งข้อความผ่าน Tool แยกตามสาย' : 'ปิด'}</p>
          {detail.loading ? <p role="status">กำลังตรวจ Agent ล่าสุด…</p> : detail.error ? <div role="alert"><p>{detail.error}</p><Button size="compact" variant="secondary" onClick={detail.refetch}>ลองใหม่</Button></div> : <><h3>{detail.agent?.bot_name || 'ยังไม่ได้เลือก Agent'}</h3><p className="workspace-note">{draft.agentId}</p><div className="wizard-variable-list">{detail.variables.map(v => <code key={v}>{v}</code>)}</div>{!detail.variables.length && <p>ไม่พบตัวแปรใน Prompt</p>}</>}
        </section>
        <section className="wizard-summary-card wizard-summary-card--wide"><header><div><h2>03 · รายชื่อและการจับคู่</h2><p>{draft.fileName} · {draft.csv.rows.length.toLocaleString()} รายชื่อ</p></div><a href={routes.dataMapping}>แก้ไขการจับคู่</a></header>
          <p>เบอร์ปลายทาง ← {draft.csv.headers.find(h => draft.mapping[h] === 'phone') || 'ยังไม่เลือก'}</p><div className="csv-preview"><table><caption>การจับคู่ที่ใช้กับทุกแถว</caption><thead><tr><th>ตัวแปร Agent</th><th>แหล่งข้อมูล</th><th>ตัวอย่างแถวแรก</th></tr></thead><tbody>{detail.variables.map(v => <tr key={v}><td>{v}</td><td>{prepared.bindings[v]?.source === 'output' ? 'ผลลัพธ์หลังโทร' : (prepared.bindings[v] as {column?:string})?.column || 'ยังไม่เลือกคอลัมน์'}</td><td>{prepared.bindings[v]?.source === 'output' ? 'รอหลังสนทนา' : prepared.rows[0]?.variables[v] || '—'}</td></tr>)}</tbody></table></div>
          {detail.agent && <><p>ตรวจครบทุกแถว: ข้อมูลครบ {prepared.errors.length ? 0 : prepared.rows.length - invalidRows.length} / {prepared.rows.length} รายชื่อ</p>{prepared.errors.map(e => <p className="workspace-alert" key={e}>{e}</p>)}{invalidRows.length > 0 && <p className="workspace-alert">ต้องแก้ข้อมูล {invalidRows.length} แถวก่อนเริ่มคิวโทร</p>}</>}
          {issues.length > 0 && <p className="workspace-alert" role="alert">{issues.join(' ')}</p>}
          {staleMappings.length > 0 && <p className="workspace-alert" role="alert">Prompt เปลี่ยนแล้ว กรุณากลับไปจับคู่ใหม่: {staleMappings.join(', ')}</p>}
        </section>
      </div>
      <section className="wizard-summary-confirm"><h2>ตรวจสอบก่อนบันทึก</h2><p>บันทึกแคมเปญก่อน แล้วเปิดหน้าโทรเพื่อกดเริ่มเอง หรือตั้งวันและเวลาโทรได้ตามต้องการ</p><label><input type="checkbox" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} /> ฉันตรวจรายละเอียด Agent และการจับคู่รายชื่อแล้ว</label></section>
      {error && <p className="workspace-alert" role="alert">{error}</p>}
      <footer className="wizard-summary-actions"><Button variant="secondary" size="compact" href={routes.dataMapping}>ย้อนกลับ: จับคู่ข้อมูล</Button><div><Button variant="secondary" size="compact" href={routes.apiTest}>ไปหน้าโทรทดสอบ</Button><Button size="compact" disabled={saving || !canSave || !confirmed} onClick={save}>{saving ? 'กำลังบันทึก…' : 'ยืนยันและบันทึกแคมเปญ'}</Button></div></footer>
    </>}
  </main></div>;
}
