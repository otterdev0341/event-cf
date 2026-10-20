import { useState } from 'react';
import { Play, Pause, SlidersHorizontal } from 'lucide-react';
import { useEvent } from '../events';
import { participantService } from '../participants';
import { useWorkspace } from '../../stores/workspace';
import { useEventQuery } from '../../shared/api/useEventQuery';
import { useAction } from '../../shared/api/query';
import { usePermissions } from '../../shared/api/usePermissions';
import { callingService } from './service';
import type { Participant } from '../../shared/contracts/calling';
import { Dialog } from '../../components/Dialog';
import { Badge, Button, Empty, Feedback, Field, formText, PageHeader, QueryState } from '../../components/ui';
const reasons = { no_answer: 'ไม่รับสาย', noisy_audio: 'เสียงรบกวน', ai_cannot_infer: 'AI สรุปไม่ได้' };
export function CallingPage() {
  const { event } = useEvent();
  const { orgId, eventId } = useWorkspace();
  const { canEdit } = usePermissions();
  const query = useEventQuery('queue', callingService.get);
  const people = useEventQuery('participants', participantService.list);
  const [lane, setLane] = useState('new');
  const [policyOpen, setPolicyOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [detail, setDetail] = useState<Participant | null>(null);
  const queue = query.data;
  const keys = ['org', orgId, eventId];
  const run = useAction(async (action: string) => {
    await callingService.run(orgId, eventId, action, crypto.randomUUID());
    setStartOpen(false);
  }, keys);
  const policy = useAction(async (ratio: number) => {
    await callingService.policy(orgId, eventId, ratio, queue!.version);
    setPolicyOpen(false);
  }, keys);
  if (!event) return <Empty title="เลือก Event เพื่อจัดการคิวโทร" />;
  const rows = people.data?.filter((p) => p.lane === lane) ?? [];
  return (
    <>
      <PageHeader
        eyebrow={`${event.code} / CONVERSATIONS`}
        title="One call. One connection."
        description="คิวใหม่และคิวโทรซ้ำ จัดลำดับตามสัดส่วนที่ทีมกำหนด"
        action={
          canEdit &&
          queue && (
            <div className="flex gap-2">
              {queue.status === 'idle' && (
                <Button
                  variant="brand"
                  disabled={!people.data?.length || event.status === 'archived'}
                  onClick={() => setStartOpen(true)}
                >
                  <Play size={15} />
                  เริ่มคิวโทร
                </Button>
              )}
              {queue.status === 'running' && (
                <Button pending={run.isPending} onClick={() => run.mutate('pause')}>
                  <Pause size={15} />
                  Pause queue
                </Button>
              )}
              {queue.status === 'paused' && (
                <Button pending={run.isPending} onClick={() => run.mutate('resume')}>
                  <Play size={15} />
                  Resume
                </Button>
              )}
              {['running', 'paused'].includes(queue.status) && (
                <Button
                  variant="danger"
                  onClick={() => {
                    if (window.confirm('ยกเลิกคิวที่ยังไม่เริ่ม? สาย in-flight จะไม่ถูกยกเลิกทันที'))
                      run.mutate('cancel');
                  }}
                >
                  Cancel queue
                </Button>
              )}
            </div>
          )
        }
      />
      <Feedback error={run.error} notice={run.notice || policy.notice} />
      <QueryState
        pending={query.isPending || people.isPending}
        error={query.error || people.error}
        retry={() => {
          void query.refetch();
          void people.refetch();
        }}
      />
      {queue && (
        <div className="panel panel-heading mb-6">
          <div>
            <p className="eyebrow">WEIGHTED DISPATCH</p>
            <h2 className="mt-2">{queue.ratio} new calls : 1 retry</h2>
            <p className="muted text-xs mt-2">
              {Array(Math.min(queue.ratio, 5)).fill('NEW').join(' → ')}
              {queue.ratio > 5 ? ' → …' : ''} → FAIL · ตัวอย่างลำดับ เมื่อทั้งสองคิวพร้อม
            </p>
            <p className="muted text-xs">
              Progress {queue.newSinceFail}/{queue.ratio} · สูงสุด {queue.maxAttempts} attempts · เว้น{' '}
              {queue.delayMinutes} นาที
            </p>
          </div>
          <div className="flex gap-3 items-center">
            <Badge tone={queue.status}>{queue.status}</Badge>
            {canEdit && (
              <Button
                disabled={queue.status === 'running' || queue.pendingTurn}
                onClick={() => setPolicyOpen(true)}
              >
                <SlidersHorizontal size={15} />
                ปรับสัดส่วน
              </Button>
            )}
          </div>
        </div>
      )}
      {__MOCK__ && (
        <p className="notice">
          Preview จำลอง start/pause/cancel เท่านั้น ไม่มี worker ส่งสายจริงใน Phase นี้
        </p>
      )}
      <div className="tabs" role="tablist">
        {['new', 'fail', 'done'].map((value) => (
          <button key={value} role="tab" aria-selected={lane === value} onClick={() => setLane(value)}>
            {value === 'new' ? 'New queue' : value === 'fail' ? 'Fail / retry queue' : 'Completed'} (
            {people.data?.filter((p) => p.lane === value).length ?? 0})
          </button>
        ))}
      </div>
      <p className="eyebrow mb-4">
        {rows.filter((p) => p.state === 'ready').length} READY ·{' '}
        {rows.filter((p) => p.state === 'delayed').length} DELAYED
      </p>
      <div className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Participant</th>
              <th>Result / reason</th>
              <th>Attempts</th>
              <th>State</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.firstName} {p.lastName}
                  <p className="font-mono text-xs muted">{p.phone}</p>
                </td>
                <td>
                  <Badge tone={p.outcome.result ?? ''}>{p.outcome.result ?? 'pending'}</Badge>
                  {p.outcome.result === 'unknown' && (
                    <p className="muted text-xs mt-1">
                      {reasons[p.outcome.reason]}
                      {p.outcome.reason === 'no_answer' ? ` (${p.noAnswerCount} ครั้ง)` : ''}
                    </p>
                  )}
                </td>
                <td>
                  {p.attempts.length} / {queue?.maxAttempts}
                </td>
                <td>{p.state}</td>
                <td>
                  <Button variant="ghost" onClick={() => setDetail(p)}>
                    ประวัติ
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty title="ไม่มีรายชื่อในคิวนี้" />}
      </div>
      {startOpen && (
        <Dialog title="ยืนยันเริ่มคิวโทร" onClose={() => setStartOpen(false)}>
          <p>
            {event.name} · {people.data?.filter((p) => p.lane === 'new').length} รายชื่อใหม่
          </p>
          <p className="muted mt-3">
            สัดส่วน {queue?.ratio}:1 · สูงสุด {queue?.maxAttempts} attempts รวมสายแรก · retry{' '}
            {queue?.delayMinutes} นาที
          </p>
          <Feedback error={run.error} />
          <div className="form-actions">
            <Button variant="brand" pending={run.isPending} onClick={() => run.mutate('start')}>
              ยืนยันเริ่มโทร
            </Button>
          </div>
        </Dialog>
      )}
      {policyOpen && (
        <Dialog title="ปรับสัดส่วน NEW : FAIL" onClose={() => setPolicyOpen(false)}>
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              policy.mutate(Number(formText(e.currentTarget, 'ratio')));
            }}
          >
            <Field
              label="โทร NEW กี่ครั้ง ก่อน FAIL 1 ครั้ง"
              hint="เช่น 2:1 หรือ 5:1 · บันทึกแล้ว reset progress เป็น 0"
            >
              <input name="ratio" type="number" min={1} max={100} required defaultValue={queue?.ratio} />
            </Field>
            <Feedback error={policy.error} />
            <Button variant="brand" pending={policy.isPending}>
              ยืนยันเปลี่ยนสัดส่วน
            </Button>
          </form>
        </Dialog>
      )}
      {detail && (
        <Dialog title={`ประวัติการโทร · ${detail.firstName}`} onClose={() => setDetail(null)}>
          <div className="timeline">
            {detail.attempts.map((a) => (
              <div key={a.number}>
                <p className="eyebrow">
                  ATTEMPT {a.number} · {a.at}
                </p>
                <p>
                  {a.transport} → {a.outcome.result}
                  {a.outcome.result === 'unknown' ? ` · ${reasons[a.outcome.reason]}` : ''}
                </p>
              </div>
            ))}
            {!detail.attempts.length && <p>ยังไม่มีการโทร</p>}
          </div>
        </Dialog>
      )}
    </>
  );
}
