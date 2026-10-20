import { z } from 'zod';
import { api, eventPath } from '../../shared/api/client';
import { ticketSchema, ticketInputSchema, type TicketInput } from '../../shared/contracts/tickets';
export const ticketService = {
  list: (org: string, event: string, signal?: AbortSignal) =>
    api(`${eventPath(org, event)}/tickets`, z.array(ticketSchema), { signal }),
  create: (org: string, event: string, input: TicketInput) =>
    api(`${eventPath(org, event)}/tickets`, ticketSchema, {
      method: 'POST',
      body: ticketInputSchema.parse(input),
      key: crypto.randomUUID(),
    }),
  update: (
    org: string,
    event: string,
    id: string,
    body: {
      expectedVersion: number;
      status?: string;
      assigneeIds?: string[];
      dueDate?: string;
      comment?: string;
    },
  ) => api(`${eventPath(org, event)}/tickets/${id}`, ticketSchema, { method: 'PATCH', body }),
};
