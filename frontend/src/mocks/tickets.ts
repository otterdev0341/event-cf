import { z } from 'zod';
import { ticketInputSchema, ticketStatus } from '../shared/contracts/tickets';
import { ApiError } from '../shared/api/client';
import { state } from './state';
import { version } from './guards';
export function ticketRoutes(eventId: string, id: string | undefined, method: string, body: unknown) {
  if (method === 'GET') return state.tickets.filter((t) => t.eventId === eventId);
  if (!id) {
    const input = ticketInputSchema.parse(body);
    const ticket = {
      ...input,
      id: crypto.randomUUID(),
      eventId,
      status: 'open' as const,
      version: 1,
      comments: [],
      activity: ['สร้าง ticket โดยเจ้าหน้าที่'],
    };
    state.tickets.push(ticket);
    return ticket;
  }
  const ticket = state.tickets.find((t) => t.id === id && t.eventId === eventId);
  if (!ticket) throw new ApiError(404, 'ไม่พบ ticket');
  const input = z
    .object({
      expectedVersion: z.number(),
      status: ticketStatus.optional(),
      assignee: z.string().optional(),
      dueDate: z.union([z.iso.date(), z.literal('')]).optional(),
      comment: z.string().trim().min(1).max(2000).optional(),
    })
    .parse(body);
  version(ticket.version, input.expectedVersion);
  if (input.status) {
    ticket.status = input.status;
    ticket.activity.push(`เปลี่ยนสถานะเป็น ${input.status}`);
  }
  if (input.assignee !== undefined) ticket.assignee = input.assignee;
  if (input.dueDate !== undefined) ticket.dueDate = input.dueDate;
  if (input.comment)
    ticket.comments.push({ id: crypto.randomUUID(), text: input.comment, at: new Date().toISOString() });
  ticket.version++;
  return ticket;
}
