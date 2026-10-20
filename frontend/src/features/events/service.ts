import { z } from 'zod';
import { api, eventPath } from '../../shared/api/client';
import { eventSchema, eventInputSchema, type EventInput } from '../../shared/contracts/events';
export const eventService = {
  list: (org: string, signal?: AbortSignal) => api(`/orgs/${org}/events`, z.array(eventSchema), { signal }),
  create: (org: string, body: EventInput) =>
    api(`/orgs/${org}/events`, eventSchema, { method: 'POST', body: eventInputSchema.parse(body) }),
  update: (org: string, id: string, body: EventInput, expectedVersion: number) =>
    api(eventPath(org, id), eventSchema, {
      method: 'PATCH',
      body: { ...eventInputSchema.parse(body), expectedVersion },
    }),
  status: (org: string, id: string, status: string, expectedVersion: number) =>
    api(eventPath(org, id), eventSchema, { method: 'PATCH', body: { status, expectedVersion } }),
};
