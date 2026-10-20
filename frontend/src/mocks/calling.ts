import { z } from 'zod';
import { importRowSchema } from '../shared/contracts/calling';
import { normalizePhone, validateRows } from '../shared/contracts/import-validation';
import { ApiError } from '../shared/api/client';
import { findEvent, version } from './guards';
import { queueFor, state } from './state';
export function callingRoutes(org: string, eventId: string, tail: string[], method: string, body: unknown) {
  const event = findEvent(org, eventId);
  const participants = (state.participants[eventId] ??= []);
  const queue = queueFor(eventId);
  if (tail[0] === 'participants') return participants;
  if (tail[0] === 'imports') {
    if (tail[2] === 'commit') {
      const preview = state.imports[tail[1]];
      if (!preview || preview.eventId !== eventId) throw new ApiError(404, 'ไม่พบ preview');
      if (!preview.committed) {
        const errors = validateRows(
          preview.rows,
          event,
          participants.map((p) => p.phone),
        );
        if (errors.length) throw new ApiError(422, errors[0]);
        for (const row of preview.rows)
          participants.push({
            id: crypto.randomUUID(),
            phone: normalizePhone(row.phone),
            firstName: row.first_name,
            lastName: row.last_name,
            nickname: row.nickname,
            lane: 'new',
            state: 'ready',
            outcome: { result: null, reason: null },
            noAnswerCount: 0,
            attempts: [],
          });
        preview.committed = true;
        event.participantCount = participants.length;
      }
      return { ok: true };
    }
    const { rows } = z.object({ rows: z.array(importRowSchema) }).parse(body);
    const preview = {
      rows,
      eventId,
      errors: validateRows(
        rows,
        event,
        participants.map((p) => p.phone),
      ),
      committed: false,
    };
    const id = crypto.randomUUID();
    state.imports[id] = preview;
    return { ...preview, id };
  }
  if (method === 'GET') return queue;
  if (tail[0] === 'queue-policy') {
    const input = z
      .object({ ratio: z.number().int().min(1).max(100), expectedVersion: z.number() })
      .parse(body);
    version(queue.version, input.expectedVersion);
    if (queue.status === 'running' || queue.pendingTurn)
      throw new ApiError(409, 'หยุดคิวและรอ pending turn ก่อนเปลี่ยนอัตรา');
    queue.ratio = input.ratio;
    queue.newSinceFail = 0;
    queue.version++;
  } else {
    const { action } = z.object({ action: z.enum(['start', 'pause', 'resume', 'cancel']) }).parse(body);
    if (
      action === 'start' &&
      (queue.status !== 'idle' || !participants.length || event.status === 'archived')
    ) {
      throw new ApiError(409, 'เริ่มคิวไม่ได้: ตรวจสถานะ Event และรายชื่อ');
    }
    if (action === 'pause' && queue.status !== 'running') throw new ApiError(409, 'คิวไม่ได้กำลังทำงาน');
    if (action === 'resume' && queue.status !== 'paused') throw new ApiError(409, 'คิวไม่ได้หยุดพัก');
    queue.status = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'running';
    queue.version++;
  }
  return queue;
}
