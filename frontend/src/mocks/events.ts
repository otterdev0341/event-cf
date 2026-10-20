import { z } from 'zod';
import { eventInputSchema, faqInputSchema, knowledgeImportSchema } from '../shared/contracts/events';
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
  const knowledge = (state.knowledge[eventId] ??= {
    draft: [],
    published: [],
    categories: ['ทั่วไป'],
    categoryRevision: 1,
  });
  if (tail[0] === 'knowledge') return knowledge;
  if (tail[0] === 'publish') {
    if (event.status === 'archived') throw new ApiError(409, 'Event archived แล้ว');
    knowledge.published = structuredClone(knowledge.draft);
    return { ok: true };
  }
  if (tail[0] === 'categories') {
    if (method === 'GET') return knowledge.categories;
    const input = z
      .object({ name: z.string().trim().min(1).max(80).optional(), expectedRevision: z.number().int() })
      .parse(body);
    version(knowledge.categoryRevision, input.expectedRevision);
    const current = tail[1];
    if (current && !knowledge.categories.includes(current)) throw new ApiError(404, 'ไม่พบหมวดหมู่');
    if (method === 'DELETE') {
      if ([...knowledge.draft, ...knowledge.published].some((f) => f.category === current))
        throw new ApiError(409, 'หมวดหมู่นี้มี FAQ ใช้งานอยู่');
      knowledge.categories = knowledge.categories.filter((c) => c !== current);
    } else {
      if (!input.name) throw new ApiError(422, 'กรุณาระบุชื่อหมวดหมู่');
      if (knowledge.categories.some((c) => c.toLowerCase() === input.name!.toLowerCase() && c !== current))
        throw new ApiError(409, 'ชื่อหมวดหมู่ซ้ำ');
      if (current) {
        knowledge.categories = knowledge.categories.map((c) => (c === current ? input.name! : c));
        knowledge.draft.forEach((f) => {
          if (f.category === current) {
            f.category = input.name!;
            f.version++;
            f.updatedAt = new Date().toISOString();
          }
        });
      } else knowledge.categories.push(input.name);
    }
    knowledge.categoryRevision++;
    return { ok: true };
  }
  if (tail[0] === 'knowledge-import') {
    const input = knowledgeImportSchema.parse(body);
    if (input.eventCode !== event.code) throw new ApiError(422, 'รหัส Event ไม่ตรง');
    version(knowledge.categoryRevision, input.categoryRevision);
    const questions = new Set(knowledge.draft.map((f) => f.question.toLowerCase()));
    for (const row of input.rows) {
      if (!knowledge.categories.includes(row.category))
        throw new ApiError(422, 'Category ไม่อยู่ใน master ปัจจุบัน');
      if (questions.has(row.question.toLowerCase())) throw new ApiError(422, 'คำถามซ้ำในไฟล์หรือ draft');
      questions.add(row.question.toLowerCase());
    }
    knowledge.draft.push(
      ...input.rows.map((row) => ({
        ...row,
        id: crypto.randomUUID(),
        version: 1,
        updatedAt: new Date().toISOString(),
      })),
    );
    return { ok: true };
  }
  if (tail[0] === 'faqs') {
    const existing = knowledge.draft.find((f) => f.id === tail[1]);
    if (method === 'DELETE') {
      knowledge.draft = knowledge.draft.filter((f) => f.id !== tail[1]);
      return { ok: true };
    }
    const input = faqInputSchema.parse(body);
    if (!knowledge.categories.includes(input.category))
      throw new ApiError(422, 'เลือกหมวดหมู่จาก master ของ Event นี้');
    if (existing) {
      version(existing.version, z.object({ expectedVersion: z.number() }).parse(body).expectedVersion);
      Object.assign(existing, input, { version: existing.version + 1, updatedAt: new Date().toISOString() });
    } else
      knowledge.draft.push({
        ...input,
        id: crypto.randomUUID(),
        version: 1,
        updatedAt: new Date().toISOString(),
      });

    return { ok: true };
  }
  throw new ApiError(404, 'Unknown preview endpoint');
}
