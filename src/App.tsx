import { lazy, Suspense } from "react";
import { currentPath, routes } from "./routes";
import { WorkspaceGate, useIsDev } from './components/WorkspaceGate';
import { LoadingScreen } from './components/LoadingScreen';

// Every navigation is a full page load, so each page ships as its own chunk.
const CampaignCallPage = lazy(() => import("./pages/CampaignCallPage").then(m => ({ default: m.CampaignCallPage })));
const CampaignSummaryPage = lazy(() => import("./pages/CampaignSummaryPage").then(m => ({ default: m.CampaignSummaryPage })));
const AuthPage = lazy(() => import("./pages/AuthPage").then(m => ({ default: m.AuthPage })));
const ApiAgentPage = lazy(() => import("./pages/ApiAgentPage").then(m => ({ default: m.ApiAgentPage })));
const ApiTestWorkspacePage = lazy(() => import("./pages/ApiTestWorkspacePage").then(m => ({ default: m.ApiTestWorkspacePage })));
const DashboardOverviewPage = lazy(() => import("./pages/DashboardOverviewPage").then(m => ({ default: m.DashboardOverviewPage })));
const CampaignsPage = lazy(() => import("./pages/CampaignsPage").then(m => ({ default: m.CampaignsPage })));
const CreateCampaignPage = lazy(() => import("./pages/CreateCampaignPage").then(m => ({ default: m.CreateCampaignPage })));
const DataMappingPage = lazy(() => import("./pages/DataMappingPage").then(m => ({ default: m.DataMappingPage })));
const LandingPage = lazy(() => import("./pages/LandingPage").then(m => ({ default: m.LandingPage })));
const LiveAgentPage = lazy(() => import("./pages/LiveAgentPage").then(m => ({ default: m.LiveAgentPage })));
const ContactListPage = lazy(() => import("./pages/ContactListPage").then(m => ({ default: m.ContactListPage })));
const ContactDetailPage = lazy(() => import("./pages/ContactDetailPage").then(m => ({ default: m.ContactDetailPage })));
const AnalyticsPage = lazy(() => import("./pages/AnalyticsPage").then(m => ({ default: m.AnalyticsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then(m => ({ default: m.SettingsPage })));
const InboundPage = lazy(() => import("./pages/InboundPage").then(m => ({ default: m.InboundPage })));
export default function App() {
  const path = currentPath();
  const page = <Suspense fallback={<LoadingScreen />}><AppRoutes /></Suspense>;
  if (path === routes.home || path === routes.login) return page;
  return <WorkspaceGate>{page}</WorkspaceGate>;
}
function AppRoutes() {
  const path = currentPath();
  const isDev = useIsDev();

  if (path === routes.inbound) return <InboundPage />;

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

