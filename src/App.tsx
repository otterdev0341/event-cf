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
import { InboundPage } from "./pages/InboundPage";
import { ApiDocsPage } from "./pages/ApiDocsPage";
import { currentPath, routes } from "./routes";

import { WorkspaceGate, useIsDev } from './components/WorkspaceGate';
export default function App() {
  const path = currentPath();
  if (path === routes.home || path === routes.login) return <AppRoutes />;
  return <WorkspaceGate><AppRoutes /></WorkspaceGate>;
}
function AppRoutes() {
  const path = currentPath();
  const isDev = useIsDev();

  if (path === routes.inbound) return <InboundPage />;
  if (path === routes.apiDocs) return <ApiDocsPage />;

  if (path === routes.login) {
    return <AuthPage />;
  }

  if (path === routes.dashboard) {
    return <DashboardOverviewPage />;
  }

  if (path === routes.liveAgent) {
    return isDev ? <LiveAgentPage /> : <DashboardOverviewPage />;
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

  const contactSegment = path.startsWith(`${routes.contacts}/`) ? path.slice(routes.contacts.length + 1) : "";
  if (contactSegment && !contactSegment.includes("/")) {
    let contactId: string;
    try { contactId = decodeURIComponent(contactSegment); } catch { return <ContactDetailPage />; }
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

