import type { Participant, Queue } from '../../shared/contracts/calling';
import { Badge, Button } from '../../components/ui';
export function QueueVisual({
  queue,
  people,
  canEdit,
  onPolicy,
  onParticipant,
}: {
  queue: Queue;
  people: Participant[];
  canEdit: boolean;
  onPolicy: () => void;
  onParticipant: (person: Participant) => void;
}) {
  const lanes = [
    { id: 'new', label: 'New calls' },
    { id: 'fail', label: 'Retry' },
    { id: 'done', label: 'Completed' },
  ] as const;
  return (
    <section className="panel queue-visual mb-6" aria-label="Call queue overview">
      <div className="queue-heading">
        <div>
          <p className="eyebrow">DISPATCH MIX</p>
          <span className="ratio-label">
            {queue.ratio} new calls : {queue.retryRatio} retry
          </span>
        </div>
        <Badge tone={queue.status}>{queue.status}</Badge>
        {canEdit && (
          <Button disabled={queue.status === 'running' || queue.pendingTurn} onClick={onPolicy}>
            ปรับสัดส่วน
          </Button>
        )}
      </div>
      <div
        className="dispatch-strip"
        aria-label={`Example dispatch ${queue.ratio} new calls then ${queue.retryRatio} retries`}
      >
        {Array.from({ length: Math.min(queue.ratio, 12) }, (_, i) => (
          <span key={i} className={`dispatch-cell new ${i < queue.dispatchPosition ? 'consumed' : ''}`}>
            N
          </span>
        ))}
        {queue.ratio > 12 && <span>+{queue.ratio - 12}</span>}
        {Array.from({ length: Math.min(queue.retryRatio, 12) }, (_, i) => (
          <span
            key={i}
            className={`dispatch-cell fail ${queue.dispatchPosition > queue.ratio + i ? 'consumed' : ''}`}
          >
            R
          </span>
        ))}
        {queue.retryRatio > 12 && <span>+{queue.retryRatio - 12}</span>}
        <span className="muted text-xs">
          ตัวอย่างลำดับเมื่อทั้งสองคิวพร้อม · {queue.dispatchPosition}/{queue.ratio + queue.retryRatio}
        </span>
      </div>
      <div className="queue-lanes">
        {lanes.map((lane) => {
          const rows = people.filter((p) => p.lane === lane.id);
          return (
            <div key={lane.id}>
              <h3>
                {lane.label} <span>{rows.length}</span>
              </h3>
              <div className="queue-blocks" aria-label={`${lane.label} participants`}>
                {rows.slice(0, 60).map((person) => (
                  <button
                    key={person.id}
                    className={`queue-block ${lane.id} ${person.state === 'delayed' ? 'delayed' : ''}`}
                    onClick={() => onParticipant(person)}
                    aria-label={`${person.firstName} · ${lane.label} · ${person.state}`}
                    title={`${person.firstName} · ${person.state}`}
                  >
                    {person.firstName.slice(0, 1)}
                  </button>
                ))}
              </div>
              {!rows.length && <p className="muted text-xs">ยังไม่มีรายชื่อ</p>}
              {rows.length > 60 && <small>+{rows.length - 60} รายชื่อในตาราง</small>}
            </div>
          );
        })}
      </div>
      <p className="muted text-xs mt-3">
        N = สายใหม่ · R = โทรซ้ำ · เส้นประ = รอเวลา · สูงสุด {queue.maxAttempts} attempts · retry ทุก{' '}
        {queue.delayMinutes} นาที
      </p>
    </section>
  );
}
