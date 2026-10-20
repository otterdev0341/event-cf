import type { Ticket } from '../../shared/contracts/tickets';
import { Badge, Button, Empty } from '../../components/ui';
import { ticketColumns } from './columns';
export function TicketTable({
  tickets,
  assignees,
  canEdit,
  pending,
  onOpen,
  onMove,
}: {
  tickets: Ticket[];
  assignees: (ticket: Ticket) => string;
  canEdit: boolean;
  pending: boolean;
  onOpen: (id: string) => void;
  onMove: (ticket: Ticket, status: Ticket['status']) => void;
}) {
  return (
    <div className="panel table-wrap">
      <table aria-label="Follow-up tickets">
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Type</th>
            <th>Stage</th>
            <th>Assignees</th>
            <th>Due date</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <Button variant="ghost" disabled={pending} onClick={() => onOpen(ticket.id)}>
                  {ticket.title}
                </Button>
              </td>
              <td>
                <Badge>{ticket.type}</Badge>
              </td>
              <td>
                <select
                  aria-label={`Move ${ticket.title}`}
                  value={ticket.status}
                  disabled={!canEdit || pending}
                  onChange={(e) => onMove(ticket, e.target.value as Ticket['status'])}
                >
                  {ticketColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>{assignees(ticket) || 'Unassigned'}</td>
              <td>{ticket.dueDate || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!tickets.length && <Empty title="ไม่มี ticket ที่ตรงกับตัวกรอง" />}
    </div>
  );
}
