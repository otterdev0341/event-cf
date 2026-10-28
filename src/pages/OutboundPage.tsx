import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { CampaignBoard } from '../components/CampaignBoard';
import { SmoothSelect } from '../components/ui/smooth-select';
import { getCampaigns } from '../lib/campaigns';
import { routes } from '../routes';
import { OutboundSetup } from './InboundPage';

export function OutboundPage() {
  const campaigns = getCampaigns().filter(c => c.agentId);
  const [campaignId, setCampaignId] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get('campaign');
    return campaigns.find(c => c.id === wanted)?.id || campaigns[0]?.id || '';
  });
  const [showSetup, setShowSetup] = useState(false);
  const campaign = campaigns.find(c => c.id === campaignId);
  function pick(id: string) {
    setCampaignId(id);
    const url = new URL(window.location.href); url.searchParams.set('campaign', id);
    window.history.replaceState(null, '', url);
  }
  return <div className="inbound-page outbound-page"><AppHeader activeNav="outbound" /><main className="analytics-main page-shell real-data-page inbound-main">
    <header className="rd-head"><div><span className="ui-kicker">OUTBOUND CALLS</span><h1>สายออก</h1><p>เลือกแคมเปญ กดเริ่มโทรเมื่อพร้อม แล้วติดตามผลของแต่ละคนได้ที่นี่ ระบบไม่โทรเองจนกว่าคุณจะกดเริ่ม</p></div></header>
    {campaign ? <CampaignBoard key={campaign.id} campaign={campaign} title={campaigns.length > 1
      ? <SmoothSelect aria-label="เลือกแคมเปญ" className="outbound-title" value={campaignId} onChange={pick} options={campaigns.map(c => ({ value: c.id, label: c.name }))} />
      : undefined} />
      : <section className="workspace-empty"><h2>ยังไม่มีแคมเปญที่พร้อมโทร</h2><p>สร้างแคมเปญ เลือก Agent และจับคู่ข้อมูลให้ครบ แล้วกลับมาที่บอร์ดนี้</p><Button href={routes.createCampaign}>สร้างแคมเปญ</Button></section>}
    <section className="rd-card outbound-setup">
      <button type="button" className="outbound-setup__toggle" aria-expanded={showSetup} onClick={() => setShowSetup(v => !v)}>
        <span><strong>ข้อมูลสำหรับบอท</strong><small>ตั้งข้อมูลที่บอทใช้ตอบ และฟังเสียงบันทึก</small></span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: showSetup ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {showSetup && <div className="outbound-setup__body rd-stack"><OutboundSetup /></div>}
    </section>
  </main></div>;
}
