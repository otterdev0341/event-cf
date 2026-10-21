import { z } from 'zod';
import { api, eventPath } from '../../shared/api/client';
const recordingSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('available'), playbackPath: z.string(), simulated: z.boolean() }),
  z.object({ state: z.enum(['pending', 'not_available']) }),
]);
export async function recordingInfo(org: string, event: string, attempt: string, signal?: AbortSignal) {
  const path = `${eventPath(org, event)}/calls/${encodeURIComponent(attempt)}/recording`;
  const dto = await api(path, recordingSchema, { signal });
  // Never render arbitrary provider URLs or credentials in the browser.
  if (dto.state === 'available') {
    const expected = `/event-confirm/api/v1${path}/audio`;
    if (dto.playbackPath !== expected) throw new Error('เส้นทางเสียงไม่ตรงกับสายที่เลือก');
    return { state: dto.state, audioUrl: expected, simulated: dto.simulated };
  }
  return { state: dto.state, audioUrl: null, simulated: false };
}
