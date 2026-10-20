import { z } from 'zod';
import { api, eventPath, okSchema } from '../../shared/api/client';
import { knowledgeSchema, faqInputSchema } from '../../shared/contracts/events';
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
  category: (org: string, event: string, name: string) =>
    api(`${eventPath(org, event)}/categories`, okSchema, { method: 'POST', body: { name } }),
};
