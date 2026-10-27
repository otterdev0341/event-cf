import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { CampaignSchedule } from '../components/CampaignSchedule';
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
    <header className="rd-head"><div><span className="ui-kicker">YOUR WORKSPACE</span><h1>แคมเปญของคุณ</h1><p>เตรียมรายชื่อ เลือก Agent และจัดการการยืนยันของคุณ</p></div><div className="rd-head__actions"><a className="rd-link" href={routes.apiTest}>ตรวจการเชื่อมต่อ ↗</a><Button href={routes.createCampaign}>+ {draft ? 'ทำฉบับร่างต่อ' : 'สร้างแคมเปญ'}</Button></div></header>
    {draft && <div className="rd-banner">
      <div className="rd-banner__body"><span className="rd-banner__icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></span><p><strong>ทำต่อจากครั้งที่แล้ว</strong><small>ฉบับร่าง “{draft.name || 'แคมเปญใหม่'}”</small></p></div>
      {deleting === draft.id && !campaigns.some(c => c.id === draft.id)
        ? <div className="rd-head__actions" role="alert"><span>ลบฉบับร่างนี้?</span><Button size="compact" onClick={async () => { try { await discardDraft(); setDraft(null); setDeleting(null); } catch { setError('ลบฉบับร่างไม่ได้'); } }}>ยืนยันลบ</Button><Button size="compact" variant="secondary" onClick={() => setDeleting(null)}>ยกเลิก</Button></div>
        : <div className="rd-head__actions"><Button size="compact" variant="secondary" className="button--quiet-danger" onClick={() => setDeleting(draft.id)}>ลบฉบับร่าง</Button><Button size="compact" href={routes.createCampaign}>ทำต่อ</Button></div>}
    </div>}
    <section className="rd-stats" aria-label="สรุปแคมเปญ">
      <div className="rd-card rd-pad rd-summary"><span>แคมเปญที่บันทึกแล้ว</span><strong>{campaigns.length.toLocaleString()}</strong></div>
      <div className="rd-card rd-pad rd-summary"><span>รายชื่อที่เตรียมไว้</span><strong>{campaigns.reduce((total, c) => total + c.csv.rows.length, 0).toLocaleString()}</strong></div>
      <div className="rd-card rd-pad rd-summary"><span>รอเลือก Voice Agent</span><strong>{campaigns.filter(c => !c.agentId).length.toLocaleString()}</strong></div>
    </section>
    <div className="rd-filters" style={{justifyContent:'space-between'}}><h2 className="rd-section-title">แคมเปญทั้งหมด <span className="rd-chip rd-chip--plain">{campaigns.length}</span></h2><label className="rd-search"><span className="sr-only">ค้นหาแคมเปญ</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4"/></svg><input type="search" placeholder="ค้นหาชื่อแคมเปญ…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    {legacy.length > 0 && <section className="workspace-notice"><p>พบแคมเปญเดิมในเบราว์เซอร์ {legacy.length} รายการ ตรวจว่าเป็นข้อมูลของคุณก่อนนำเข้าในบัญชีนี้</p><Button size="compact" disabled={busy} onClick={migrate}>{busy ? 'กำลังนำเข้า…' : 'นำเข้าฉบับร่างเดิมในบัญชีนี้'}</Button></section>}
    {error && <p className="workspace-alert" role="alert">{error}</p>}
    <section className="rd-grid" aria-label="รายการแคมเปญ">{filtered.map(c => <article className="rd-card rd-pad rd-campaign" key={c.id}>
      <header><h2>{c.name}</h2><span className="rd-muted">วันจัดงาน {c.eventDate ? new Date(c.eventDate + 'T00:00:00').toLocaleDateString('th-TH', { dateStyle: 'medium' }) : 'ยังไม่ระบุ'}</span></header>
      <dl className="rd-campaign__facts"><div><dt>Voice Agent</dt><dd>{c.agentId || 'ยังไม่ได้เลือก'}</dd></div><div><dt>รายชื่อ</dt><dd>{c.csv.rows.length.toLocaleString()} คน</dd></div></dl>
      <CampaignStatus campaign={c} />
      <CampaignSchedule campaignId={c.id} />
      <div className="rd-campaign__actions">
        {c.agentId ? <Button size="compact" href={routes.campaignCall(c.id)}>โทร / ดูผลแคมเปญ</Button> : <Button size="compact" onClick={() => open(c)}>เลือก Agent</Button>}
        <Button size="compact" variant="secondary" aria-label="แก้ไขแคมเปญ" title="แก้ไขแคมเปญ" onClick={() => open(c)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></Button>
        <Button size="compact" variant="secondary" aria-label="ดูรายชื่อ" title="ดูรายชื่อ" aria-expanded={expanded === c.id} onClick={() => setExpanded(expanded === c.id ? null : c.id)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a3 3 0 0 0-2-2.8M17 5.2a3 3 0 0 1 0 5.6"/></svg></Button>
        <Button size="compact" variant="secondary" className="button--quiet-danger" aria-label="ลบแคมเปญ" title="ลบแคมเปญ" onClick={() => setDeleting(c.id)}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></Button>
      </div>
      {expanded === c.id && <div className="csv-preview"><table><caption>{c.fileName} · ตัวอย่าง 10 รายการแรก</caption><thead><tr>{c.csv.headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{c.csv.rows.slice(0, 10).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>}
      {deleting === c.id && <div className="workspace-alert" role="alert"><p>ลบแคมเปญ “{c.name}” และรายชื่อที่บันทึกไว้หรือไม่?</p><div className="draft-actions"><Button size="compact" onClick={() => remove(c.id)}>ยืนยันลบ</Button><Button size="compact" variant="secondary" onClick={() => setDeleting(null)}>ยกเลิก</Button></div></div>}
    </article>)}</section>
    {filtered.length === 0 && <section className="workspace-empty"><span className="empty-visual" aria-hidden="true">▤</span><h2>{query ? 'ไม่พบแคมเปญที่ค้นหา' : 'เริ่มการยืนยันครั้งแรกของคุณ'}</h2><p>{query ? 'ลองค้นหาด้วยชื่ออื่น' : 'อัปโหลด CSV เลือก Agent จับคู่ข้อมูล แล้วตรวจสรุปก่อนบันทึก'}</p>{!query && <Button href={routes.createCampaign}>{draft ? 'ทำฉบับร่างต่อ' : 'สร้างแคมเปญแรก'}</Button>}</section>}
  </main></div>;
}
