import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronDown } from 'lucide-react';
import type { EventDto } from '../shared/contracts/events';
import './event-navigation.css';
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
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = events.find((event) => event.id === eventId);
  const filtered = events.filter((e) =>
    `${e.name} ${e.code}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <nav
      ref={root}
      className="event-picker"
      aria-label="Organization events"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <p className="nav-group">EVENT</p>
      <button
        ref={trigger}
        type="button"
        className="event-picker-trigger"
        aria-label="เลือก Event"
        aria-expanded={open}
        aria-controls={id}
        disabled={pending || failed}
        onClick={() => {
          setSearch('');
          setOpen(!open);
        }}
      >
        <CalendarDays size={17} className="shrink-0" aria-hidden="true" />
        <span>
          {pending ? 'กำลังโหลด Event…' : failed ? 'โหลด Event ไม่สำเร็จ' : (selected?.name ?? 'เลือก Event')}
        </span>
        <ChevronDown size={16} className="shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="event-picker-dropdown">
          <input
            autoFocus
            className="event-search"
            aria-label="Search organization events"
            placeholder="ค้นหาชื่อ / รหัส Event…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="event-picker-list">
            {!filtered.length && (
              <p role="status" className="muted p-3 text-xs">
                {events.length ? 'ไม่พบ Event ที่ตรงกับคำค้น' : 'ยังไม่มี Event ในองค์กรนี้'}
              </p>
            )}
            {filtered.map((event) => (
              <Link
                key={event.id}
                to={`/orgs/${encodeURIComponent(orgId)}/events/${encodeURIComponent(event.id)}`}
                className={`nav-link ${event.id === eventId ? 'active' : ''}`}
                aria-current={event.id === eventId ? 'true' : undefined}
                onClick={() => {
                  setOpen(false);
                  setSearch('');
                  onSelect(event.id);
                }}
              >
                <span className="min-w-0 break-words">
                  {event.name}
                  <small className="block muted">{event.code}</small>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
