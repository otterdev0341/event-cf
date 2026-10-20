import { z } from 'zod';
import { api, eventPath, okSchema } from '../../shared/api/client';
import { knowledgeSchema, faqInputSchema, knowledgeImportSchema } from '../../shared/contracts/events';
export const knowledgeService = {
  get: (org: string, event: string, signal?: AbortSignal) =>
    api(`${eventPath(org, event)}/knowledge`, knowledgeSchema, { signal }),
  save: (org: string, event: string, input: z.infer<typeof faqInputSchema>, id?: string, version?: number) =>
    api(`${eventPath(org, event)}/faqs${id ? `/${id}` : ''}`, okSchema, {
      method: id ? 'PATCH' : 'POST',
      body: { ...faqInputSchema.parse(input), expectedVersion: version },
    }),
  remove: (org: string, event: string, id: string) =>
    api(`${eventPath(org, event)}/faqs/${id}`, okSchema, { method: 'DELETE' }),
  publish: (org: string, event: string) =>
    api(`${eventPath(org, event)}/publish`, okSchema, { method: 'POST' }),
  category: (org: string, event: string, name: string, expectedRevision: number, previous?: string) =>
    api(
      `${eventPath(org, event)}/categories${previous ? `/${encodeURIComponent(previous)}` : ''}`,
      okSchema,
      { method: previous ? 'PATCH' : 'POST', body: { name, expectedRevision } },
    ),
  removeCategory: (org: string, event: string, name: string, expectedRevision: number) =>
    api(`${eventPath(org, event)}/categories/${encodeURIComponent(name)}`, okSchema, {
      method: 'DELETE',
      body: { expectedRevision },
    }),
  importFaqs: (org: string, event: string, input: z.infer<typeof knowledgeImportSchema>, key: string) =>
    api(`${eventPath(org, event)}/knowledge-import`, okSchema, {
      method: 'POST',
      body: knowledgeImportSchema.parse(input),
      key,
    }),
};
