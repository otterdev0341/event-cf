import { prepareCampaignRows, promptVariables } from '../shared/campaign-inputs.mjs';
import { handleCallResult } from './results.mjs';
import { callbackConfigured } from './callback.mjs';
import { handleAgentSetup } from './agent-setup.mjs';
import { createClient } from '@supabase/supabase-js';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|password|credential|api.?key|authorization/i.test(key)).map(([key, item]) => [key, clean(item)])) : value;
const split = value => (value || '').split(',').map(v => v.trim()).filter(Boolean);
async function bodyOf(req) {
  if (req.body !== undefined) {
    if (JSON.stringify(req.body).length > 32000) fail(413, 'ข้อมูลคำขอใหญ่เกินไป');
    try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { fail(400, 'รูปแบบคำขอไม่ถูกต้อง'); }
  }
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 32000) fail(413, 'ข้อมูลคำขอใหญ่เกินไป'); }
  try { return JSON.parse(body || '{}'); } catch { fail(400, 'รูปแบบคำขอไม่ถูกต้อง'); }
}

// Shared by Vercel Functions and local Vite middleware. Never accepts an upstream URL from the client.
export async function handleVoice(req, res, env = process.env) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
  try {
    const deadline = AbortSignal.timeout(45000);
    const sbUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
    const sbKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!sbUrl || !sbKey || !env.VOICE_BOT_ACCESS_TOKEN) fail(503, 'ผู้ดูแลยังตั้งค่าการเชื่อมต่อเซิร์ฟเวอร์ไม่ครบ');
    const bearer = req.headers.authorization;
    if (typeof bearer !== 'string' || !/^Bearer [^\s]+$/.test(bearer)) fail(401, 'กรุณาเข้าสู่ระบบ');
    const db = createClient(sbUrl, sbKey, { global: { headers: { Authorization: bearer }, fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]) }) }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { user }, error: authError } = await db.auth.getUser(bearer.slice(7));
    if (authError || !user) fail(401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    const accessMode = env.VOICE_ACCESS_MODE?.trim() || 'members';
    if (!['members', 'allowlist'].includes(accessMode)) fail(503, 'ผู้ดูแลตั้งค่าโหมดสิทธิ์ไม่ถูกต้อง');
    if (accessMode === 'members') {
      if (!user.email || !user.email_confirmed_at) fail(403, 'กรุณายืนยันอีเมลของคุณก่อนใช้งาน Voice Bot');
    } else {
      const allowed = split(env.VOICE_ALLOWED_USER_IDS).includes(user.id) ||
        (Boolean(user.email_confirmed_at) && split(env.VOICE_ALLOWED_EMAILS).map(v => v.toLowerCase()).includes(user.email?.toLowerCase()));
      if (!allowed) fail(403, 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้ Voice Bot กรุณาให้ผู้ดูแลเพิ่มสิทธิ์');
    }
    const url = new URL(req.url, 'http://localhost');
    const endpoint = url.searchParams.get('path') || '';
    if (!endpoint.startsWith('/') || /[\\#\r\n]/.test(endpoint) || endpoint.startsWith('//')) fail(400, 'เส้นทางไม่ถูกต้อง');
    const target = new URL(endpoint, 'https://voice.invalid');
    if (target.origin !== 'https://voice.invalid' || /%2f|%5c|\.\./i.test(endpoint)) fail(400, 'เส้นทางไม่ถูกต้อง');
    const path = target.pathname;
    const method = req.method || 'GET';
    if (method === 'POST' && req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'ไม่อนุญาตคำขอจากเว็บไซต์อื่น');
    const tenantRoute = path.match(/^\/v1\/provisioning\/tenants\/([a-zA-Z0-9_-]+)(\/overview|\/trunk\/status|\/calls(?:\/([a-zA-Z0-9_-]+))?)?$/);
    const agentRoute = path.match(/^\/agents\/([a-zA-Z0-9_-]+)$/);
    const readAllowed = ['/me', '/agents', '/dashboard/v1/overview', '/logs/call_logs_platform', '/platform-config/tools'].includes(path)
      || Boolean(agentRoute) || /^\/logs\/call_logs_platform\/[a-zA-Z0-9_-]+$/.test(path)
      || Boolean(tenantRoute && tenantRoute[2] !== '/calls');
    const resultRoute = path.match(/^\/workspace\/calls\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/result$/i);
    const isResult = Boolean(resultRoute && ['GET','POST'].includes(method));
    const setupRoute = path.match(/^\/workspace\/agents\/(agt_[a-zA-Z0-9_-]+)\/result-setup$/);
    const isSetup = Boolean(setupRoute && ['GET','POST'].includes(method));
    const isCall = method === 'POST' && tenantRoute?.[2] === '/calls';
    if (!(method === 'GET' && readAllowed) && !isCall && !isResult && !isSetup) fail(405, 'ไม่อนุญาตให้เรียกบริการนี้');
    const queryKeys = new Set(['agent_id', 'limit', 'start_at', 'end_at', 'timezone', 'granularity', 'include', 'month']);
    for (const [key, value] of target.searchParams) if (!queryKeys.has(key) || value.length > 200) fail(400, 'พารามิเตอร์ไม่ถูกต้อง');
    if (target.searchParams.has('limit')) target.searchParams.set('limit', String(Math.min(100, Math.max(1, Number(target.searchParams.get('limit')) || 50))));
    const base = new URL(env.VOICE_BOT_BASE_URL || 'https://api-voicebot-stg.botnoigroup.com');
    if (base.protocol !== 'https:' || base.username || base.password) fail(503, 'การตั้งค่าบริการไม่ถูกต้อง');
    const upstream = async (route, body, requestMethod) => {
      const response = await fetch(new URL(route, base), { method: requestMethod || (body ? 'POST' : 'GET'), redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(20000)]),
        headers: { Authorization: `Bearer ${env.VOICE_BOT_ACCESS_TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!response.ok) fail(response.status === 429 ? 429 : 502, `บริการ Voice Bot ตอบกลับ HTTP ${response.status}`);
      return response.json();
    };
    if (isSetup) {
      await handleAgentSetup({id:setupRoute[1],method,body:method === 'POST' ? await bodyOf(req) : undefined,user,env,upstream,fail,send,deadline});
      return;
    }
    if (isResult) {
      await handleCallResult({id:resultRoute[1],method,body:method==='POST'?await bodyOf(req):undefined,db,upstream,user,fail,send});
      return;
    }
    if (tenantRoute) {
      const account = await upstream('/me');
      if (tenantRoute[1] !== account._id) fail(403, 'ไม่มีสิทธิ์เข้าถึงบัญชีนี้');
    }
    if (agentRoute || isCall || target.searchParams.has('agent_id')) {
      // Membership in the upstream account is checked again on the server.
      const agents = await upstream('/agents');
      const hasAgent = id => Array.isArray(agents) && agents.some(a => a.agent_id === id);
      if (agentRoute && !hasAgent(agentRoute[1])) fail(403, 'ไม่มีสิทธิ์ใช้ Agent นี้');
      if (target.searchParams.has('agent_id') && !hasAgent(target.searchParams.get('agent_id'))) fail(403, 'ไม่มีสิทธิ์ใช้ Agent นี้');
      if (isCall) {
        const body = await bodyOf(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'รูปแบบคำขอไม่ถูกต้อง');
        if (body.consent !== true || typeof body.destination !== 'string' || !/^\+?[0-9]{8,15}$/.test(body.destination || '') || !hasAgent(body.agent_id)) fail(400, 'กรุณาตรวจเบอร์ Agent และยืนยันการโทร');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id || '')) fail(400, 'ไม่มีรหัสคำขอโทร');
        let variables = body.metadata?.variables ?? {};
        if (!variables || Array.isArray(variables) || typeof variables !== 'object' || Object.keys(variables).length > 50 || Object.entries(variables).some(([k,v]) => !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(k) || ['__proto__','constructor','prototype'].includes(k) || typeof v !== 'string' || v.length > 2000)) fail(400, 'ข้อมูลตัวแปรไม่ถูกต้อง');
        const detail = await upstream(`/agents/${body.agent_id}`);
        const required = promptVariables(detail);
        const usesCallback = /\{\{vc_call_reference\}\}/.test(String(detail?.agent_data?.system_instruction || '') + String(detail?.agent_data?.greeting_text || ''));
        if (usesCallback && !callbackConfigured(env)) fail(503, 'Agent นี้ต้องใช้ระบบรับผล ผู้ดูแลต้องตั้งค่าเซิร์ฟเวอร์รับผลก่อนโทร');
        const metadata = { variables };
        if (body.metadata?.campaign_id) {
          const { data: campaign, error } = await db.from('voice_campaigns').select('id,data,updated_at').eq('id', body.metadata.campaign_id).maybeSingle();
          if (error || !campaign) fail(403, 'ไม่พบแคมเปญของคุณ');
          metadata.campaign_id = campaign.id;
          if (body.metadata.campaign_batch === true) {
            if (body.metadata.campaign_version !== campaign.updated_at) fail(409, 'แคมเปญถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนเริ่มคิว');
            if (body.agent_id !== campaign.data?.agentId) fail(400, 'Agent ไม่ตรงกับแคมเปญ');
            if (!Number.isInteger(body.metadata.contact_row)) fail(400, 'ต้องระบุแถว CSV');
            const prepared = prepareCampaignRows(campaign.data, required);
            const row = prepared.rows[body.metadata.contact_row];
            if (prepared.errors.length || prepared.rows.some(r => r.errors.length) || !row) fail(400, 'ข้อมูล CSV หรือการจับคู่ไม่ครบ กรุณาแก้ไขก่อนเริ่มคิว');
            // Authoritative destination and inputs come from the owner's saved CSV, not browser overrides.
            body.destination = row.destination;
            variables = row.variables;
            metadata.variables = variables;
            metadata.campaign_batch = true;
            metadata.campaign_version = campaign.updated_at;
          }
          if (body.metadata.contact_row !== undefined) {
            if (!Number.isInteger(body.metadata.contact_row) || body.metadata.contact_row < 0 || body.metadata.contact_row >= (campaign.data?.csv?.rows?.length || 0)) fail(400, 'แถวผู้ติดต่อไม่ถูกต้อง');
            metadata.contact_row = body.metadata.contact_row;
          }
        }
        if (body.metadata?.campaign_batch === true && !metadata.campaign_id) fail(400, 'ต้องระบุแคมเปญ');
        if (body.metadata?.campaign_batch !== true && required.some(key => typeof variables[key] !== 'string' || !variables[key].trim())) fail(400, 'กรุณาเติมตัวแปรใน Prompt ให้ครบก่อนโทร');
        // Reserved correlation comes from this request, never CSV/browser data.
        delete variables.vc_call_reference;
        if (usesCallback) {
          metadata.variables = { ...variables, vc_call_reference: body.request_id.toLowerCase() };
          metadata.result_callback = 1;
        }
        // A durable reservation prevents a retry with the same ID from dialing twice.
        const { error: reserveError } = await db.rpc('reserve_voice_call', { p_id: body.request_id, p_destination: body.destination, p_agent_id: body.agent_id, p_metadata: metadata });
        if (reserveError) fail(reserveError.message.includes('rate_limit') ? 429 : 409, 'ยังส่งคำขอโทรไม่ได้: อาจส่งซ้ำ เกินโควตาต่อนาที หรือยังไม่ได้ติดตั้งตารางการโทร');
        let result;
        try { result = await upstream(path, { destination: body.destination, agent_id: body.agent_id, metadata }); }
        catch (error) {
          await db.from('voice_call_requests').update({ status: 'unknown' }).eq('id', body.request_id);
          fail(502, 'ยังยืนยันผลการส่งคำขอไม่ได้ กรุณาตรวจประวัติก่อนโทรซ้ำ');
        }
        const { error: persistError } = await db.from('voice_call_requests').update({ call_id: result.call_id || null, status: result.status || 'unknown', response: clean(result) }).eq('id', body.request_id);
        send(200, { ...clean(result), ...(persistError ? { persistence_warning: 'รับผลโทรแล้ว แต่บันทึกผลไม่สำเร็จ กรุณาเก็บ Call ID ไว้' } : {}) });
        return;
      }
    }
    let ownedCall;
    if (method === 'GET' && tenantRoute?.[3]) {
      const {data,error}=await db.from('voice_call_requests').select('id').eq('call_id',tenantRoute[3]).eq('owner_id',user.id).maybeSingle();
      if(error || !data) fail(404,'ไม่พบคำขอโทรในบัญชีนี้');
      ownedCall=data;
    }
    const result = await upstream(target.pathname + target.search);
    if(ownedCall && typeof result.status==='string') {
      if(result.call_id!==tenantRoute[3]) fail(502,'Call ID จากบริการไม่ตรงกับคำขอ');
      const {error}=await db.from('voice_call_requests').update({status:result.status}).eq('id',ownedCall.id).eq('owner_id',user.id);
      if(error) result.persistence_warning='อ่านสถานะล่าสุดแล้ว แต่บันทึกไม่ได้';
    }
    send(200, path === '/me' ? pick(result, ['_id','username','role','permissions','email','verified']) : clean(result));
  } catch (error) { send(error instanceof HttpError ? error.status : 503, { error: error instanceof HttpError ? error.message : 'เชื่อมต่อบริการไม่ได้ กรุณาลองใหม่' }); }
}
