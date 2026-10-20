import { beforeEach, describe, expect, it } from 'vitest';
import { mockRequest } from '../src/mocks/router';
import { identity, state } from '../src/mocks/state';
const base = '/orgs/studio/events/design-2026';
beforeEach(() => {
  state.session = structuredClone(identity);
});
describe('preview transport boundaries', () => {
  it('rejects cross-org event access and viewer writes', async () => {
    await expect(mockRequest('/orgs/community/events/design-2026')).rejects.toMatchObject({ status: 404 });
    await expect(mockRequest('/orgs/community/events', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 403,
    });
  });
  it('keeps FAQ drafts invisible until explicitly published', async () => {
    const before = structuredClone(state.knowledge['design-2026'].published);
    await mockRequest(`${base}/faqs`, {
      method: 'POST',
      body: { question: 'New draft?', answer: 'Not yet published.', category: 'สถานที่และเวลา' },
    });
    expect(state.knowledge['design-2026'].published).toEqual(before);
    await mockRequest(`${base}/publish`, { method: 'POST' });
    expect(state.knowledge['design-2026'].published.length).toBe(before.length + 1);
  });
  it('preview/commit never starts calls; commit is idempotent', async () => {
    const result = (await mockRequest(`${base}/imports`, {
      method: 'POST',
      body: {
        rows: [
          {
            phone: '0899999999',
            first_name: 'Test',
            last_name: 'Person',
            nickname: '',
            lang_code: 'th',
            event_code: 'DESIGN26',
            event_date: '2026-12-12',
          },
        ],
      },
    })) as { id: string };
    const count = state.participants['design-2026'].length;
    expect(state.queues['design-2026'].status).toBe('idle');
    await mockRequest(`${base}/imports/${result.id}/commit`, { method: 'POST', key: result.id });
    await mockRequest(`${base}/imports/${result.id}/commit`, { method: 'POST', key: result.id });
    expect(state.participants['design-2026'].length).toBe(count + 1);
    expect(state.queues['design-2026'].status).toBe('idle');
  });
  it('rejects stale ticket changes with 409 without mutation', async () => {
    const original = structuredClone(state.tickets[0]);
    await expect(
      mockRequest(`${base}/tickets/ticket-1`, {
        method: 'PATCH',
        body: { expectedVersion: 0, status: 'resolved' },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(state.tickets[0]).toEqual(original);
  });
  it('aborts requests before they mutate the mock store', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(mockRequest(base, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
