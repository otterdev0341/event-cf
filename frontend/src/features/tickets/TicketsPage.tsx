import { useParams } from 'react-router-dom';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useEvent } from '../events';
import { useWorkspace } from '../../stores/workspace';
import { useEventQuery } from '../../shared/api/useEventQuery';
import { useAction } from '../../shared/api/query';
import { usePermissions } from '../../shared/api/usePermissions';
import { ticketService } from './service';
import { useTicketMove } from './hooks';
import { TicketForm, TicketDetail } from './TicketForms';
import type { TicketInput, Ticket } from '../../shared/contracts/tickets';
import { Badge, Button, Empty, Feedback, PageHeader, QueryState } from '../../components/ui';
const columns = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'resolved', label: 'Resolved' },
] as const;
export function TicketsPage() {
  const { event } = useEvent();
  const { ticketId } = useParams();
  const { orgId, eventId } = useWorkspace();
  const { canEdit } = usePermissions();
  const query = useEventQuery('tickets', ticketService.list);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(ticketId ?? null);
  const [view, setView] = useState('board');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const move = useTicketMove();
  const create = useAction(
    async (input: TicketInput) => {
      await ticketService.create(orgId, eventId, input);
      setCreating(false);
    },
    ['org', orgId, eventId],
  );
  const detail = query.data?.find((t) => t.id === selected);
  const update = useAction(
    async (input: { assignee?: string; dueDate?: string; comment?: string }) => {
      await ticketService.update(orgId, eventId, detail!.id, { ...input, expectedVersion: detail!.version });
      setSelected(null);
    },
    ['org', orgId, eventId],
  );
  if (!event) return <Empty title="เลือก Event เพื่อดู follow-up board" />;
  const tickets =
    query.data?.filter(
      (t) =>
        `${t.title} ${t.assignee}`.toLowerCase().includes(search.toLowerCase()) &&
        (type === 'all' || t.type === type),
    ) ?? [];
  const card = (ticket: Ticket) => (
    <article
      className="ticket-card"
      key={ticket.id}
      draggable={canEdit && !move.isPending}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', ticket.id)}
    >
      <div className="flex justify-between gap-2">
        <Badge>{ticket.type === 'callback' ? 'CALLBACK' : 'QUESTION'}</Badge>
        <span className="eyebrow">v{ticket.version}</span>
      </div>
      <button
        className="text-left w-full"
        disabled={move.isPending}
        onClick={() => {
          update.reset();
          setSelected(ticket.id);
        }}
      >
        <h3>{ticket.title}</h3>
      </button>
      <p className="muted text-xs">
        {ticket.assignee || 'Unassigned'}
        {ticket.dueDate ? ` · Due ${ticket.dueDate}` : ''}
      </p>
      <select
        aria-label={`Move ${ticket.title}`}
        disabled={!canEdit || move.isPending}
        value={ticket.status}
        onChange={(e) => move.mutate({ ticket, status: e.target.value as Ticket['status'] })}
      >
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </article>
  );
  return (
    <>
      <PageHeader
        eyebrow={`${event.code} / HUMAN FOLLOW-UP`}
        title="Some things need a person."
        description="ติดตามคำถามที่ AI ตอบไม่ได้ และคำขอให้ติดต่อกลับ โดยแยกจากผลยืนยันเข้าร่วม"
        action={
          canEdit && (
            <Button
              variant="brand"
              onClick={() => {
                create.reset();
                setCreating(true);
              }}
            >
              <Plus size={16} />
              Create ticket
            </Button>
          )
        }
      />
      <div className="toolbar">
        <input
          aria-label="Search tickets"
          placeholder="ค้นหา ticket หรือผู้รับผิดชอบ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Ticket type filter" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          <option value="unanswered">Unanswered question</option>
          <option value="callback">Callback</option>
        </select>
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => setView(view === 'board' ? 'list' : 'board')}
        >
          {view === 'board' ? 'List view' : 'Board view'}
        </Button>
      </div>
      <Feedback error={move.error} notice={create.notice || update.notice} />
      <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      {view === 'board' ? (
        <div className="board">
          {columns.map((column) => (
            <section
              className="column"
              key={column.id}
              aria-label={column.label}
              onDragOver={(e) => {
                if (canEdit) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const ticket = tickets.find((t) => t.id === e.dataTransfer.getData('text/plain'));
                if (canEdit && !move.isPending && ticket && ticket.status !== column.id)
                  move.mutate({ ticket, status: column.id });
              }}
            >
              <h2 className="column-heading">
                {column.label}
                <span>{tickets.filter((t) => t.status === column.id).length}</span>
              </h2>
              {tickets.filter((t) => t.status === column.id).map(card)}
              {!tickets.some((t) => t.status === column.id) && (
                <p className="muted text-xs py-6">ยังไม่มี ticket ในสถานะนี้</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div>
          {tickets.map(card)}
          {!tickets.length && <Empty title="ไม่มี ticket ที่ตรงกับตัวกรอง" />}
        </div>
      )}
      {creating && (
        <TicketForm
          onClose={() => setCreating(false)}
          onSave={create.mutate}
          pending={create.isPending}
          error={create.error}
        />
      )}
      {detail && (
        <TicketDetail
          ticket={detail}
          onClose={() => setSelected(null)}
          onSave={update.mutate}
          pending={update.isPending}
          error={update.error}
          canEdit={canEdit}
        />
      )}
    </>
  );
}
