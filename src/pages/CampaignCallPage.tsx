import { useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { Button } from '../components/Button';
import { CampaignBoard } from '../components/CampaignBoard';
import { getCampaigns } from '../lib/campaigns';
import { routes } from '../routes';

export function CampaignCallPage() {
  const [campaign] = useState(() => getCampaigns().find(c => c.id === new URLSearchParams(window.location.search).get('campaign')));
  return <div><AppHeader /><main className="page-shell real-data-page call-workspace">
    {campaign ? <CampaignBoard campaign={campaign} /> : <><h1>ไม่พบแคมเปญนี้</h1><Button href={routes.campaigns}>กลับไปแคมเปญ</Button></>}
  </main></div>;
}
