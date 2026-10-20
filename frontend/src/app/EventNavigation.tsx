import { useState } from 'react';
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
  const [search, setSearch] = useState('');
  const filtered = events.filter((e) => `${e.name} ${e.code}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <nav aria-label="Organization events">
      <p className="nav-group">EVENTS IN THIS ORGANIZATION</p>
      <input
        className="event-search"
        aria-label="Search organization events"
        placeholder="ค้นหาชื่อ / รหัส Event…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {pending ? (
        <p role="status" className="muted px-3 text-xs">
          กำลังโหลด Event…
        </p>
      ) : failed ? (
        <p className="muted px-3 text-xs">โหลดรายการ Event ไม่สำเร็จ</p>
      ) : !filtered.length ? (
        <p className="muted px-3 text-xs">ไม่พบ Event ที่ตรงกับคำค้น</p>
      ) : (
        filtered.map((event) => (
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
