import { CampaignCallPage } from "./pages/CampaignCallPage";
import { CampaignSummaryPage } from "./pages/CampaignSummaryPage";
import { AuthPage } from "./pages/AuthPage";
import { ApiAgentPage } from "./pages/ApiAgentPage";
import { ApiTestWorkspacePage } from "./pages/ApiTestWorkspacePage";
import { DashboardOverviewPage } from "./pages/DashboardOverviewPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { CreateCampaignPage } from "./pages/CreateCampaignPage";
import { DataMappingPage } from "./pages/DataMappingPage";
import { LandingPage } from "./pages/LandingPage";
import { LiveAgentPage } from "./pages/LiveAgentPage";
import { ContactListPage } from "./pages/ContactListPage";
import { ContactDetailPage } from "./pages/ContactDetailPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { routes } from "./routes";

import { WorkspaceGate } from './components/WorkspaceGate';
export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === routes.home || path === routes.login) return <AppRoutes />;
  return <WorkspaceGate><AppRoutes /></WorkspaceGate>;
}
function AppRoutes() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";

  if (path === routes.login) {
    return <AuthPage />;
  }

  if (path === routes.dashboard) {
    return <DashboardOverviewPage />;
  }

  if (path === routes.liveAgent) {
    return <LiveAgentPage />;
  }

  if (path === routes.campaigns) {
    return <CampaignsPage />;
  }

  if (path === routes.createCampaign) {
    return <CreateCampaignPage />;
  }

  if (path === routes.dataMapping) {
    return <DataMappingPage />;
  }

  if (path === routes.apiAgent) {
    return <ApiAgentPage />;
  }

  if (path === routes.campaignSummary) return <CampaignSummaryPage />;

  if (path === routes.apiTest) {
    return new URLSearchParams(window.location.search).has("campaign") ? <CampaignCallPage /> : <ApiTestWorkspacePage />;
  }

  if (path === routes.contacts) {
    return <ContactListPage />;
  }

  const contactMatch = path.match(/^\/contacts\/([^/]+)$/);
  if (contactMatch) {
    let contactId: string;
    try { contactId = decodeURIComponent(contactMatch[1]); } catch { return <ContactDetailPage />; }
    return <ContactDetailPage contactId={contactId} />;
  }

  if (path === routes.contactDetail) {
    return <ContactDetailPage contactId={undefined} />;
  }

  if (path === routes.analytics) {
    return <AnalyticsPage />;
  }

  if (path === routes.settings) {
    return <SettingsPage />;
  }

  return <LandingPage />;
}

