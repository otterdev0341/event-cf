import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../contracts');
const write = process.argv.includes('--write');
const ref = name => ({ $ref: `../schemas/${name}.json` });
const string = { type: 'string' };
const integer = { type: 'integer' };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const ok = object({ ok: { type: 'boolean' }, message: string }, ['ok']);
const list = name => ({ type: 'array', items: ref(name) });
const event = '/orgs/{org}/events/{event}';
const rows = [
  ['/auth/reset/complete', 'post', object({ token: string, password: { type: 'string', minLength: 8 } }), ok, []],
  ['/organizations', 'post', object({ name: string }), ref('sessionSchema')],
  ['/invitations/accept', 'post', object({ token: string }), ref('sessionSchema')],
  ['/orgs/{org}/members/{member}', 'patch', object({ role: { enum: ['admin', 'editor', 'viewer'] } }), ok],
  ['/orgs/{org}/members/{member}', 'delete', null, ok],
  ['/auth/session', 'get', null, ref('sessionSchema')],
  ['/auth/login', 'post', object({ email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 8 } }), ref('sessionSchema'), []],
  ['/auth/logout', 'post', null, ok],
  ['/auth/reset', 'post', object({ email: { type: 'string', format: 'email' } }), ok, []],
  ['/orgs/{org}/members', 'get', null, list('memberSchema')],
  ['/orgs/{org}/members', 'post', object({ email: string, role: { enum: ['admin', 'editor', 'viewer'] } }), ok],
  ['/orgs/{org}/events', 'get', null, list('eventSchema')],
  ['/orgs/{org}/events', 'post', ref('eventInputSchema'), ref('eventSchema')],
  [event, 'get', null, ref('eventSchema')],
  [event, 'patch', ref('eventPatchSchema'), ref('eventSchema')],
  [`${event}/knowledge`, 'get', null, ref('knowledgeSchema')],
  [`${event}/categories`, 'post', object({ name: string }), ok],
  [`${event}/faqs`, 'post', ref('faqInputSchema'), ok],
  [`${event}/faqs/{faq}`, 'patch', ref('faqUpdateSchema'), ok],
  [`${event}/faqs/{faq}`, 'delete', null, ok],
  [`${event}/publish`, 'post', null, ok],
  [`${event}/participants`, 'get', null, list('participantSchema')],
  [`${event}/imports`, 'post', object({ rows: list('importRowSchema') }), ref('importPreviewSchema')],
  [`${event}/imports/{import}/commit`, 'post', null, ok],
  [`${event}/queue-state`, 'get', null, ref('queueSchema')],
  [`${event}/queue-policy`, 'patch', object({ ratio: { type: 'integer', minimum: 1, maximum: 100 }, expectedVersion: integer }), ref('queueSchema')],
  [`${event}/runs`, 'post', object({ action: { enum: ['start', 'pause', 'resume', 'cancel'] } }), ref('queueSchema')],
  [`${event}/tickets`, 'get', null, list('ticketSchema')],
  [`${event}/tickets`, 'post', ref('ticketInputSchema'), ref('ticketSchema')],
  [`${event}/tickets/{ticket}`, 'patch', object({ expectedVersion: integer, status: { enum: ['open', 'in_progress', 'resolved'] }, assignee: string, dueDate: string, comment: string }, ['expectedVersion']), ref('ticketSchema')],
  ['/orgs/{org}/credentials', 'get', null, list('credentialSchema')],
  ['/orgs/{org}/credentials', 'post', ref('credentialInputSchema'), ref('issuedSchema')],
  ['/orgs/{org}/credentials/{credential}/rotate', 'post', null, ref('issuedSchema')],
  ['/orgs/{org}/credentials/{credential}/revoke', 'post', null, ok],
  ['/orgs/{org}/check-pair', 'post', object({ orgKeyId: string, eventKeyId: string, eventId: string }), ok],
];
const paths = {};
for (const [route, method, input, output, security] of rows) {
  const name = route.replace(/[{}]/g, '').split('/').filter(Boolean).join('-');
  const item = paths[route] ??= { name, operations: {} };
  const operation = {
    operationId: `${method}-${name}`,
    summary: `${method.toUpperCase()} ${route}`,
    ...(security ? { security } : {}),
    parameters: [...route.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: string })),
    ...(input ? { requestBody: { required: true, content: { 'application/json': { schema: input } } } } : {}),
    responses: {
      200: { description: 'Success', content: { 'application/json': { schema: output } } },
      default: { description: '401/403/404/409/422/429/503 error', content: { 'application/json': { schema: object({ message: string, code: string }, ['message']) } } },
    },
  };
  if (route.endsWith('/commit') || route.endsWith('/runs') || (route.endsWith('/tickets') && method === 'post')) {
    operation.parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: string });
  }
  item.operations[method] = operation;
}
await mkdir(path.join(root, 'paths'), { recursive: true });
async function emit(file, value) {
  const target = path.join(root, file);
  const content = JSON.stringify(value, null, 2) + '\n';
  if (write) await writeFile(target, content);
  else if (await readFile(target, 'utf8') !== content) throw new Error(`OpenAPI drift: ${file}`);
}
for (const item of Object.values(paths)) await emit(`paths/${item.name}.json`, item.operations);
await emit('openapi.json', {
  openapi: '3.1.0', info: { title: 'Event Confirm browser API — phase 0 contract', version: '0.1.0' },
  servers: [{ url: '/event-confirm/api/v1' }], security: [{ SessionCookie: [] }],
  paths: Object.fromEntries(Object.entries(paths).map(([route, item]) => [route, { $ref: `./paths/${item.name}.json` }])),
  components: { securitySchemes: { SessionCookie: { type: 'apiKey', in: 'cookie', name: 'event_confirm_session' } } },
});
console.log(write ? 'Wrote OpenAPI 3.1 paths' : 'PASS: OpenAPI contracts match');
