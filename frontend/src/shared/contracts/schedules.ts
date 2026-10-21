import { z } from 'zod';
export const scheduleRuleSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    recurrence: z.enum(['once', 'daily', 'weekly']),
    weekdays: z.array(z.number().int().min(0).max(6)),
    redial: z.boolean(),
    participantIds: z.array(z.string()).min(1).max(5000),
    expectedEventVersion: z.number().int().positive(),
    consent: z.literal(true),
  })
  .refine((r) => r.recurrence !== 'weekly' || r.weekdays.length > 0, 'เลือกวันในสัปดาห์');
export const scheduleSchema = z.object({
  id: z.string(),
  rule: scheduleRuleSchema,
  status: z.enum(['scheduled', 'running', 'completed', 'cancelled', 'failed']),
  version: z.number().int(),
  nextAt: z.iso.datetime({ offset: true }),
  completedRuns: z.number().int().nonnegative(),
});
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;
export type ScheduleDto = z.infer<typeof scheduleSchema>;
