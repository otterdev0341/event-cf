import { z } from 'zod';
import { api, okSchema } from '../../shared/api/client';
import { sessionSchema, memberSchema, type Role } from '../../shared/contracts/identity';
export const memberService = {
  change: (org: string, id: string, role: Role) =>
    api(`/orgs/${org}/members/${id}`, okSchema, { method: 'PATCH', body: { role } }),
  remove: (org: string, id: string) => api(`/orgs/${org}/members/${id}`, okSchema, { method: 'DELETE' }),
  list: (org: string, signal: AbortSignal) => api(`/orgs/${org}/members`, z.array(memberSchema), { signal }),
  invite: (org: string, body: { email: string; role: Role }) =>
    api(`/orgs/${org}/members`, okSchema, { method: 'POST', body }),
};

export const organizationService = {
  create: (name: string) => api('/organizations', sessionSchema, { method: 'POST', body: { name } }),
  accept: (token: string) => api('/invitations/accept', sessionSchema, { method: 'POST', body: { token } }),
};
