import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { CampaignStepIndicator } from '../components/CampaignStepIndicator';
import { useAgentDetail } from '../hooks/useBotnoiData';
import { getDraft, saveDraft, type CampaignDraft } from '../lib/campaigns';
import { campaignBindings, prepareCampaignRows, type VariableBinding } from '../../shared/campaign-inputs.mjs';
import { routes } from '../routes';

export function DataMappingPage() {
  const [draft, setDraft] = useState(getDraft);
  const detail = useAgentDetail(draft?.agentId);
  const [edits, setEdits] = useState<Record<string,VariableBinding>>({});
  const [phoneColumn, setPhoneColumn] = useState(() => draft?.csv.headers.find(h => draft.mapping[h] === 'phone') || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const ready = Boolean(draft?.agentId && detail.agent && !detail.loading && !detail.error);
  const bindings = { ...campaignBindings(draft, detail.variables), ...edits };
  const candidate = draft ? { ...draft, mapping: Object.fromEntries(draft.csv.headers.map(h => [h, h === phoneColumn ? 'phone' : ''])), variableBindings: Object.fromEntries(detail.variables.map(v => [v, bindings[v]])) } : null;
  const prepared = prepareCampaignRows(candidate, detail.variables);
  const invalid = prepared.rows.filter(r => r.errors.length);
  async function save(next: boolean) {
    if (!candidate || !ready || saving) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const saved = await saveDraft(candidate as CampaignDraft); setDraft(saved);
      if (next) window.location.assign(routes.campaignSummary); else setMessage('บันทึกการจับคู่แล้ว');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  function template() {
    const names = new Set(['phone_number', ...detail.variables.filter(v => bindings[v]?.source !== 'output')]);
    const blob = new Blob(['\uFEFF' + [...names].map(n => '"' + n.replaceAll('"','""') + '"').join(',') + '\r\n'], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'campaign-input-template.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  return <div><AppHeader /><main className="page-shell real-data-page">
    <header><span className="ui-kicker">ขั้นตอนที่ 3 จาก 4</span><h1>จับคู่ข้อมูลจาก CSV</h1><p>ตั้งค่าครั้งเดียว ระบบจะใช้ข้อมูลของแต่ละแถวเมื่อโทรหาคนนั้น</p></header>
    <CampaignStepIndicator activeStep={3} />
    {!draft ? <section className="workspace-empty"><h2>ยังไม่มีฉบับร่าง</h2><Button href={routes.createCampaign}>สร้างแคมเปญ</Button></section> : !draft.agentId ? <Button href={routes.apiAgent}>เลือก Agent ก่อน</Button> : <>
      <section className="wizard-agent-banner"><div><h2>{detail.agent?.bot_name || draft.agentId}</h2><p>{draft.fileName} · {draft.csv.rows.length.toLocaleString()} รายชื่อ</p></div><div className="draft-actions"><Button href={routes.createCampaign} variant="secondary" size="compact">เปลี่ยนไฟล์ CSV</Button><Button href={routes.apiAgent} variant="secondary" size="compact">เปลี่ยน Agent</Button></div></section>
      {detail.loading && <p role="status">กำลังอ่านตัวแปร Agent…</p>}
      {detail.error && <div role="alert" className="workspace-alert">{detail.error}<Button onClick={detail.refetch}>ลองใหม่</Button></div>}
      {ready && <section className="wizard-summary-card">
        <h2>1. เบอร์ปลายทาง</h2><label className="campaign-form__field"><span>คอลัมน์เบอร์โทร</span><select className="workspace-select" value={phoneColumn} disabled={saving} onChange={e => { setPhoneColumn(e.target.value); setMessage(''); }}><option value="">เลือกคอลัมน์</option>{draft.csv.headers.map(h => <option key={h}>{h}</option>)}</select></label>
        <h2>2. ข้อมูลที่ Agent ใช้</h2><p className="workspace-note">เลือกคอลัมน์ให้แต่ละตัวแปร คอลัมน์เดียวใช้ได้หลายตัวแปร เช่น เบอร์ปลายทางและ phone_number</p>
        <p className="workspace-note">หากตัวแปรใช้บันทึกคำตอบหลังสนทนา ให้เลือก “ผลลัพธ์หลังโทร” ระบบจะไม่บังคับข้อมูลนั้นใน CSV และไม่ส่งค่าเริ่มต้นแทนคุณ</p>
        <div className="csv-preview"><table><thead><tr><th>ตัวแปร Agent</th><th>แหล่งข้อมูล</th><th>ตัวอย่างแถวแรก</th></tr></thead><tbody>{detail.variables.map(variable => {
          const binding = bindings[variable];
          return <tr key={variable}><td><code>{variable}</code></td><td><select className="workspace-select" aria-label={`แหล่งข้อมูล ${variable}`} disabled={saving} value={binding.source === 'output' ? 'output' : binding.column ? `csv:${binding.column}` : ''} onChange={e => { const value = e.target.value; setEdits(prev => ({...prev, [variable]: value === 'output' ? {source:'output'} : {source:'csv', column:value.startsWith('csv:') ? value.slice(4) : ''}})); setMessage(''); }}><option value="">เลือกคอลัมน์ CSV</option>{binding.source === 'csv' && binding.column && !draft.csv.headers.includes(binding.column) && <option value={`csv:${binding.column}`}>ไม่พบคอลัมน์เดิม: {binding.column}</option>}{draft.csv.headers.map(h => <option key={h} value={`csv:${h}`}>{h}</option>)}<option value="output">ผลลัพธ์หลังโทร — ไม่รับค่าจาก CSV</option></select></td><td>{binding.source === 'output' ? 'รอข้อมูลหลังสนทนา' : draft.csv.rows[0]?.[draft.csv.headers.indexOf(binding.column)] || '—'}</td></tr>;
        })}</tbody></table></div>
        {!detail.variables.length && <p>Agent นี้ไม่มีตัวแปรใน Prompt ใช้เฉพาะเบอร์ปลายทาง</p>}
        <Button variant="secondary" size="compact" onClick={template}>ดาวน์โหลดหัวตาราง CSV สำหรับ Agent นี้</Button>
      </section>}
      {ready && <section className="wizard-summary-card"><h2>ตรวจครบทุกแถว</h2><p>ข้อมูลครบ {prepared.errors.length ? 0 : prepared.rows.length - invalid.length} / {prepared.rows.length} รายชื่อ</p>{prepared.errors.map(e => <p key={e} className="workspace-alert">{e}</p>)}{invalid.slice(0,20).map(r => <p key={r.index} className="workspace-alert">แถว {r.index + 1}: {r.errors.join(' · ')}</p>)}{invalid.length > 20 && <p>และอีก {invalid.length - 20} แถวที่ข้อมูลไม่ครบ</p>}<p className="workspace-note">บันทึกฉบับร่างได้ แต่จะเริ่มโทรทั้งแคมเปญได้เมื่อข้อมูลครบทุกแถว</p></section>}
      {error && <p role="alert" className="workspace-alert">{error}</p>}{message && <p role="status">{message}</p>}
      <footer className="wizard-summary-actions"><Button href={routes.apiAgent} variant="secondary">ย้อนกลับ: เลือก Agent</Button><div><Button variant="secondary" disabled={!ready || saving} onClick={() => save(false)}>บันทึกการจับคู่</Button><Button disabled={!ready || saving} onClick={() => save(true)}>ถัดไป: สรุปแคมเปญ →</Button></div></footer>
    </>}
  </main></div>;
}
