import { expect, it } from 'vitest';
import { knowledgeSchema } from '../src/shared/contracts/events';
const knowledge = (updatedAt: string | null) => {
  const faq = {
    id: 'faq',
    question: 'Where?',
    answer: 'Main hall',
    category: 'Travel',
    version: 1,
    updatedAt,
  };
  return { draft: [faq], published: [faq], categories: ['Travel'], categoryRevision: 1 };
};
it('parses persisted backend RFC3339 timestamps in draft and published FAQ', () => {
  const timestamp = '2026-10-21T16:19:38.137885570+00:00';
  expect(knowledgeSchema.parse(knowledge(timestamp)).draft[0].updatedAt).toBe(timestamp);
});
it('accepts UTC Z preview timestamps and legacy null while rejecting malformed dates', () => {
  expect(knowledgeSchema.safeParse(knowledge('2026-10-21T16:19:38.137885570Z')).success).toBe(true);
  expect(knowledgeSchema.safeParse(knowledge(null)).success).toBe(true);
  expect(knowledgeSchema.safeParse(knowledge('2026-10-21T16:19:38')).success).toBe(false);
  expect(knowledgeSchema.safeParse(knowledge('2026-02-30T16:19:38+00:00')).success).toBe(false);
});
