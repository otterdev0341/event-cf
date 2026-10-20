import { z } from 'zod';
import { eventInputSchema, faqInputSchema } from '../shared/contracts/events';
import { ApiError } from '../shared/api/client';
import { state } from './state';
import { findEvent, version } from './guards';
export function eventRoutes(
  org: string,
  eventId: string | undefined,
  tail: string[],
  method: string,
  body: unknown,
) {
  if (!eventId) {
    if (method === 'GET') return state.events.filter((e) => e.orgId === org);
    const input = eventInputSchema.parse(body);
    if (state.events.some((e) => e.orgId === org && e.code === input.code))
      throw new ApiError(409, 'รหัส Event ซ้ำ');
    const event = {
      ...input,
      id: crypto.randomUUID(),
      orgId: org,
      status: 'draft' as const,
      version: 1,
      participantCount: 0,
    };
    state.events.push(event);
    return event;
  }
  const event = findEvent(org, eventId);
  if (!tail.length) {
    if (method === 'GET') return event;
    const data = z
      .object({ expectedVersion: z.number(), status: z.enum(['draft', 'published', 'archived']).optional() })
      .passthrough()
      .parse(body);
    version(event.version, data.expectedVersion);
    if (data.status) event.status = data.status;
    else {
      const input = eventInputSchema.parse(body);
      if (state.events.some((e) => e.orgId === org && e.id !== eventId && e.code === input.code))
        throw new ApiError(409, 'รหัส Event ซ้ำ');
      Object.assign(event, input);
    }
    event.version++;
    return event;
  }
  const knowledge = (state.knowledge[eventId] ??= { draft: [], published: [], categories: ['ทั่วไป'] });
  if (tail[0] === 'knowledge') return knowledge;
  if (tail[0] === 'publish') {
    if (event.status === 'archived') throw new ApiError(409, 'Event archived แล้ว');
    knowledge.published = structuredClone(knowledge.draft);
    return { ok: true };
  }
  if (tail[0] === 'categories') {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(body);
    if (!knowledge.categories.includes(name)) knowledge.categories.push(name);
    return { ok: true };
  }
  if (tail[0] === 'faqs') {
    const existing = knowledge.draft.find((f) => f.id === tail[1]);
    if (method === 'DELETE') {
      knowledge.draft = knowledge.draft.filter((f) => f.id !== tail[1]);
      return { ok: true };
    }
    const input = faqInputSchema.parse(body);
    if (existing) {
      version(existing.version, z.object({ expectedVersion: z.number() }).parse(body).expectedVersion);
      Object.assign(existing, input, { version: existing.version + 1 });
    } else knowledge.draft.push({ ...input, id: crypto.randomUUID(), version: 1 });
    if (!knowledge.categories.includes(input.category)) knowledge.categories.push(input.category);
    return { ok: true };
  }
  throw new ApiError(404, 'Unknown preview endpoint');
}
