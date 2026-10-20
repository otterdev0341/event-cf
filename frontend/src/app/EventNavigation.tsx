import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import type { EventDto } from '../shared/contracts/events';
type Props = {
  orgId: string;
  eventId: string;
  events: EventDto[];
  pending: boolean;
  failed: boolean;
  onSelect: (id: string) => void;
};
export function EventNavigation({ orgId, eventId, events, pending, failed, onSelect }: Props) {
  return (
    <nav aria-label="Organization events">
      <p className="nav-group">EVENTS IN THIS ORGANIZATION</p>
      {pending ? (
        <p role="status" className="muted px-3 text-xs">
          กำลังโหลด Event…
        </p>
      ) : failed ? (
        <p className="muted px-3 text-xs">โหลดรายการ Event ไม่สำเร็จ</p>
      ) : !events.length ? (
        <p className="muted px-3 text-xs">ยังไม่มี Event ในองค์กรนี้</p>
      ) : (
        events.map((event) => (
          <Link
            key={event.id}
            to={`/orgs/${encodeURIComponent(orgId)}/events/${encodeURIComponent(event.id)}`}
            className={`nav-link ${event.id === eventId ? 'active' : ''}`}
            aria-current={event.id === eventId ? 'true' : undefined}
            onClick={() => onSelect(event.id)}
          >
            <CalendarDays size={17} className="shrink-0" />
            <span className="min-w-0 break-words">{event.name}</span>
          </Link>
        ))
      )}
    </nav>
  );
}
