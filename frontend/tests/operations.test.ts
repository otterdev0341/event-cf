import { beforeEach, expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { permissions } from '../src/shared/policy/roles';
import { identity, state, queueFor } from '../src/mocks/state';
import { mockRequest } from '../src/mocks/router';
import { readKnowledgeTemplate } from '../src/features/knowledge/template';
import { callSeries } from '../src/features/events/dashboard';
import { validateRows } from '../src/shared/contracts/import-validation';
const base = '/orgs/studio/events/design-2026';
const knowledge = structuredClone(state.knowledge['design-2026']);
const tickets = structuredClone(state.tickets);
const people = structuredClone(state.participants['design-2026']);
beforeEach(() => {
  state.session = structuredClone(identity);
  state.knowledge['design-2026'] = structuredClone(knowledge);
  state.tickets = structuredClone(tickets);
  state.participants['design-2026'] = structuredClone(people);
  state.queues = {};
  state.idempotency.clear();
});
it('event admins cannot edit ungranted events and root cannot be granted from org UI', async () => {
  state.session!.organizations[0].role = 'event_admin';
  state.session!.organizations[0].eventIds = [];
  await expect(mockRequest(`${base}/publish`, { method: 'POST' })).rejects.toMatchObject({ status: 403 });
  state.session!.organizations[0].eventIds = ['design-2026'];
  await expect(mockRequest(`${base}/publish`, { method: 'POST' })).resolves.toMatchObject({ ok: true });
  await expect(
    mockRequest('/orgs/studio/members', {
      method: 'POST',
      body: { email: 'test@example.test', role: 'org_admin' },
    }),
  ).rejects.toMatchObject({ status: 403 });
  state.session = structuredClone(identity);
  await expect(
    mockRequest('/orgs/studio/members', {
      method: 'POST',
      body: { email: 'test@example.test', role: 'root' },
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(permissions({ ...identity.user, platformRole: 'root' }, undefined, 'any').canAdmin).toBe(true);
});
it('team members can update assigned-event tickets but not event content', async () => {
  state.session!.organizations[0].role = 'team_member';
  state.session!.organizations[0].eventIds = ['design-2026'];
  await expect(
    mockRequest(`${base}/tickets/ticket-1`, {
      method: 'PATCH',
      body: { expectedVersion: 1, status: 'waiting' },
    }),
  ).resolves.toMatchObject({ status: 'waiting' });
  await expect(mockRequest(`${base}/publish`, { method: 'POST' })).rejects.toMatchObject({ status: 403 });
});
it('validates all assignees atomically and rejects duplicates/cross-org identities', async () => {
  const update = (ids: string[], version = 1) =>
    mockRequest(`${base}/tickets/ticket-1`, {
      method: 'PATCH',
      body: { expectedVersion: version, assigneeIds: ids },
    });
  await expect(update(['studio-ops', 'community-support'])).rejects.toMatchObject({ status: 422 });
  expect(state.tickets[0].assigneeIds).toEqual([]);
  await expect(update(['studio-ops', 'studio-ops'])).rejects.toMatchObject({ status: 422 });
  await expect(update(['studio-ops', 'studio-support'])).resolves.toMatchObject({
    assigneeIds: ['studio-ops', 'studio-support'],
  });
});
it('category revision prevents stale imports; valid batch is atomic and idempotent', async () => {
  const rows = [{ question: 'Arrival time?', answer: 'Nine.', category: 'การเดินทาง' }];
  const body = { eventCode: 'DESIGN26', categoryRevision: 1, rows };
  await expect(
    mockRequest(`${base}/knowledge-import`, {
      method: 'POST',
      body: { ...body, rows: [...rows, { ...rows[0], question: 'Invalid?', category: 'other' }] },
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(state.knowledge['design-2026'].draft).toHaveLength(1);
  await mockRequest(`${base}/knowledge-import`, { method: 'POST', body, key: 'batch' });
  await mockRequest(`${base}/knowledge-import`, { method: 'POST', body, key: 'batch' });
  expect(state.knowledge['design-2026'].draft).toHaveLength(2);
  expect(state.knowledge['design-2026'].published).toHaveLength(1);
  await mockRequest(`${base}/categories`, {
    method: 'POST',
    body: { name: 'New category', expectedRevision: 1 },
  });
  await expect(
    mockRequest(`${base}/knowledge-import`, {
      method: 'POST',
      body: { ...body, rows: [{ ...rows[0], question: 'Another?' }] },
    }),
  ).rejects.toMatchObject({ status: 409 });
});
it('category rename changes draft only; referenced category cannot be deleted', async () => {
  await expect(
    mockRequest(`${base}/categories/${encodeURIComponent('สถานที่และเวลา')}`, {
      method: 'DELETE',
      body: { expectedRevision: 1 },
    }),
  ).rejects.toMatchObject({ status: 409 });
  await mockRequest(`${base}/categories/${encodeURIComponent('สถานที่และเวลา')}`, {
    method: 'PATCH',
    body: { name: 'Venue', expectedRevision: 1 },
  });
  expect(state.knowledge['design-2026'].draft[0].category).toBe('Venue');
  expect(state.knowledge['design-2026'].published[0].category).toBe('สถานที่และเวลา');
});
it('zero retries stops exhausted no-answer records without changing attendance', async () => {
  await mockRequest(`${base}/queue-policy`, {
    method: 'PATCH',
    body: { expectedVersion: 1, ratio: 2, maxRetries: 0 },
  });
  expect(queueFor('design-2026').maxAttempts).toBe(1);
  expect(state.participants['design-2026'][2]).toMatchObject({
    state: 'stopped',
    outcome: { result: 'unknown', reason: 'no_answer' },
  });
  expect(state.participants['design-2026'][0].state).toBe('ready');
});
it('daily and weekly attempts use Bangkok calendar boundaries and exclude future calls', () => {
  const person = structuredClone(people[2]);
  person.attempts = ['2026-10-18T17:30:00Z', '2026-10-20T03:00:00Z', '2026-10-22T03:00:00Z'].map((at, i) => ({
    ...person.attempts[0],
    number: i + 1,
    at,
  }));
  const now = new Date('2026-10-21T12:00:00Z');
  const daily = callSeries([person], 'daily', now);
  expect(daily.values[daily.labels.indexOf('2026-10-19')]).toBe(1);
  expect(callSeries([person], 'weekly', now).values.at(-1)).toBe(2);
});
it('rejects unsupported participant language', () => {
  const row = {
    phone: '0812345678',
    first_name: 'A',
    last_name: 'B',
    nickname: '',
    event_code: 'EV26',
    event_date: '2026-12-12',
    lang_code: 'xx',
  };
  expect(validateRows([row], { code: 'EV26', date: '2026-12-12' }).join()).toContain('lang_code');
});
it('knowledge workbook parses event/category metadata and rejects formulas', async () => {
  const book = new Workbook();
  const faq = book.addWorksheet('FAQ');
  faq.addRow(['event_code', 'category', 'question', 'answer']);
  faq.addRow(['DESIGN26', 'การเดินทาง', 'How?', 'By car.']);
  book.addWorksheet('Categories').addRow(['การเดินทาง']);
  const meta = book.addWorksheet('Event');
  meta.addRow(['event_code', 'category_revision']);
  meta.addRow(['DESIGN26', '1']);
  const file = async () => new File([(await book.xlsx.writeBuffer()) as BlobPart], 'knowledge.xlsx');
  expect(await readKnowledgeTemplate(await file())).toMatchObject({
    eventCode: 'DESIGN26',
    categoryRevision: 1,
  });
  faq.getCell('D2').value = { formula: '1+1', result: 2 };
  await expect(readKnowledgeTemplate(await file())).rejects.toThrow('formula');
});
