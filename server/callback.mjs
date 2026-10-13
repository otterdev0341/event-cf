import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { outcomeLabels } from '../shared/call-results.mjs';
import { accountCallbackSecret } from './connection.mjs';
import { validTranscriptPayload, saveTranscriptCallback } from './transcript.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = value => createHash('sha256').update(value).digest();
export const callbackConfigured = env => Boolean(
  (env.SUPABASE_URL || env.VITE_SUPABASE_URL) && env.SUPABASE_SERVICE_ROLE_KEY &&
  typeof env.VOICE_RESULT_CALLBACK_SECRET === 'string' && env.VOICE_RESULT_CALLBACK_SECRET.length >= 32
);

// Provider-only ingress. It never dials, accepts an owner from the body, or changes call status.
export async function handleResultCallback(req, res, env = process.env) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(405, { error: 'POST required' }); }
    if (!callbackConfigured(env)) return send(503, { error: 'Result receiver is not configured' });
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || authorization.length > 4096 || !authorization.startsWith('Bearer ')) {
      return send(401, { error: 'Invalid callback credentials' });
    }
    const supplied=authorization.slice(7);
    const legacyAuth=timingSafeEqual(digest(supplied),digest(env.VOICE_RESULT_CALLBACK_SECRET));
    if(!legacyAuth && !/^[a-zA-Z0-9_-]{43}$/.test(supplied))return send(401,{error:'Invalid callback credentials'});
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return send(415, { error: 'JSON required' });
    let raw = '';
    if (req.body !== undefined) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    else for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 48000) return send(413, { error: 'Payload too large' }); }
    if (Buffer.byteLength(raw) > 48000) return send(413, { error: 'Payload too large' });
    let body;
    try { body = JSON.parse(raw); } catch { return send(Buffer.byteLength(raw)>16000?413:400, { error: 'Invalid JSON or payload too large' }); }
    const isTranscript=body && typeof body==='object' && !Array.isArray(body) && Object.hasOwn(body,'transcript');
    if(!isTranscript && Buffer.byteLength(raw)>16000)return send(413,{error:'Payload too large'});
    if(isTranscript && !validTranscriptPayload(body))return send(400,{error:'Invalid conversation fields',fields:['request_id','agent_id','transcript']});
    const allowed = ['request_id', 'agent_id', 'call_result', 'needs_agent', 'evidence'];
    const objectBody = body && typeof body === 'object' && !Array.isArray(body);
    const invalid = !objectBody ? ['body'] : [
      Object.keys(body).some(k => !allowed.includes(k)) && 'unexpected_fields',
      (typeof body.request_id !== 'string' || !uuid.test(body.request_id)) && 'request_id',
      (typeof body.agent_id !== 'string' || !/^agt_[a-zA-Z0-9_-]+$/.test(body.agent_id)) && 'agent_id',
      (typeof body.call_result !== 'string' || !Object.hasOwn(outcomeLabels, body.call_result)) && 'call_result',
      ![true, false, null].includes(body.needs_agent) && 'needs_agent',
      (typeof body.evidence !== 'string' || !body.evidence.trim() || body.evidence.length > 2000) && 'evidence'
    ].filter(Boolean);
    if (!isTranscript && invalid.length) {
      // Only fixed field names and primitive types: never log secrets, IDs or conversation content.
      const fieldTypes = Object.fromEntries(allowed.map(key => [key, !objectBody || !Object.hasOwn(body, key) ? 'missing' : body[key] === null ? 'null' : Array.isArray(body[key]) ? 'array' : typeof body[key]]));
      console.warn('voice_result_invalid_fields', JSON.stringify({ fields: invalid, fieldTypes }));
      return send(400, { error: 'Invalid result fields; send a flat JSON object with typed values', fields: invalid, expected: { request_id: 'UUID vc_call_reference', agent_id: 'configured agt_ ID', call_result: Object.keys(outcomeLabels), needs_agent: 'JSON true, false or null (not quoted strings)', evidence: 'nonempty string, at most 2000 characters' } });
    }
    const db = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) }
    });
    const { data: record, error } = await db.from('voice_call_requests')
      .select('id,owner_id,agent_id,call_id,metadata,response,status').eq('id', body.request_id).maybeSingle();
    if (error) return send(503, { error: 'Storage unavailable; retry later' });
    const scoped=record?.metadata?.callback_auth==='account_v2';
    let authorized=legacyAuth&&!scoped;
    if(scoped&&record.metadata.voice_account_id)authorized=timingSafeEqual(digest(supplied),digest(accountCallbackSecret(record.metadata.voice_account_id,env)));
    if(!authorized)return send(401,{error:'Invalid callback credentials'});
    if (!record || record.agent_id !== body.agent_id || record.metadata?.result_callback !== 1 ||
      record.metadata?.variables?.vc_call_reference !== record.id) return send(404, { error: 'Unknown callback reference' });
    if(isTranscript)return await saveTranscriptCallback({record,body,db,send});
    // Initial call persistence owns response until call_id is saved. Retry rather than race it.
    if (!record.call_id) return send(409, { error: 'Call not yet persisted; retry later' });
    const outcome = { call_result: body.call_result, needs_agent: body.needs_agent, evidence: body.evidence.trim(), source: 'agent_tool' };
    const fingerprint = digest(JSON.stringify([record.id, record.agent_id, outcome])).toString('hex');
    if (record.response?.callback) {
      return record.response.callback.fingerprint === fingerprint
        ? send(200, { received: true, duplicate: true })
        : send(409, { error: 'A final result already exists; review corrections in Voice Confirm' });
    }
    const original = record.response;
    const callback = { outcome, fingerprint, received_at: new Date().toISOString(), call_id: record.call_id };
    let update = db.from('voice_call_requests').update({ response: { ...(original || {}), callback } })
      .eq('id', record.id).eq('owner_id', record.owner_id).eq('agent_id', record.agent_id)
      .eq('call_id', record.call_id).is('response->callback->>received_at', null);
    for (const [path, value] of [['response->review->>updated_at', original?.review?.updated_at], ['response->followup->>checked_at', original?.followup?.checked_at], ['response->transcript->>received_at',original?.transcript?.received_at]]) {
      update = value ? update.eq(path, value) : update.is(path, null);
    }
    const saved = await update.select('id');
    if (saved.error) return send(503, { error: 'Result was not saved; retry later' });
    if (!saved.data?.length) return send(409, { error: 'Concurrent update; retry the same payload' });
    return send(200, { received: true });
  } catch { return send(503, { error: 'Result receiver unavailable; retry later' }); }
}
