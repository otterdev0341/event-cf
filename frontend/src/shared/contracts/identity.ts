import { z } from 'zod';
export const roleSchema = z.enum(['root', 'org_admin', 'event_admin', 'team_member']);
export const orgSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
  eventIds: z.array(z.string()).default([]),
});
export const sessionSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.email(),
    platformRole: z.literal('root').nullable().default(null),
  }),
  organizations: z.array(orgSchema),
});
export const memberSchema = z.object({
  id: z.string(),
  email: z.email(),
  role: roleSchema,
  eventIds: z.array(z.string()).default([]),
  status: z.enum(['active', 'invited']),
});
export type Organization = z.infer<typeof orgSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Member = z.infer<typeof memberSchema>;
