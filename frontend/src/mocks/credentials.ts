import { z } from 'zod';
import { credentialInputSchema } from '../shared/contracts/credentials';
import { ApiError } from '../shared/api/client';
import { state } from './state';
import { findEvent } from './guards';
const owners = new Map<string, string>();
export function credentialRoutes(
  org: string,
  id: string | undefined,
  action: string | undefined,
  method: string,
  body: unknown,
) {
  if (method === 'GET') return state.credentials.filter((c) => owners.get(c.id) === org);
  if (id) {
    const current = state.credentials.find((c) => c.id === id && owners.get(c.id) === org);
    if (!current) throw new ApiError(404, 'ไม่พบ credential');
    if (action !== 'rotate') {
      current.status = 'revoked';
      for (const child of state.credentials.filter((c) => c.parentId === id)) child.status = 'revoked';
      return { ok: true };
    }
    if (current.status !== 'active') throw new ApiError(409, 'Key ถูก revoke แล้ว');
    body = { ...current, expiresAt: current.expiresAt };
  }
  const input = credentialInputSchema.parse(body);
  if (input.expiresAt <= new Date().toISOString().slice(0, 10))
    throw new ApiError(422, 'วันหมดอายุต้องอยู่ในอนาคต');
  if (input.kind === 'event') {
    findEvent(org, input.eventId ?? '');
    const parent = state.credentials.find(
      (c) => c.id === input.parentId && owners.get(c.id) === org && c.kind === 'org' && c.status === 'active',
    );
    if (
      !parent ||
      parent.expiresAt < input.expiresAt ||
      !input.scopes.every((s) => parent.scopes.includes(s))
    ) {
      throw new ApiError(422, 'Org credential ไม่ตรงกัน หมดอายุก่อน หรือไม่มี scope ที่เลือก');
    }
  } else if (input.eventId || input.parentId) throw new ApiError(422, 'Org credential ห้ามผูก Event/parent');
  const credential = {
    ...input,
    id: crypto.randomUUID(),
    prefix: 'demo_only_••••',
    status: 'active' as const,
  };
  if (id) {
    for (const old of state.credentials.filter((c) => c.id === id || c.parentId === id))
      old.status = 'revoked';
  }
  state.credentials.push(credential);
  owners.set(credential.id, org);
  return { credential, secret: `demo_only_not_a_real_key_${crypto.randomUUID()}` };
}
export function checkPair(org: string, body: unknown) {
  const pair = z.object({ orgKeyId: z.string(), eventKeyId: z.string(), eventId: z.string() }).parse(body);
  const parent = state.credentials.find((c) => c.id === pair.orgKeyId && owners.get(c.id) === org);
  const child = state.credentials.find((c) => c.id === pair.eventKeyId && owners.get(c.id) === org);
  if (
    !parent ||
    !child ||
    parent.status !== 'active' ||
    child.status !== 'active' ||
    parent.kind !== 'org' ||
    child.parentId !== parent.id ||
    child.eventId !== pair.eventId ||
    parent.expiresAt < new Date().toISOString().slice(0, 10) ||
    child.expiresAt < new Date().toISOString().slice(0, 10)
  ) {
    throw new ApiError(403, 'Credential pair ไม่ตรงกับองค์กร/Event หรือถูก revoke แล้ว');
  }
  return { ok: true, message: 'Credential pair ตรงกัน (preview validation)' };
}
