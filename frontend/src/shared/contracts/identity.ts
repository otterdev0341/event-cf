import { z } from 'zod';
export const roleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']);
export const orgSchema = z.object({ id: z.string(), name: z.string(), role: roleSchema });
export const sessionSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.email() }),
  organizations: z.array(orgSchema),
});
export const memberSchema = z.object({
  id: z.string(),
  email: z.email(),
  role: roleSchema,
  status: z.enum(['active', 'invited']),
});
export type Organization = z.infer<typeof orgSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Role = z.infer<typeof roleSchema>;
