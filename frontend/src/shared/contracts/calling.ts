import { z } from 'zod';
export const languageCodes = [
  'th',
  'en',
  'ja',
  'zh',
  'ko',
  'vi',
  'id',
  'ms',
  'fr',
  'de',
  'es',
  'ar',
] as const;
export const outcomeSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('confirm'), reason: z.null() }),
  z.object({ result: z.literal('decline'), reason: z.null() }),
  z.object({ result: z.literal('unknown'), reason: z.enum(['no_answer', 'noisy_audio', 'ai_cannot_infer']) }),
  z.object({ result: z.null(), reason: z.null() }),
]);
export const attemptSchema = z.object({
  id: z.string().optional(),
  number: z.number().int(),
  transport: z.string(),
  outcome: outcomeSchema,
  at: z.string(),
});
export const participantSchema = z.object({
  id: z.string(),
  phone: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  nickname: z.string(),
  lang_code: z.enum(languageCodes),
  lane: z.enum(['new', 'fail', 'done']),
  state: z.enum(['ready', 'delayed', 'stopped', 'awaiting_result']),
  outcome: outcomeSchema,
  noAnswerCount: z.number().int(),
  attempts: z.array(attemptSchema),
});
export const queueSchema = z.object({
  ratio: z.number().int().positive(),
  retryRatio: z.number().int().min(1).max(100).default(1),
  version: z.number().int(),
  newSinceFail: z.number().int(),
  dispatchPosition: z.number().int().nonnegative().default(0),
  status: z.enum(['idle', 'running', 'paused', 'cancelled']),
  maxAttempts: z.number().int(),
  delayMinutes: z.number().int(),
  pendingTurn: z.boolean(),
});
export const importRowSchema = z.object({
  phone: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  nickname: z.string(),
  lang_code: z.string(),
  event_code: z.string(),
  event_date: z.string(),
});
export const importPreviewSchema = z.object({
  id: z.string(),
  rows: z.array(importRowSchema),
  errors: z.array(z.string()),
  committed: z.boolean(),
});
export type Participant = z.infer<typeof participantSchema>;
export type ImportRow = z.infer<typeof importRowSchema>;
export type Queue = z.infer<typeof queueSchema>;
