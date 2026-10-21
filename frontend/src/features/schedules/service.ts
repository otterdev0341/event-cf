import { z } from 'zod';
import { api, eventPath, okSchema } from '../../shared/api/client';
import { scheduleRuleSchema, scheduleSchema, type ScheduleRule } from '../../shared/contracts/schedules';
export const scheduleService = {
  list: (org: string, event: string, signal?: AbortSignal) =>
    api(`${eventPath(org, event)}/schedules`, z.array(scheduleSchema), { signal }),
  create: (org: string, event: string, rule: ScheduleRule, key: string) =>
    api(`${eventPath(org, event)}/schedules`, scheduleSchema, {
      method: 'POST',
      body: scheduleRuleSchema.parse(rule),
      key,
    }),
  cancel: (org: string, event: string, id: string, expectedVersion: number) =>
    api(`${eventPath(org, event)}/schedules/${encodeURIComponent(id)}`, okSchema, {
      method: 'PATCH',
      body: { action: 'cancel', expectedVersion },
    }),
};
