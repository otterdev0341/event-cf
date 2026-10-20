import { z } from 'zod';
export const eventInputSchema = z.object({
  name: z.string().trim().min(1).max(150),
  code: z.string().regex(/^[A-Z0-9_-]{2,40}$/),
  date: z.iso.date(),
  location: z.string().trim().min(1).max(250),
  description: z.string().max(4000),
});
export const eventSchema = eventInputSchema.extend({
  id: z.string(),
  orgId: z.string(),
  status: z.enum(['draft', 'published', 'archived']),
  version: z.number().int(),
  participantCount: z.number().int(),
});
export const faqInputSchema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(5000),
  category: z.string().trim().min(1).max(80),
});
export const faqSchema = faqInputSchema.extend({ id: z.string(), version: z.number() });
export const knowledgeSchema = z.object({
  draft: z.array(faqSchema),
  published: z.array(faqSchema),
  categories: z.array(z.string()),
});
export type EventDto = z.infer<typeof eventSchema>;
export type EventInput = z.infer<typeof eventInputSchema>;
export type Faq = z.infer<typeof faqSchema>;

export const eventPatchSchema = z.union([
  eventInputSchema.extend({ expectedVersion: z.number().int() }),
  z.object({ expectedVersion: z.number().int(), status: z.enum(['draft', 'published', 'archived']) }),
]);
export const faqUpdateSchema = faqInputSchema.extend({ expectedVersion: z.number().int() });
