import { AssigneePicker } from './AssigneePicker';
import type { Ticket, TicketInput } from '../../shared/contracts/tickets';
import { Dialog } from '../../components/Dialog';
import { Button, Field, Feedback, formText, Badge } from '../../components/ui';
export function TicketForm({
  onClose,
  onSave,
  pending,
  error,
}: {
  onClose: () => void;
  onSave: (v: TicketInput) => void;
  pending: boolean;
  error: Error | null;
}) {
  return (
    <Dialog title="Create follow-up ticket" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          onSave({
            title: formText(f, 'title'),
            type: formText(f, 'type') as TicketInput['type'],
            description: formText(f, 'description'),
            assigneeIds: new FormData(f).getAll('assigneeIds').map(String),
            dueDate: formText(f, 'dueDate'),
          });
        }}
      >
        <Field label="Title">
          <input name="title" required maxLength={180} autoFocus />
        </Field>
        <Field label="Type">
          <select name="type">
            <option value="unanswered">คำถามที่ AI ตอบไม่ได้</option>
            <option value="callback">ขอให้ติดต่อกลับ</option>
          </select>
        </Field>
        <Field label="Description">
          <textarea name="description" required maxLength={4000} />
        </Field>
        <div className="form-pair">
          <AssigneePicker />
          <Field label="Due date">
            <input name="dueDate" type="date" />
          </Field>
        </div>
        <Feedback error={error} />
        <Button variant="brand" pending={pending}>
          สร้าง ticket
        </Button>
      </form>
    </Dialog>
  );
}
export function TicketDetail({
  ticket,
  onClose,
  onSave,
  pending,
  error,
  canEdit,
}: {
  ticket: Ticket;
  onClose: () => void;
  onSave: (input: { assigneeIds?: string[]; dueDate?: string; comment?: string }) => void;
  pending: boolean;
  error: Error | null;
  canEdit: boolean;
}) {
  return (
    <Dialog title={ticket.title} onClose={onClose}>
      <Badge>{ticket.type}</Badge>
      <p className="my-4 whitespace-pre-wrap">{ticket.description}</p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          onSave({
            assigneeIds: new FormData(f).getAll('assigneeIds').map(String),
            dueDate: formText(f, 'dueDate'),
            ...(formText(f, 'comment').trim() ? { comment: formText(f, 'comment') } : {}),
          });
        }}
      >
        <div className="form-pair">
          <AssigneePicker selected={ticket.assigneeIds} disabled={!canEdit} />
          <Field label="Due date">
            <input name="dueDate" type="date" defaultValue={ticket.dueDate} disabled={!canEdit} />
          </Field>
        </div>
        <Field label="Comment">
          <textarea name="comment" maxLength={2000} disabled={!canEdit} />
        </Field>
        <Feedback error={error} />
        {canEdit && (
          <Button variant="brand" pending={pending}>
            บันทึกการติดตาม
          </Button>
        )}
      </form>
      <h3 className="mt-6">Conversation</h3>
      {ticket.comments.map((c) => (
        <div key={c.id} className="py-3 border-b border-line">
          <p>{c.text}</p>
          <small className="muted">{c.at}</small>
        </div>
      ))}
      <h3 className="mt-6">Activity</h3>
      <ul className="timeline">
        {ticket.activity.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    </Dialog>
  );
}
