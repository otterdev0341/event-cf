import { toEventSummary } from './view-model';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Plus, ArrowUpRight } from 'lucide-react';
import { useEvents } from './hooks';
import { eventService } from './service';
import { EventForm } from './EventForm';
import { useWorkspace } from '../../stores/workspace';
import { useAction } from '../../shared/api/query';
import { usePermissions } from '../../shared/api/usePermissions';
import type { EventDto, EventInput } from '../../shared/contracts/events';
import { Badge, Button, Empty, Feedback, PageHeader, QueryState } from '../../components/ui';
export function EventsPage() {
  const events = useEvents();
  const location = useLocation();
  const { orgId, selectEvent } = useWorkspace();
  const { canCreateEvent, canEditEvent } = usePermissions();
  const [editing, setEditing] = useState<EventDto | 'new' | null>(
    location.pathname.endsWith('/new') && canCreateEvent ? 'new' : null,
  );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const save = useAction(
    async (input: EventInput) => {
      const result =
        editing && editing !== 'new'
          ? await eventService.update(orgId, editing.id, input, editing.version)
          : await eventService.create(orgId, input);
      await events.refetch();
      setEditing(null);
      selectEvent(result.id);
      return result;
    },
    ['org', orgId],
  );
  const updateStatus = useAction(
    ({ event, status }: { event: EventDto; status: string }) =>
      eventService.status(orgId, event.id, status, event.version),
    ['org', orgId],
  );
  const all = events.data ?? [];
  const filtered = all.filter(
    (e) =>
      `${e.name} ${e.code}`.toLowerCase().includes(search.toLowerCase()) &&
      (status === 'all' || status === e.status),
  );
  return (
    <>
      <PageHeader
        eyebrow="01 / EVENT OPERATIONS"
        title="Good moments start here."
        description="ทุกอีเวนท์ ทุกคำถาม และทุกการยืนยัน — จัดการได้ในที่เดียว"
        action={
          canCreateEvent && (
            <Button
              variant="brand"
              onClick={() => {
                save.reset();
                setEditing('new');
              }}
            >
              <Plus size={16} />
              Create event
            </Button>
          )
        }
      />
      <div className="stats">
        <div className="stat">
          <p className="eyebrow">EVENTS IN YOUR WORKSPACE</p>
          <strong>{all.length.toString().padStart(2, '0')}</strong>
        </div>
        <div className="stat">
          <p className="eyebrow">PUBLISHED EVENTS</p>
          <strong>
            {all
              .filter((e) => e.status === 'published')
              .length.toString()
              .padStart(2, '0')}
          </strong>
        </div>
        <div className="stat">
          <p className="eyebrow">PEOPLE INVITED</p>
          <strong>
            {all
              .reduce((n, e) => n + e.participantCount, 0)
              .toString()
              .padStart(2, '0')}
          </strong>
        </div>
      </div>
      <div className="toolbar">
        <input
          aria-label="Search events"
          placeholder="ค้นหาอีเวนท์หรือรหัส…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Event status filter" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All events</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>
        <span className="eyebrow ml-auto">{filtered.length} EVENTS</span>
      </div>
      <Feedback error={updateStatus.error} notice={save.notice || updateStatus.notice} />
      <QueryState pending={events.isPending} error={events.error} retry={events.refetch} />
      {!!filtered.length && (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Date / location</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id}>
                  <td>
                    <p className="event-name">{event.name}</p>
                    <span className="eyebrow">{event.code}</span>
                  </td>
                  <td>
                    <p>{toEventSummary(event).dateLabel}</p>
                    <small className="muted">{event.location}</small>
                  </td>
                  <td>
                    <Badge tone={event.status}>{event.status}</Badge>
                  </td>
                  <td>
                    <div className="flex gap-2 items-center flex-wrap">
                      <Link className="event-link" to="/knowledge" onClick={() => selectEvent(event.id)}>
                        Open workspace <ArrowUpRight size={14} />
                      </Link>
                      {canEditEvent(event.id) && (
                        <>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              save.reset();
                              setEditing(event);
                            }}
                          >
                            แก้ไข
                          </Button>
                          <Button
                            variant="ghost"
                            pending={updateStatus.isPending}
                            onClick={() => {
                              const status = event.status === 'published' ? 'archived' : 'published';
                              if (window.confirm(`${status} Event ${event.name}?`))
                                updateStatus.mutate({ event, status });
                            }}
                          >
                            {event.status === 'published' ? 'Archive' : 'Publish'}
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!events.isPending && !events.error && !filtered.length && (
        <Empty title="ยังไม่มีอีเวนท์ที่ตรงกับการค้นหา">สร้าง Event แรก หรือปรับตัวกรองเพื่อเริ่มต้น</Empty>
      )}
      <div className="dark-panel mt-8 flex justify-between gap-8 items-center">
        <div>
          <p className="eyebrow text-white/60">FROM INVITATION TO CONVERSATION</p>
          <h2 className="mt-2">Make room for the human part.</h2>
          <p className="muted mt-2">เตรียม FAQ ให้ AI ตอบคำถาม และส่งต่อเรื่องที่ต้องดูแลเป็นพิเศษให้ทีม</p>
        </div>
        <ArrowUpRight size={32} strokeWidth={1} />
      </div>
      {editing && (
        <EventForm
          event={editing === 'new' ? undefined : editing}
          onSave={save.mutate}
          onClose={() => setEditing(null)}
          pending={save.isPending}
          error={save.error}
        />
      )}
    </>
  );
}
