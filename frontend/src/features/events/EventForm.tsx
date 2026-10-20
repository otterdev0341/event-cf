import type { EventDto, EventInput } from '../../shared/contracts/events';
import { Dialog } from '../../components/Dialog';
import { Button, Field, Feedback, formText } from '../../components/ui';
export function EventForm({
  event,
  onSave,
  onClose,
  pending,
  error,
}: {
  event?: EventDto;
  onSave: (input: EventInput) => void;
  onClose: () => void;
  pending: boolean;
  error: Error | null;
}) {
  return (
    <Dialog title={event ? 'แก้ไข Event' : 'Create an event'} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          onSave({
            name: formText(f, 'name'),
            code: formText(f, 'code'),
            date: formText(f, 'date'),
            location: formText(f, 'location'),
            description: formText(f, 'description'),
          });
        }}
      >
        <Field label="Event name">
          <input name="name" required maxLength={150} defaultValue={event?.name} autoFocus />
        </Field>
        <div className="form-pair">
          <Field label="Event code" hint="A–Z, 0–9, underscore หรือ hyphen">
            <input name="code" required pattern="[A-Z0-9_\-]{2,40}" defaultValue={event?.code} />
          </Field>
          <Field label="Event date">
            <input name="date" type="date" required defaultValue={event?.date} />
          </Field>
        </div>
        <Field label="Location">
          <input name="location" required maxLength={250} defaultValue={event?.location} />
        </Field>
        <Field label="Description">
          <textarea name="description" maxLength={4000} defaultValue={event?.description} />
        </Field>
        <Feedback error={error} />
        <div className="form-actions">
          <Button type="submit" variant="brand" pending={pending}>
            บันทึก Event
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
