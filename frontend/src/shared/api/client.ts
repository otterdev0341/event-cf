import { z } from 'zod';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Request = { method?: string; body?: unknown; signal?: AbortSignal; key?: string };
export async function api<T>(path: string, schema: z.ZodType<T>, options: Request = {}): Promise<T> {
  let value: unknown;
  if (__MOCK__) {
    const { mockRequest } = await import('../../mocks/router');
    value = await mockRequest(path, options);
  } else {
    const response = await fetch(`/event-confirm/api/v1${path}`, {
      method: options.method ?? 'GET',
      signal: options.signal,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'EventConfirm',
        ...(options.key ? { 'Idempotency-Key': options.key } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new ApiError(response.status, error?.message ?? `API unavailable (${response.status})`);
    }
    value = await response.json();
  }
  return schema.parse(value);
}
export const okSchema = z.object({ ok: z.boolean(), message: z.string().optional() });
export const eventPath = (org: string, event: string) =>
  `/orgs/${encodeURIComponent(org)}/events/${encodeURIComponent(event)}`;
