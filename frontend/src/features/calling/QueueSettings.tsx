import { useEvent } from '../events';
import { useWorkspace } from '../../stores/workspace';
import { usePermissions } from '../../shared/api/usePermissions';
import { useEventQuery } from '../../shared/api/useEventQuery';
import { useAction } from '../../shared/api/query';
import { Button, Empty, Feedback, Field, QueryState, formText } from '../../components/ui';
import { callingService } from './service';

export function QueueSettings({ onSaved }: { onSaved?: () => void }) {
  const { event } = useEvent();
  const { orgId, eventId } = useWorkspace();
  const { canEdit } = usePermissions();
  const query = useEventQuery('queue', callingService.get);
  const save = useAction(
    async (input: { ratio: number; retryRatio: number; maxRetries: number }) => {
      await callingService.policy(
        orgId,
        eventId,
        input.ratio,
        query.data!.version,
        input.maxRetries,
        input.retryRatio,
      );
      onSaved?.();
    },
    ['org', orgId, eventId],
  );
  if (!event) return <Empty title="เลือก Event เพื่อตั้งค่าการโทร" />;
  const queue = query.data;
  const locked = !canEdit || queue?.status === 'running' || queue?.pendingTurn || save.isPending;
  return (
    <section aria-label="Event calling settings">
      <h2>Calling policy · {event.name}</h2>
      <p className="muted mb-4">การตั้งค่านี้ใช้กับ Event {event.code} เท่านั้น</p>
      <QueryState pending={query.isPending} error={query.error} retry={query.refetch} />
      {queue && (
        <form
          key={orgId + eventId + queue.version}
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              ratio: Number(formText(e.currentTarget, 'ratio')),
              retryRatio: Number(formText(e.currentTarget, 'retryRatio')),
              maxRetries: Number(formText(e.currentTarget, 'maxRetries')),
            });
          }}
        >
          <Field label="สายใหม่ต่อรอบ" hint="เช่น 5 สายใหม่ : 2 สายโทรซ้ำ เมื่อทั้งสองคิวพร้อม">
            <input
              name="ratio"
              type="number"
              min={1}
              max={100}
              step={1}
              required
              defaultValue={queue.ratio}
              disabled={locked}
            />
          </Field>
          <Field label="สายโทรซ้ำต่อรอบ">
            <input
              name="retryRatio"
              type="number"
              min={1}
              max={100}
              step={1}
              required
              defaultValue={queue.retryRatio}
              disabled={locked}
            />
          </Field>
          <Field label="Maximum retries" hint="โทรซ้ำได้อีก n ครั้งหลังสายแรก · 0 = ไม่โทรซ้ำ">
            <input
              name="maxRetries"
              type="number"
              min={0}
              max={10}
              step={1}
              required
              defaultValue={queue.maxAttempts - 1}
              disabled={locked}
            />
          </Field>
          <p className="muted">
            เมื่อครบจำนวนจะหยุดโทรและเก็บประวัติไว้ การเพิ่มเพดานจะไม่เปิดเบอร์ที่หยุดแล้วอัตโนมัติ
          </p>
          {(queue.status === 'running' || queue.pendingTurn) && (
            <p className="notice">Pause คิวและรอให้ pending turn จบก่อนแก้ไข</p>
          )}
          <Feedback error={save.error} notice={save.notice} />
          {canEdit && (
            <Button type="submit" variant="brand" pending={save.isPending} disabled={locked}>
              ยืนยันเปลี่ยนสัดส่วน
            </Button>
          )}
        </form>
      )}
    </section>
  );
}
