import { api, eventPath } from '../../shared/api/client';
import { queueSchema } from '../../shared/contracts/calling';
export const callingService = {
  get: (org: string, event: string, signal?: AbortSignal) =>
    api(`${eventPath(org, event)}/queue-state`, queueSchema, { signal }),
  policy: (org: string, event: string, ratio: number, expectedVersion: number) =>
    api(`${eventPath(org, event)}/queue-policy`, queueSchema, {
      method: 'PATCH',
      body: { ratio, expectedVersion },
    }),
  run: (org: string, event: string, action: string, key: string) =>
    api(`${eventPath(org, event)}/runs`, queueSchema, { method: 'POST', body: { action }, key }),
};
