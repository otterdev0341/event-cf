import { z } from 'zod';
import { memberSchema, roleSchema } from '../shared/contracts/identity';
import { ApiError } from '../shared/api/client';
const members = new Map<string, z.infer<typeof memberSchema>[]>();
export function memberRoutes(org: string, id: string | undefined, method: string, body: unknown) {
  if (!members.has(org))
    members.set(org, [{ id: 'member-1', email: 'admin@otterheaven.com', role: 'owner', status: 'active' }]);
  const rows = members.get(org)!;
  if (method === 'GET') return structuredClone(rows);
  if (id) {
    const member = rows.find((row) => row.id === id);
    if (!member) throw new ApiError(404, 'ไม่พบสมาชิก');
    if (member.role === 'owner') throw new ApiError(409, 'Owner ต้องโอน ownership ก่อน ไม่แก้ผ่านเมนูสมาชิก');
    if (method === 'DELETE')
      members.set(
        org,
        rows.filter((row) => row.id !== id),
      );
    else {
      const role = roleSchema.parse(z.object({ role: z.string() }).parse(body).role);
      if (role === 'owner') throw new ApiError(422, 'ใช้ ownership transfer แยกต่างหาก');
      member.role = role;
    }
    return { ok: true };
  }
  const input = z.object({ email: z.email(), role: roleSchema }).parse(body);
  if (input.role === 'owner') throw new ApiError(422, 'ใช้ ownership transfer แยกต่างหาก');
  if (rows.some((row) => row.email.toLowerCase() === input.email.toLowerCase()))
    throw new ApiError(409, 'สมาชิกหรือคำเชิญนี้มีอยู่แล้ว');
  rows.push({ ...input, id: crypto.randomUUID(), status: 'invited' });
  return { ok: true };
}
