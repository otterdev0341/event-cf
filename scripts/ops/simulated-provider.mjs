// Integration environment only. Records acceptance; never contacts a telephone provider.
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
const directory = process.env.PROVIDER_JOURNAL ?? '/data';
const token = process.env.PROVIDER_TOKEN;
if (!token || token.length < 24) throw new Error('Explicit simulation token required');
await mkdir(directory, { recursive: true });
const authorized = value => {
  const actual = Buffer.from(value ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
const uuid = /^[a-f0-9-]{36}$/;
http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.url === '/healthz') return send(200, { ok: true, simulated: true });
  if (!authorized(req.headers.authorization)) return send(401, { message: 'Unauthorized' });
  try {
    if (req.method === 'POST' && req.url === '/calls') {
      let text = '';
      for await (const chunk of req) {
        text += chunk;
        if (text.length > 16384) return send(413, { message: 'Request too large' });
      }
      const body = JSON.parse(text);
      if (!uuid.test(body.attempt_id) || req.headers['idempotency-key'] !== body.attempt_id) {
        return send(422, { message: 'Attempt identity required' });
      }
      const result = { provider_id: `simulated-${body.attempt_id}`, simulated: true };
      const file = `${directory}/${body.attempt_id}.json`;
      try {
        // Do not store participant PII in the simulation journal.
        await writeFile(file, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      return send(200, JSON.parse(await readFile(file, 'utf8')));
    }
    const id = req.url?.split('/')[2];
    if (req.method === 'GET' && req.url === `/calls/${id}` && uuid.test(id)) {
      return send(200, JSON.parse(await readFile(`${directory}/${id}.json`, 'utf8')));
    }
    send(404, { message: 'Unknown operation' });
  } catch (error) {
    send(error.code === 'ENOENT' ? 404 : 422, { message: 'No accepted call or invalid request' });
  }
}).listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
