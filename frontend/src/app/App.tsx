import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
  isRouteErrorResponse,
  useRouteError,
} from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { ThemeProvider } from './ThemeProvider';
import { SettingsPage } from '../features/settings';
import { ScopedRoute } from './ScopedRoute';
import { Shell } from './Shell';
import { AuthPage, TokenPage } from '../features/auth';
import { EventsPage, EventOverview } from '../features/events';
import { KnowledgePage } from '../features/knowledge';
import { ParticipantsPage } from '../features/participants';
import { CallingPage } from '../features/calling';
import { TicketsPage } from '../features/tickets';
import { AgentAccessPage } from '../features/agent-access';
import { OrganizationPage, OrganizationsPage } from '../features/organizations';
function ErrorPage() {
  const error = useRouteError();
  return (
    <main className="content">
      <h1>{isRouteErrorResponse(error) ? `${error.status} — Page unavailable` : 'Something went wrong'}</h1>
      <p>ลองโหลดหน้าใหม่ หากยังมีปัญหาให้กลับไป workspace</p>
      <a className="event-link" href="/event-confirm/">
        Back to workspace →
      </a>
    </main>
  );
}
const Gallery = lazy(() => import('../components/Gallery').then((m) => ({ default: m.Gallery })));
const router = createBrowserRouter(
  [
    { path: '/login', element: <AuthPage />, errorElement: <ErrorPage /> },
    { path: '/forgot-password', element: <AuthPage />, errorElement: <ErrorPage /> },
    { path: '/reset-password', element: <TokenPage />, errorElement: <ErrorPage /> },
    {
      path: '/',
      element: <Shell />,
      errorElement: <ErrorPage />,
      children: [
        { index: true, element: <Navigate to="/events" replace /> },
        { path: 'events', element: <EventsPage /> },
        { path: 'dashboard', element: <EventOverview /> },
        { path: 'settings', element: <SettingsPage /> },
        ...(__MOCK__
          ? [
              {
                path: 'components',
                element: (
                  <Suspense fallback={<p>Loading…</p>}>
                    <Gallery />
                  </Suspense>
                ),
              },
            ]
          : []),
        {
          path: 'orgs/:orgId',
          element: <ScopedRoute />,
          children: [
            { path: 'events', element: <EventsPage /> },
            { path: 'events/new', element: <EventsPage /> },
            { path: 'tickets', element: <TicketsPage /> },
            { path: 'tickets/:ticketId', element: <TicketsPage /> },
            { path: 'settings/members', element: <OrganizationPage /> },
            { path: 'settings/agent-access', element: <AgentAccessPage /> },
            {
              path: 'events/:eventId',
              element: <ScopedRoute />,
              children: [
                { index: true, element: <EventOverview /> },
                { path: 'knowledge', element: <KnowledgePage /> },
                { path: 'participants', element: <ParticipantsPage /> },
                { path: 'calls', element: <CallingPage /> },
                { path: 'tickets', element: <TicketsPage /> },
                { path: 'settings/credentials', element: <AgentAccessPage /> },
              ],
            },
          ],
        },
        { path: 'knowledge', element: <KnowledgePage /> },
        { path: 'participants', element: <ParticipantsPage /> },
        { path: 'calling', element: <CallingPage /> },
        { path: 'tickets', element: <TicketsPage /> },
        { path: 'agent-access', element: <AgentAccessPage /> },
        { path: 'organization', element: <OrganizationPage /> },
        { path: 'organizations', element: <OrganizationsPage /> },
      ],
    },
  ],
  { basename: '/event-confirm' },
);
export function App() {
  return (
    <>
      <ThemeProvider />
      <RouterProvider router={router} />
    </>
  );
}
