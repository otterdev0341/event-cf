import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { SmoothSelect } from '../components/ui/smooth-select';
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
  const complete = prepared.errors.length ? 0 : prepared.rows.length - invalid.length;
  return <div><AppHeader /><main className="page-shell real-data-page">
    <header className="rd-head"><div><a className="rd-back" href={routes.apiAgent}>← ย้อนกลับ: เลือก Agent</a><h1>จับคู่ข้อมูลจาก CSV</h1><p>ตั้งค่าครั้งเดียว ระบบจะใช้ข้อมูลของแต่ละแถวเมื่อโทรหาคนนั้น</p></div></header>
    <CampaignStepIndicator activeStep={3} />
    {!draft ? <section className="workspace-empty"><h2>ยังไม่มีฉบับร่าง</h2><Button href={routes.createCampaign}>สร้างแคมเปญ</Button></section> : !draft.agentId ? <Button href={routes.apiAgent}>เลือก Agent ก่อน</Button> : <>
      <section className="rd-card rd-source-bar"><span><span className="rd-muted">แหล่งข้อมูล</span> <strong>{draft.fileName}</strong> <span className="rd-muted">{draft.csv.rows.length.toLocaleString()} แถว · Agent {detail.agent?.bot_name || draft.agentId}</span></span><span className="rd-head__actions"><a className="rd-link" href={routes.createCampaign}>เปลี่ยนไฟล์ CSV</a><a className="rd-link" href={routes.apiAgent}>เปลี่ยน Agent</a></span></section>
      {detail.loading && <p className="rd-muted" role="status">กำลังอ่านตัวแปร Agent…</p>}
      {detail.error && <div role="alert" className="workspace-alert">{detail.error}<Button onClick={detail.refetch}>ลองใหม่</Button></div>}
      {ready && <section className="rd-card rd-pad rd-phone-row">
        <div className="rd-panel-head"><h2>1. เบอร์ปลายทาง</h2><span className="rd-muted">คอลัมน์ที่ใช้โทรออก ต้องเป็นเบอร์ที่ถูกต้อง</span></div>
        <label className="campaign-form__field"><span>คอลัมน์เบอร์โทร</span><SmoothSelect value={phoneColumn} disabled={saving} onChange={value => { setPhoneColumn(value); setMessage(''); }} options={[{ value: '', label: 'เลือกคอลัมน์' }, ...draft.csv.headers.map(h => ({ value: h, label: h }))]} /></label>
        <span className={`rd-chip ${phoneColumn ? complete === prepared.rows.length ? 'rd-chip--ok' : 'rd-chip--warn' : ''}`}>{phoneColumn ? `ข้อมูลครบ ${complete.toLocaleString()} / ${prepared.rows.length.toLocaleString()} แถว` : 'ยังไม่เลือกคอลัมน์'}</span>
      </section>}
      {ready && <section className="rd-card rd-table-card">
        <div className="rd-table-card__head"><div className="rd-panel-head"><h2>2. ข้อมูลที่ Agent ใช้</h2><span className="rd-muted">เลือกคอลัมน์ CSV ให้ตัวแปรแต่ละตัว คอลัมน์เดียวใช้ได้หลายตัวแปร ระบบแสดงค่าจากแถวแรกให้ตรวจ</span></div><button className="rd-link" type="button" onClick={template}>ดาวน์โหลดหัวตาราง CSV สำหรับ Agent นี้</button></div>
        {detail.variables.length ? <div className="rd-table-wrap"><table className="rd-table"><thead><tr><th>ตัวแปร Agent</th><th style={{width:'36%'}}>คอลัมน์ CSV</th><th>ตัวอย่างแถวแรก</th><th>สถานะ</th></tr></thead><tbody>{detail.variables.map(variable => {
          const binding = bindings[variable];
          const bound = binding.source === 'output' || Boolean(binding.column && draft.csv.headers.includes(binding.column));
          return <tr key={variable}><td><code className="rd-code">{variable}</code></td><td><SmoothSelect aria-label={`แหล่งข้อมูล ${variable}`} disabled={saving} value={binding.source === 'output' ? 'output' : binding.column ? `csv:${binding.column}` : ''} onChange={value => { setEdits(prev => ({...prev, [variable]: value === 'output' ? {source:'output'} : {source:'csv', column:value.startsWith('csv:') ? value.slice(4) : ''}})); setMessage(''); }} options={[{ value: '', label: 'เลือกคอลัมน์ CSV' }, ...(binding.source === 'csv' && binding.column && !draft.csv.headers.includes(binding.column) ? [{ value: `csv:${binding.column}`, label: `ไม่พบคอลัมน์เดิม: ${binding.column}` }] : []), ...draft.csv.headers.map(h => ({ value: `csv:${h}`, label: h })), { value: 'output', label: 'ผลลัพธ์หลังโทร — ไม่รับค่าจาก CSV' }]} /></td><td style={{color:'var(--color-body)'}}>{binding.source === 'output' ? 'รอข้อมูลหลังสนทนา' : draft.csv.rows[0]?.[draft.csv.headers.indexOf(binding.column)] || '—'}</td><td><span className={`rd-chip ${binding.source === 'output' ? 'rd-chip--info' : bound ? 'rd-chip--ok' : ''}`}>{binding.source === 'output' ? 'ผลหลังโทร' : bound ? 'จับคู่แล้ว' : 'ยังไม่จับคู่'}</span></td></tr>;
        })}</tbody></table></div> : <p className="rd-empty">Agent นี้ไม่มีตัวแปรใน Prompt ใช้เฉพาะเบอร์ปลายทาง</p>}
        <p className="rd-table-foot" style={{margin:0,justifyContent:'flex-start'}}>หากตัวแปรใช้บันทึกคำตอบหลังสนทนา ให้เลือก “ผลลัพธ์หลังโทร” ระบบจะไม่บังคับข้อมูลนั้นใน CSV และไม่ส่งค่าเริ่มต้นแทนคุณ</p>
      </section>}
      {ready && <section className="rd-card rd-pad rd-stack"><div className="rd-filters" style={{justifyContent:'space-between'}}><h2 className="rd-section-title">ตรวจครบทุกแถว</h2><span className={`rd-chip ${complete === prepared.rows.length && !prepared.errors.length ? 'rd-chip--ok' : 'rd-chip--warn'}`}>ข้อมูลครบ {complete.toLocaleString()} / {prepared.rows.length.toLocaleString()} รายชื่อ</span></div>{prepared.errors.map(e => <p key={e} className="workspace-alert">{e}</p>)}{invalid.slice(0,20).map(r => <p key={r.index} className="workspace-alert">แถว {r.index + 1}: {r.errors.join(' · ')}</p>)}{invalid.length > 20 && <p className="rd-muted">และอีก {invalid.length - 20} แถวที่ข้อมูลไม่ครบ</p>}<p className="rd-stat__note">บันทึกฉบับร่างได้ แต่จะเริ่มโทรทั้งแคมเปญได้เมื่อข้อมูลครบทุกแถว</p></section>}
      {error && <p role="alert" className="workspace-alert">{error}</p>}{message && <p role="status" className="workspace-notice">{message}</p>}
      <footer className="rd-wizard-foot"><Button href={routes.apiAgent} variant="secondary">← ย้อนกลับ</Button><div><span className="rd-muted">ขั้นตอนที่ 3 จาก 4</span><Button variant="secondary" disabled={!ready || saving} onClick={() => save(false)}>บันทึกการจับคู่</Button><Button disabled={!ready || saving} onClick={() => save(true)}>ถัดไป: สรุปแคมเปญ →</Button></div></footer>
    </>}
  </main></div>;
}
