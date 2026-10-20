import { z } from 'zod';
export const scopes = [
  'knowledge:read',
  'tickets:create',
  'calls:read',
  'calls:create',
  'calls:result',
] as const;
export const scopeSchema = z.enum(scopes);
export const credentialSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['org', 'event']),
  eventId: z.string().nullable(),
  parentId: z.string().nullable(),
  prefix: z.string(),
  scopes: z.array(scopeSchema),
  expiresAt: z.string(),
  status: z.enum(['active', 'revoked']),
});
export const credentialInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  kind: z.enum(['org', 'event']),
  eventId: z.string().nullable(),
  parentId: z.string().nullable(),
  scopes: z.array(scopeSchema).min(1),
  expiresAt: z.iso.date(),
});
export const issuedSchema = z.object({ credential: credentialSchema, secret: z.string() });
export type Credential = z.infer<typeof credentialSchema>;
