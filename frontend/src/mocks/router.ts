import { z } from 'zod';
import { ApiError, type Request } from '../shared/api/client';
import { memberRoutes } from './members';
import { state } from './state';
import { authorize, findEvent } from './guards';
import { eventRoutes } from './events';
import { ticketRoutes } from './tickets';
import { credentialRoutes, checkPair } from './credentials';
import { callingRoutes } from './calling';
async function delay(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 120);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function mockRequest(path: string, request: Request = {}): Promise<unknown> {
  await delay(request.signal);
  const method = request.method ?? 'GET';
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const body = request.body;
  if (path === '/auth/session') {
    if (!state.session) throw new ApiError(401, 'เข้าสู่ระบบเพื่อเปิด workspace');
    return structuredClone(state.session);
  }
  if (path === '/auth/demo' && __DEMO__ && method === 'POST') {
    state.session = structuredClone(state.profile);
    return state.session;
  }
  if (path === '/auth/login') {
    const login = z.object({ email: z.email(), password: z.string().min(8) }).parse(body);
    if (login.email !== 'admin@otterheaven.com' || login.password !== 'passwordpassword')
      throw new ApiError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    state.session = structuredClone(state.profile);
    return state.session;
  }
  if (path === '/auth/logout') {
    state.session = null;
    return { ok: true };
  }
  if (path === '/auth/reset') {
    z.object({ email: z.email() }).parse(body);
    return { ok: true, message: 'Preview: จำลองคำขอแล้ว ไม่มีการส่งอีเมลจริง' };
  }
  if (path === '/auth/reset/complete') {
    const input = z.object({ token: z.string(), password: z.string().min(8) }).parse(body);
    if (input.token !== 'preview-reset')
      throw new ApiError(422, 'ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่');
    return { ok: true, message: 'Preview: จำลองการตั้งรหัสผ่านแล้ว ไม่มีการเปลี่ยนบัญชีจริง' };
  }
  if (path === '/organizations' || path === '/invitations/accept') {
    if (!state.session) throw new ApiError(401, 'กรุณาเข้าสู่ระบบ');
    if (path === '/organizations') {
      const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(body);
      state.session.organizations.push({ id: crypto.randomUUID(), name, role: 'org_admin', eventIds: [] });
    } else {
      const { token } = z.object({ token: z.string() }).parse(body);
      if (token !== 'preview-invite') throw new ApiError(422, 'คำเชิญหมดอายุหรือไม่ตรงกับบัญชี');
      if (!state.session.organizations.some((org) => org.id === 'invited'))
        state.session.organizations.push({
          id: 'invited',
          name: 'Invited workspace',
          role: 'team_member',
          eventIds: [],
        });
    }
    state.profile = structuredClone(state.session);
    return structuredClone(state.session);
  }
  const org = parts[1];
  authorize(
    org,
    method !== 'GET',
    parts[2] === 'credentials' || (parts[2] === 'members' && method !== 'GET'),
    parts[3],
    parts[4] === 'tickets',
  );
  if (parts[2] === 'members') return memberRoutes(org, parts[3], method, body);
  if (parts[2] === 'credentials')
    return structuredClone(credentialRoutes(org, parts[3], parts[4], method, body));
  if (parts[2] === 'check-pair') return checkPair(org, body);
  if (parts[2] !== 'events') throw new ApiError(404, 'Unknown preview route');
  const eventId = parts[3];
  const tail = parts.slice(4);
  if (eventId) findEvent(org, eventId);
  const key = request.key ? `${org}:${path}:${request.key}` : undefined;
  if (key && state.idempotency.has(key)) return structuredClone(state.idempotency.get(key));
  let result: unknown;
  if (tail[0] === 'tickets') result = ticketRoutes(org, eventId, tail[1], method, body);
  else if (['participants', 'imports', 'queue-state', 'queue-policy', 'runs'].includes(tail[0])) {
    result = callingRoutes(org, eventId, tail, method, body);
  } else result = eventRoutes(org, eventId, tail, method, body);
  if (key) state.idempotency.set(key, structuredClone(result));
  return structuredClone(result);
}
