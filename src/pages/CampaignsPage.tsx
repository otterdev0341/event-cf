import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { CampaignStatus } from '../components/CampaignStatus';
import { getCampaigns, getDraft, saveDraft, deleteCampaign, discardDraft, getLegacyCampaigns, importLegacyCampaigns, type CampaignDraft } from '../lib/campaigns';
import { routes } from '../routes';
export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState(getCampaigns);
  const [draft, setDraft] = useState(getDraft);
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState(getLegacyCampaigns);
  async function migrate() { setBusy(true); setError(''); try { await importLegacyCampaigns(); setCampaigns(getCampaigns()); setLegacy([]); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  const filtered = campaigns.filter(c => c.name.toLowerCase().includes(query.toLowerCase()));
  async function open(campaign: CampaignDraft) {
    try { await saveDraft(campaign); window.location.assign(routes.createCampaign); }
    catch (err) { setError((err as Error).message); }
  }
  async function remove(id: string) {
    try { await deleteCampaign(id); if (draft?.id === id) { setDraft(null); } setCampaigns(getCampaigns()); setDeleting(null); }
    catch (err) { setError((err as Error).message); }
  }
  return <div className="campaigns-page"><AppHeader /><main className="campaigns-main page-shell">
    <header className="campaigns-titlebar"><div><span className="ui-kicker">YOUR WORKSPACE</span><h1>แคมเปญของคุณ</h1><p>เตรียมรายชื่อ เลือก Agent และจัดการการยืนยันของคุณ</p></div><Button href={routes.createCampaign}>＋ {draft ? 'ทำฉบับร่างต่อ' : 'สร้างแคมเปญ'}</Button></header>
    <section className="campaign-summary-strip" aria-label="สรุปแคมเปญ"><div><span className="summary-symbol" aria-hidden="true">▤</span><div><span>แคมเปญที่บันทึกแล้ว</span><strong>{campaigns.length}<small>แคมเปญ</small></strong></div></div><div><span className="summary-symbol summary-symbol--teal" aria-hidden="true">◎</span><div><span>รายชื่อที่เตรียมไว้</span><strong>{campaigns.reduce((total, c) => total + c.csv.rows.length, 0).toLocaleString()}<small>รายชื่อ</small></strong></div></div><div><span className="summary-symbol summary-symbol--amber" aria-hidden="true">◷</span><div><span>รอเลือก Voice Agent</span><strong>{campaigns.filter(c => !c.agentId).length}<small>แคมเปญ</small></strong></div></div></section>
    <div className="workspace-local-note"><span aria-hidden="true">ⓘ</span><p>แคมเปญที่บันทึกไว้ <span>แคมเปญที่บันทึกแล้วใช้โทรจริงได้ ไม่ต้องเผยแพร่เพิ่ม กด “โทร / ดูผลแคมเปญ” เพื่อเลือกรายชื่อและยืนยันเริ่มโทร</span></p><a href={routes.apiTest}>ตรวจการเชื่อมต่อ ↗</a></div>
    <div className="workspace-toolbar"><h2>แคมเปญทั้งหมด <span className="count-pill">{campaigns.length}</span></h2><input className="workspace-search" type="search" placeholder="ค้นหาชื่อแคมเปญ…" aria-label="ค้นหาแคมเปญ" value={query} onChange={e => setQuery(e.target.value)} /></div>
    {legacy.length > 0 && <section className="workspace-notice"><p>พบแคมเปญเดิมในเบราว์เซอร์ {legacy.length} รายการ ตรวจว่าเป็นข้อมูลของคุณก่อนนำเข้าในบัญชีนี้</p><Button size="compact" disabled={busy} onClick={migrate}>{busy ? 'กำลังนำเข้า…' : 'นำเข้าฉบับร่างเดิมในบัญชีนี้'}</Button></section>}
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    {draft && <p className="workspace-notice">มีฉบับร่างที่ยังไม่เสร็จ: <a href={routes.createCampaign}>{draft.name}</a> <Button size="compact" variant="secondary" onClick={() => setDeleting(draft.id)}>ลบฉบับร่างที่ยังไม่เสร็จ</Button>{deleting === draft.id && !campaigns.some(c => c.id === draft.id) && <span> ลบฉบับร่างนี้? <Button size="compact" onClick={async () => { try { await discardDraft(); setDraft(null); setDeleting(null); } catch { setError('ลบฉบับร่างไม่ได้'); } }}>ยืนยันลบ</Button><Button size="compact" variant="secondary" onClick={() => setDeleting(null)}>ยกเลิก</Button></span>}</p>}
    <section className="campaigns-grid" aria-label="รายการแคมเปญ">{filtered.map(c => <article className="campaign-card" key={c.id}>
      <header className="campaign-card__header"><div className="campaign-card__identity"><span className="campaign-card__icon"><img src="/assets/campaigns/megaphone-off.svg" width="20" height="20" alt="" /></span><h2>{c.name}</h2></div><span className="campaign-saved-label">บันทึกแล้ว</span></header><CampaignStatus campaign={c} />
      <div className="campaign-card__metrics"><div className="campaign-card__detail"><span>ผู้ติดต่อ</span><strong>{c.csv.rows.length.toLocaleString()} รายชื่อ</strong></div><div className="campaign-card__detail"><span>วันจัดงาน</span><strong>{c.eventDate ? new Date(c.eventDate + 'T00:00:00').toLocaleDateString('th-TH') : 'ยังไม่ระบุ'}</strong></div><div className="campaign-card__detail"><span>Voice Agent</span><strong>{c.agentId || 'ยังไม่ได้เลือก'}</strong></div></div>
      <div className="draft-actions">{c.agentId && <Button size="compact" href={routes.campaignCall(c.id)}>โทร / ดูผลแคมเปญ</Button>}<Button size="compact" variant="secondary" onClick={() => open(c)}>แก้ไขแคมเปญ</Button><Button size="compact" variant="secondary" aria-expanded={expanded === c.id} onClick={() => setExpanded(expanded === c.id ? null : c.id)}>ดูรายชื่อ</Button><Button className="button--quiet-danger" size="compact" variant="secondary" onClick={() => setDeleting(c.id)}>ลบแคมเปญ</Button></div>
      {expanded === c.id && <div className="csv-preview"><table><caption>{c.fileName} · ตัวอย่าง 10 รายการแรก</caption><thead><tr>{c.csv.headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{c.csv.rows.slice(0, 10).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>}
      {deleting === c.id && <div className="workspace-alert" role="alert"><p>ลบแคมเปญ “{c.name}” และรายชื่อที่บันทึกไว้หรือไม่?</p><div className="draft-actions"><Button size="compact" onClick={() => remove(c.id)}>ยืนยันลบ</Button><Button size="compact" variant="secondary" onClick={() => setDeleting(null)}>ยกเลิก</Button></div></div>}
    </article>)}</section>
    {filtered.length === 0 && <section className="workspace-empty"><span className="empty-visual" aria-hidden="true">▤</span><h2>{query ? 'ไม่พบแคมเปญที่ค้นหา' : 'เริ่มการยืนยันครั้งแรกของคุณ'}</h2><p>{query ? 'ลองค้นหาด้วยชื่ออื่น' : 'อัปโหลด CSV เลือก Agent จับคู่ข้อมูล แล้วตรวจสรุปก่อนบันทึก'}</p>{!query && <Button href={routes.createCampaign}>{draft ? 'ทำฉบับร่างต่อ' : 'สร้างแคมเปญแรก'}</Button>}</section>}
  </main></div>;
}
