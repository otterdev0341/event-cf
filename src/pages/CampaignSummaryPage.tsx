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
  const phoneColumn = draft?.csv.headers.find(h => draft.mapping[h] === 'phone');
  const firstRow = prepared.rows[0];
  const readyRows = prepared.errors.length ? 0 : prepared.rows.length - invalidRows.length;
  return <div className="campaign-summary-page"><AppHeader /><main className="wizard-summary-main page-shell">
    <header className="rd-head"><div><a className="rd-back" href={routes.dataMapping}>← ย้อนกลับ: จับคู่ข้อมูล</a><h1>ตรวจสอบก่อนบันทึก</h1><p>ตรวจรายละเอียดและการจับคู่ข้อมูลก่อนบันทึกแคมเปญ</p></div></header>
    <CampaignStepIndicator activeStep={4} />
    {!draft ? <section className="workspace-empty"><h2>ยังไม่มีฉบับร่างให้สรุป</h2><Button href={routes.campaigns}>กลับไปแคมเปญ</Button></section> : <>
      <div className="rd-split">
        <div className="rd-stack">
          <section className="rd-card rd-pad rd-summary-sec"><header><h2><span>01</span>รายละเอียดแคมเปญ</h2><a className="rd-link" href={routes.createCampaign}>แก้ไข</a></header><dl className="rd-dl">
            <div><dt>ชื่อแคมเปญ</dt><dd>{draft.name}</dd></div><div><dt>วันและเวลาจัดงาน</dt><dd>{dateLabel(draft.eventDate)}{draft.eventTime ? ` · ${draft.eventTime} น.` : ''}</dd></div><div><dt>แหล่งข้อมูล</dt><dd>{draft.fileName} · {draft.csv.rows.length.toLocaleString()} แถว</dd></div>
          </dl></section>
          <section className="rd-card rd-pad rd-summary-sec"><header><h2><span>02</span>Voice Agent</h2><a className="rd-link" href={routes.apiAgent}>เปลี่ยน Agent</a></header>
            {detail.loading ? <p className="rd-muted" role="status">กำลังตรวจ Agent ล่าสุด…</p> : detail.error ? <div role="alert" className="workspace-alert"><p>{detail.error}</p><Button size="compact" variant="secondary" onClick={detail.refetch}>ลองใหม่</Button></div> : <div className="rd-agent-line"><span className="rd-banner__icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4"/></svg></span><div className="rd-stack" style={{gap:6}}><strong>{detail.agent?.bot_name || 'ยังไม่ได้เลือก Agent'}</strong><span className="rd-muted">{draft.agentId}</span><div className="rd-codes">{detail.variables.map(v => <code key={v}>{v}</code>)}</div>{!detail.variables.length && <span className="rd-muted">ไม่พบตัวแปรใน Prompt</span>}</div></div>}
            <span className={`rd-chip ${draft.recordConversation ? 'rd-chip--ok' : ''}`}>บันทึกบทสนทนา: {draft.recordConversation ? 'เปิด' : 'ปิด'}</span>
          </section>
          <section className="rd-card rd-pad rd-summary-sec"><header><h2><span>03</span>รายชื่อและการจับคู่</h2><a className="rd-link" href={routes.dataMapping}>แก้ไขการจับคู่</a></header>
            <div className="rd-map-row"><span>เบอร์ปลายทาง</span><span>{phoneColumn || 'ยังไม่เลือก'}</span></div>
            {detail.variables.map(v => <div className="rd-map-row" key={v}><code className="rd-code">{v}</code><span>{prepared.bindings[v]?.source === 'output' ? 'ผลลัพธ์หลังโทร' : (prepared.bindings[v] as {column?:string})?.column || 'ยังไม่เลือกคอลัมน์'}</span></div>)}
            {detail.agent && <>{prepared.errors.map(e => <p className="workspace-alert" key={e}>{e}</p>)}{invalidRows.length > 0 && <p className="workspace-alert">ต้องแก้ข้อมูล {invalidRows.length} แถวก่อนเริ่มคิวโทร</p>}</>}
            {issues.length > 0 && <p className="workspace-alert" role="alert">{issues.join(' ')}</p>}
            {staleMappings.length > 0 && <p className="workspace-alert" role="alert">Prompt เปลี่ยนแล้ว กรุณากลับไปจับคู่ใหม่: {staleMappings.join(', ')}</p>}
          </section>
        </div>
        <aside className="rd-aside rd-card rd-card--tint rd-pad rd-stack">
          <span className="ui-kicker">ตัวอย่างแถวแรก</span>
          {firstRow && detail.variables.length ? <dl className="rd-preview">{detail.variables.map(v => <div key={v}><dt>{v}</dt><dd><mark>{prepared.bindings[v]?.source === 'output' ? 'รอหลังสนทนา' : firstRow.variables[v] || '—'}</mark></dd></div>)}</dl> : <p className="rd-muted" style={{margin:0}}>ยังไม่มีตัวแปรให้แสดง</p>}
          <div className="rd-rule"/>
          <div className="rd-kv"><span>เบอร์ที่จะโทร</span><strong>{firstRow?.destination || '—'}</strong></div>
          <div className="rd-kv"><span>รายชื่อพร้อมโทร</span><strong>{detail.agent ? `${readyRows.toLocaleString()} / ${prepared.rows.length.toLocaleString()}` : '—'}</strong></div>
          <p className="rd-stat__note">บันทึกแคมเปญก่อน แล้วเปิดหน้าโทรเพื่อกดเริ่มเอง หรือตั้งวันและเวลาโทรได้ตามต้องการ</p>
          <label className="rd-toggle-row"><input type="checkbox" checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} /><span><small>ฉันตรวจรายละเอียด Agent และการจับคู่รายชื่อแล้ว</small></span></label>
        </aside>
      </div>
      {error && <p className="workspace-alert" role="alert">{error}</p>}
      <footer className="rd-wizard-foot"><Button variant="secondary" href={routes.dataMapping}>← ย้อนกลับ</Button><div><Button variant="secondary" href={routes.apiTest}>ไปหน้าโทรทดสอบ</Button><Button disabled={saving || !canSave || !confirmed} onClick={save}>{saving ? 'กำลังบันทึก…' : 'ยืนยันและบันทึกแคมเปญ'}</Button></div></footer>
    </>}
  </main></div>;
}
