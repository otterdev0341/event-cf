import { z } from 'zod';
import { memberSchema, roleSchema, type Member } from '../shared/contracts/identity';
import { ApiError } from '../shared/api/client';
import { state } from './state';
const members = new Map<string, Member[]>();
export function orgMembers(org: string): Member[] {
  if (!members.has(org)) {
    const membership = state.session?.organizations.find((o) => o.id === org);
    const user = state.session?.user;
    members.set(org, [
      {
        id: user?.id ?? 'admin-preview',
        email: user?.email ?? 'admin@otterheaven.com',
        role: membership?.role ?? 'org_admin',
        eventIds: membership?.eventIds ?? [],
        status: 'active',
      },
      {
        id: `${org}-ops`,
        email: 'operations@example.test',
        role: 'team_member',
        eventIds: state.events.filter((e) => e.orgId === org).map((e) => e.id),
        status: 'active',
      },
      {
        id: `${org}-support`,
        email: 'support@example.test',
        role: 'event_admin',
        eventIds: state.events.filter((e) => e.orgId === org).map((e) => e.id),
        status: 'active',
      },
    ]);
  }
  return members.get(org)!;
}
export function validateAssignees(org: string, ids: string[]) {
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !orgMembers(org).some((m) => m.id === id && m.status === 'active'))
  )
    throw new ApiError(422, 'เลือกผู้รับผิดชอบที่เป็น active member ขององค์กรนี้เท่านั้น');
}
export function memberRoutes(org: string, id: string | undefined, method: string, body: unknown) {
  const rows = orgMembers(org);
  if (method === 'GET') return structuredClone(rows);
  const member = id ? rows.find((row) => row.id === id) : undefined;
  if (id && !member) throw new ApiError(404, 'ไม่พบสมาชิก');
  if (member?.id === state.session?.user.id || member?.role === 'root')
    throw new ApiError(409, 'ไม่เปลี่ยนสิทธิ์หรือลบบัญชีตนเองหรือ Root ผ่านเมนูนี้');
  if (method === 'DELETE' && member) {
    if (
      member.role === 'org_admin' &&
      rows.filter((m) => m.role === 'org_admin' && m.status === 'active').length <= 1
    )
      throw new ApiError(409, 'ต้องมี Org admin อย่างน้อยหนึ่งคน');
    members.set(
      org,
      rows.filter((row) => row.id !== id),
    );
    for (const ticket of state.tickets.filter((t) =>
      state.events.some((e) => e.id === t.eventId && e.orgId === org),
    )) {
      if (ticket.assigneeIds.includes(id!)) {
        ticket.assigneeIds = ticket.assigneeIds.filter((x) => x !== id);
        ticket.version++;
      }
    }
    return { ok: true };
  }
  const input = z
    .object({ email: z.email().optional(), role: roleSchema, eventIds: z.array(z.string()).default([]) })
    .parse(body);
  if (input.role === 'root') throw new ApiError(403, 'Root เป็นสิทธิ์ระดับ platform ไม่สามารถมอบผ่าน org');
  if (input.eventIds.some((id) => !state.events.some((e) => e.id === id && e.orgId === org)))
    throw new ApiError(422, 'Event ต้องอยู่ในองค์กรนี้');
  if (input.role === 'event_admin' && !input.eventIds.length)
    throw new ApiError(422, 'Event admin ต้องระบุ Event');
  if (member) {
    if (
      member.role === 'org_admin' &&
      input.role !== 'org_admin' &&
      rows.filter((m) => m.role === 'org_admin' && m.status === 'active').length <= 1
    )
      throw new ApiError(409, 'ต้องมี Org admin อย่างน้อยหนึ่งคน');
    member.role = input.role;
    member.eventIds = input.role === 'org_admin' ? [] : input.eventIds;
  } else {
    if (!input.email) throw new ApiError(422, 'กรุณาระบุ email');
    if (rows.some((row) => row.email.toLowerCase() === input.email!.toLowerCase()))
      throw new ApiError(409, 'สมาชิกหรือคำเชิญนี้มีอยู่แล้ว');
    rows.push(memberSchema.parse({ ...input, id: crypto.randomUUID(), status: 'invited' }));
  }
  return { ok: true };
}
