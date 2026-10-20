import { z } from 'zod';
import { api, eventPath, okSchema } from '../../shared/api/client';
import { participantSchema, importPreviewSchema, type ImportRow } from '../../shared/contracts/calling';
export const participantService = {
  list: (org: string, event: string, signal?: AbortSignal) =>
    api(`${eventPath(org, event)}/participants`, z.array(participantSchema), { signal }),
  preview: (org: string, event: string, rows: ImportRow[], signal?: AbortSignal) =>
    api(`${eventPath(org, event)}/imports`, importPreviewSchema, { method: 'POST', body: { rows }, signal }),
  commit: (org: string, event: string, id: string) =>
    api(`${eventPath(org, event)}/imports/${id}/commit`, okSchema, { method: 'POST', key: id }),
};
