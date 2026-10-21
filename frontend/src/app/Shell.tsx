import { useEffect } from 'react';
import { SearchSelect } from '../components/SearchSelect';
import { EventNavigation } from './EventNavigation';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, BookOpen, Users, Phone, Columns3, Settings2, Menu, LogOut, X } from 'lucide-react';
import { useSession, authService } from '../features/auth';
import { useEvents } from '../features/events';
import { useWorkspace } from '../stores/workspace';
import { Button, Badge, QueryState } from '../components/ui';
const eventLinks: Record<string, string> = {
  dashboard: '',
  knowledge: 'knowledge',
  participants: 'participants',
  calling: 'calls',
  tickets: 'tickets',
  settings: 'settings',
};
const links = [
  ['dashboard', 'Dashboard', CalendarDays],
  ['events', 'Events', CalendarDays],
  ['knowledge', 'Knowledge & FAQ', BookOpen],
  ['participants', 'Participants', Users],
  ['calling', 'Call queues', Phone],
  ['tickets', 'Follow-up board', Columns3],
  ['settings', 'Settings', Settings2],
] as const;
export function Shell() {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const { orgId, eventId, selectOrg, selectEvent, mobileNav, toggleNav, reset } = useWorkspace();
  const events = useEvents();
  const client = useQueryClient();
  useEffect(() => {
    if (session.data && !orgId) selectOrg(session.data.organizations[0]?.id ?? '');
  }, [session.data, orgId, selectOrg]);
  useEffect(() => {
    if (events.data && !events.data.some((e) => e.id === eventId)) selectEvent(events.data[0]?.id ?? '');
  }, [events.data, eventId, selectEvent]);
  if (session.isPending) return <p className="loading">กำลังเปิด workspace…</p>;
  if (!session.data) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  const organization = session.data.organizations.find((o) => o.id === orgId);
  async function switchOrg(id: string) {
    await client.cancelQueries({ queryKey: ['org'] });
    client.removeQueries({ queryKey: ['org'] });
    selectOrg(id);
    navigate('/events');
  }
  async function logout() {
    await authService.logout();
    await client.cancelQueries();
    client.clear();
    reset();
  }
  return (
    <div className="workspace">
      <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
        <div className="wordmark">
          <span className="brand-mark">e.</span>event confirm
        </div>
        <Button className="mobile-menu" aria-label="ปิดเมนู" onClick={toggleNav}>
          <X size={18} />
        </Button>
        <EventNavigation
          key={orgId}
          orgId={orgId}
          eventId={eventId}
          events={events.data ?? []}
          pending={events.isPending}
          failed={events.isError}
          onSelect={(id) => {
            selectEvent(id);
            if (mobileNav) toggleNav();
          }}
        />
        <p className="nav-group">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {links.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={
                eventId && path in eventLinks
                  ? `/orgs/${encodeURIComponent(orgId)}/events/${encodeURIComponent(eventId)}/${eventLinks[path]}`
                  : `/${path}`
              }
              end={path === 'dashboard'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => {
                if (mobileNav) toggleNav();
              }}
            >
              <Icon size={17} strokeWidth={1.5} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="eyebrow">MADE FOR MEANINGFUL MOMENTS</p>
          <p className="muted text-xs mt-3">
            One workspace.
            <br />
            Every conversation.
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        {__MOCK__ && (
          <div className="preview-bar">
            {__DEMO__ ? 'UI DEMO' : 'DEVELOPMENT PREVIEW'} — ข้อมูลจำลอง · ไม่มีการโทรจริง · ข้อมูลรีเซ็ตเมื่อ
            reload
          </div>
        )}
        <header className="topbar">
          <Button className="mobile-menu" aria-label="เปิดเมนู" onClick={toggleNav}>
            <Menu size={18} />
          </Button>
          <SearchSelect
            label="Organization"
            value={orgId}
            options={session.data.organizations.map((o) => ({ id: o.id, label: o.name }))}
            onChange={(id) => void switchOrg(id)}
          />
          <div className="account">
            <Badge>{organization?.role}</Badge>
            <span className="account-name">{session.data.user.name}</span>
            <span className="avatar">NV</span>
            <Button
              variant="ghost"
              aria-label="ออกจากระบบ"
              onClick={() => void logout().catch(() => window.alert('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่'))}
            >
              <LogOut size={16} />
            </Button>
          </div>
        </header>
        <main className="content" key={`${orgId}:${eventId}`}>
          {events.isError && <QueryState pending={false} error={events.error} retry={events.refetch} />}
          {(orgId && events.isPending) ||
          (events.data?.length && !events.data.some((e) => e.id === eventId)) ? (
            <p role="status" className="loading">
              กำลังโหลด Event…
            </p>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
