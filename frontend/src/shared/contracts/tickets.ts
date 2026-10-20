import { z } from 'zod';
export const ticketStatus = z.enum(['open', 'in_progress', 'waiting', 'resolved']);
export const ticketInputSchema = z.object({
  title: z.string().trim().min(1).max(180),
  type: z.enum(['unanswered', 'callback']),
  description: z.string().trim().min(1).max(4000),
  assigneeIds: z.array(z.string()).max(50),
  dueDate: z.union([z.iso.date(), z.literal('')]),
});
export const ticketSchema = ticketInputSchema.extend({
  id: z.string(),
  eventId: z.string(),
  status: ticketStatus,
  version: z.number().int(),
  comments: z.array(z.object({ id: z.string(), text: z.string(), at: z.string() })),
  activity: z.array(z.string()),
});
export type Ticket = z.infer<typeof ticketSchema>;
export type TicketInput = z.infer<typeof ticketInputSchema>;
