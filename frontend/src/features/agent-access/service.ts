import { z } from 'zod';
import { api, okSchema } from '../../shared/api/client';
import { credentialSchema, credentialInputSchema, issuedSchema } from '../../shared/contracts/credentials';
export const credentialService = {
  list: (org: string, signal?: AbortSignal) =>
    api(`/orgs/${org}/credentials`, z.array(credentialSchema), { signal }),
  create: (org: string, body: z.infer<typeof credentialInputSchema>) =>
    api(`/orgs/${org}/credentials`, issuedSchema, {
      method: 'POST',
      body: credentialInputSchema.parse(body),
    }),
  revoke: (org: string, id: string) =>
    api(`/orgs/${org}/credentials/${id}/revoke`, okSchema, { method: 'POST' }),
  rotate: (org: string, id: string) =>
    api(`/orgs/${org}/credentials/${id}/rotate`, issuedSchema, { method: 'POST' }),
  check: (org: string, orgKeyId: string, eventKeyId: string, eventId: string) =>
    api(`/orgs/${org}/check-pair`, okSchema, { method: 'POST', body: { orgKeyId, eventKeyId, eventId } }),
};
