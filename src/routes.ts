// Every app URL lives under Vite's base path (/event-confirm/ in production).
const base = import.meta.env.BASE_URL.replace(/\/+$/, "");

export const routes = {
  home: `${base}/`,
  login: `${base}/login`,
  dashboard: `${base}/dashboard`,
  liveAgent: `${base}/live-agent`,
  // Old addresses of the outbound board; App redirects both to the campaign screen.
  outbound: `${base}/outbound`,
  inbound: `${base}/inbound`,
  campaigns: `${base}/campaigns`,
  createCampaign: `${base}/campaigns/new`,
  dataMapping: `${base}/campaigns/data-mapping`,
  campaignSummary: `${base}/campaigns/summary`,
  apiAgent: `${base}/campaigns/api-agent`,
  apiTest: `${base}/campaigns/api-test`,
  campaignCall: (id: string) => `${base}/campaigns/api-test?campaign=${encodeURIComponent(id)}`,
  contacts: `${base}/contacts`,
  contactDetail: `${base}/contacts/1`,
  contactDetailWithId: (id: number | string) => `${base}/contacts/${encodeURIComponent(String(id))}`,
  analytics: `${base}/analytics`,
  settings: `${base}/settings`,
  apiDocs: `${base}/api-docs`,
} as const;

/** The current pathname without trailing slashes, comparable with the values in routes. */
export function currentPath() {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path === base ? routes.home : path;
}

// Pages doing work that stops when they unmount (a running call queue) register a warning here.
const leaveWarnings = new Set<{ message: string }>();
export function warnBeforeLeave(message: string) {
  const entry = { message };
  leaveWarnings.add(entry);
  return () => { leaveWarnings.delete(entry); };
}

/** Moves to an in-app address without reloading the page; App re-renders on popstate. */
export function navigate(href: string) {
  for (const { message } of leaveWarnings) if (!window.confirm(message)) return false;
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
  return true;
}
