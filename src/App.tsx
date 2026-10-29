import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { currentPath, navigate, routes } from "./routes";
import { WorkspaceGate, useIsDev } from './components/WorkspaceGate';
import { LoadingScreen } from './components/LoadingScreen';
import { getCampaigns } from './lib/campaigns';

// Each page ships as its own chunk and loads the first time it is opened.
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
const ApiDocsPage = lazy(() => import("./pages/ApiDocsPage").then(m => ({ default: m.ApiDocsPage })));
const subscribe = (onChange: () => void) => { window.addEventListener("popstate", onChange); return () => window.removeEventListener("popstate", onChange); };
const locationKey = () => window.location.pathname + window.location.search;

// In-app links switch pages without a full reload, so the session and loaded campaigns are kept.
function inAppHref(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return null;
  const url = new URL(link.href);
  // Hash links scroll inside the page they open, and files (ReDoc, OpenAPI) are not app pages.
  if (url.origin !== window.location.origin || url.hash || !url.pathname.startsWith(import.meta.env.BASE_URL) || /\.[a-z0-9]+$/i.test(url.pathname) || url.pathname.startsWith(`${import.meta.env.BASE_URL}api/`)) return null;
  return url.pathname + url.search;
}

export default function App() {
  const key = useSyncExternalStore(subscribe, locationKey);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const href = inAppHref(event);
      if (href === null) return;
      event.preventDefault();
      if (href !== locationKey()) navigate(href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  const path = currentPath();
  const page = <Suspense fallback={<LoadingScreen />}><AppRoutes key={key} /></Suspense>;
  if (path === routes.home || path === routes.login) return page;
  return <WorkspaceGate>{page}</WorkspaceGate>;
}
function AppRoutes() {
  const path = currentPath();
  const isDev = useIsDev();

  // The old outbound board is now the campaign screen; keep its links (?campaign, ?row, ?status) working.
  if (path === routes.outbound || path === routes.inbound) {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('campaign') || getCampaigns().find(c => c.agentId)?.id;
    if (!id) { window.history.replaceState(null, '', routes.campaigns); return <CampaignsPage />; }
    params.set('campaign', id);
    window.history.replaceState(null, '', `${routes.apiTest}?${params}`);
    return <CampaignCallPage />;
  }
  if (path === routes.apiDocs) return isDev ? <ApiDocsPage /> : <DashboardOverviewPage />;

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

