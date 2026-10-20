import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../features/auth';
import { useEvents } from '../features/events';
import { useWorkspace } from '../stores/workspace';
import { Empty } from '../components/ui';
export function ScopedRoute() {
  const { orgId: requestedOrg, eventId: requestedEvent } = useParams();
  const { orgId, eventId, selectOrg, selectEvent } = useWorkspace();
  const session = useSession();
  const events = useEvents();
  const client = useQueryClient();
  const allowed = session.data?.organizations.some((org) => org.id === requestedOrg);
  useEffect(() => {
    let active = true;
    if (allowed && requestedOrg && requestedOrg !== orgId) {
      void client.cancelQueries({ queryKey: ['org'] }).then(() => {
        if (!active) return;
        client.removeQueries({ queryKey: ['org'] });
        selectOrg(requestedOrg);
      });
    } else if (requestedEvent && events.data?.some((event) => event.id === requestedEvent))
      selectEvent(requestedEvent);
    return () => {
      active = false;
    };
  }, [allowed, requestedOrg, requestedEvent, orgId, client, selectOrg, selectEvent, events.data]);
  if (!allowed) return <Empty title="ไม่มีสิทธิ์เข้าถึงองค์กรนี้" />;
  if (orgId !== requestedOrg || events.isPending) return <p role="status">กำลังเปิด workspace…</p>;
  if (requestedEvent && !events.data?.some((event) => event.id === requestedEvent))
    return <Empty title="ไม่พบ Event ในองค์กรนี้" />;
  if (requestedEvent && requestedEvent !== eventId) return <p role="status">กำลังเปิด Event…</p>;
  return <Outlet />;
}
