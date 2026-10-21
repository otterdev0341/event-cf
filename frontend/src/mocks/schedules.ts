import { z } from 'zod';
import { ApiError } from '../shared/api/client';
import { scheduleRuleSchema, type ScheduleDto } from '../shared/contracts/schedules';
import { findEvent } from './guards';
import { state, queueFor } from './state';
const schedules = new Map<string, ScheduleDto[]>();
export function scheduleRoutes(
  org: string,
  eventId: string,
  id: string | undefined,
  method: string,
  body: unknown,
) {
  const event = findEvent(org, eventId);
  const rows = schedules.get(eventId) ?? [];
  if (method === 'GET') return rows;
  if (method === 'PATCH') {
    const input = z.object({ action: z.literal('cancel'), expectedVersion: z.number() }).parse(body);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new ApiError(404, 'ไม่พบตาราง');
    if (row.version !== input.expectedVersion || !['scheduled', 'running', 'failed'].includes(row.status))
      throw new ApiError(409, 'ตารางเปลี่ยนแล้ว กรุณาโหลดใหม่');
    row.status = 'cancelled';
    row.version++;
    return { ok: true };
  }
  const rule = scheduleRuleSchema.parse(body);
  const queue = queueFor(eventId);
  if (
    event.version !== rule.expectedEventVersion ||
    event.status === 'archived' ||
    queue.status === 'running' ||
    queue.pendingTurn ||
    rows.some((r) => ['scheduled', 'running'].includes(r.status))
  )
    throw new ApiError(409, 'พักคิวและยกเลิกตารางเดิมก่อนสร้างใหม่');
  const people = state.participants[eventId] ?? [];
  if (rule.participantIds.some((id) => !people.some((p) => p.id === id)))
    throw new ApiError(404, 'ไม่พบผู้รับ');
  let next = new Date(`${rule.date}T${rule.time}:00+07:00`);
  const now = Date.now();
  if (rule.recurrence !== 'once') {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    next = new Date(`${rule.date > today ? rule.date : today}T${rule.time}:00+07:00`);
    for (let n = 0; n <= 7; n++) {
      const day = new Date(next.getTime() + 7 * 3600000).getUTCDay();
      if (next.getTime() > now && (rule.recurrence === 'daily' || rule.weekdays.includes(day))) break;
      next = new Date(next.getTime() + 86400000);
    }
  }
  if (!Number.isFinite(next.getTime()) || next.getTime() <= now) throw new ApiError(422, 'กำหนดเวลาในอนาคต');
  const row: ScheduleDto = {
    id: crypto.randomUUID(),
    rule,
    nextAt: next.toISOString(),
    status: 'scheduled',
    version: 1,
    completedRuns: 0,
  };
  schedules.set(eventId, [...rows, row]);
  return row;
}
