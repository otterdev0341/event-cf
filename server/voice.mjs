import { prepareCampaignRows, promptVariables } from '../shared/campaign-inputs.mjs';
import { handleCallResult } from './results.mjs';
import { callbackConfigured } from './callback.mjs';
import { handleAgentSetup, connectedTool } from './agent-setup.mjs';
import { connectionStore, loadConnection, handleConnection, accountCallbackSecret } from './connection.mjs';
import { createClient } from '@supabase/supabase-js';
import { handleRecording } from './recording.mjs';
import { campaignRequestId, terminalCall } from '../shared/campaign-queue.mjs';
import { handlePreview } from './preview.mjs';
import { connectedTranscriptTool } from './transcript.mjs';

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
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
    if (!sbUrl || !sbKey) fail(503, 'ผู้ดูแลยังตั้งค่าการเชื่อมต่อเซิร์ฟเวอร์ไม่ครบ');
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
    // Encoded separators are invalid in the path; query values can contain them (e.g. Asia/Bangkok).
    const requestedPath = endpoint.split('?')[0];
    if (target.origin !== 'https://voice.invalid' || /%2f|%5c|\.\./i.test(requestedPath)) fail(400, 'เส้นทางไม่ถูกต้อง');
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
    const recordingRoute=path.match(/^\/workspace\/calls\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/recording$/i);
    const isRecording=Boolean(recordingRoute&&method==='GET');
    const setupRoute = path.match(/^\/workspace\/agents\/(agt_[a-zA-Z0-9_-]+)\/(result-setup|transcript-setup)$/);
    const isSetup = Boolean(setupRoute && ['GET','POST'].includes(method));
    const previewRoute = path.match(/^\/workspace\/agents\/(agt_[a-zA-Z0-9_-]+)\/preview-token$/);
    const isPreview = Boolean(previewRoute && method === 'POST');
    const isConnection = path === '/workspace/connection' && ['GET','POST'].includes(method);
    const isCall = method === 'POST' && tenantRoute?.[2] === '/calls';
    if (!(method === 'GET' && readAllowed) && !isCall && !isResult && !isSetup && !isConnection && !isRecording && !isPreview) fail(405, 'ไม่อนุญาตให้เรียกบริการนี้');
    const queryKeys = new Set(['agent_id', 'limit', 'start_at', 'end_at', 'timezone', 'granularity', 'include', 'month']);
    for (const [key, value] of target.searchParams) if (!queryKeys.has(key) || value.length > 200) fail(400, 'พารามิเตอร์ไม่ถูกต้อง');
    if (target.searchParams.has('limit')) target.searchParams.set('limit', String(Math.min(100, Math.max(1, Number(target.searchParams.get('limit')) || 50))));
    const base = new URL(env.VOICE_BOT_BASE_URL || 'https://api-voicebot-stg.botnoigroup.com');
    if (base.protocol !== 'https:' || base.username || base.password) fail(503, 'การตั้งค่าบริการไม่ถูกต้อง');
    let store;
    try { store = connectionStore(env,deadline); } catch { fail(503,'ผู้ดูแลยังตั้งค่าระบบเชื่อมบัญชีไม่ครบ'); }
    const connection = await loadConnection(store,user,env,fail);
    if(isConnection) return await handleConnection({method,body:method==='POST'?await bodyOf(req):undefined,user,env,db:store,connection,deadline,fail,send});
    // Saved evidence and manual review remain available even when a token expires or an account changes.
    if(isResult && method==='POST')return await handleCallResult({id:resultRoute[1],method,body:await bodyOf(req),db,user,fail,send});
    if(isResult && (!connection || connection.expires_at && Date.parse(connection.expires_at)<=Date.now())) {
      return await handleCallResult({id:resultRoute[1],method,db,user,fail,send,accountId:null});
    }
    if(!connection)fail(428,'ยังไม่ได้เชื่อมบัญชี Voice Bot ไปที่ตั้งค่าแล้วใส่ Session JWT ของคุณ');
    if(connection.expires_at && Date.parse(connection.expires_at)<=Date.now())fail(428,'Session JWT ของ Voice Bot หมดอายุ ไปที่ตั้งค่าเพื่อเชื่อมใหม่');
    const upstream = async (route, body, requestMethod) => {
      const response = await fetch(new URL(route, base), { method: requestMethod || (body ? 'POST' : 'GET'), redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(20000)]),
        headers: { Authorization: `Bearer ${connection.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if([401,403].includes(response.status))fail(428,'Voice Bot ไม่รับสิทธิ์ของ Token นี้ ไปที่ตั้งค่าเพื่อเชื่อม Session JWT ใหม่');
      if (route === '/call/tokens' && response.status === 503) {
        const details = await response.json().catch(() => ({}));
        if (details.detail === 'token_mint_not_configured' || details.code === 'token_mint_not_configured') {
          fail(503, 'บริการทดสอบเสียงของ Voice Bot ยังไม่ได้เปิดใช้งาน ต้องให้ผู้ดูแล Voice Bot ตั้งค่าบริการก่อนเริ่มคุย', 'preview_not_configured');
        }
        fail(503, 'บริการทดสอบเสียงของ Voice Bot ไม่พร้อมชั่วคราว กรุณาลองใหม่ภายหลัง', 'preview_service_unavailable');
      }
      if (!response.ok) fail(response.status === 429 ? 429 : 502, `บริการ Voice Bot ตอบกลับ HTTP ${response.status}`);
      return response.json();
    };
    if (isPreview) return await handlePreview({ id: previewRoute[1], body: await bodyOf(req), connection, upstream, fail, send });
    if (isSetup) {
      await handleAgentSetup({id:setupRoute[1],method,body:method === 'POST' ? await bodyOf(req) : undefined,user,env:{...env,...(env.VOICE_RESULT_CALLBACK_SECRET?.length>=32?{VOICE_RESULT_CALLBACK_SECRET:accountCallbackSecret(connection.account_id,env)}:{})},connection,upstream,fail,send,deadline,transcript:setupRoute[2]==='transcript-setup'});
      return;
    }
    if(isRecording)return await handleRecording({id:recordingRoute[1],db,user,accountId:connection.account_id,upstream,fail,send});
    if (isResult) {
      await handleCallResult({id:resultRoute[1],method,db,upstream,user,fail,send,accountId:connection.account_id});
      return;
    }
    if (tenantRoute) {
      const account = await upstream('/me');
      if (account._id !== connection.account_id || tenantRoute[1] !== account._id) fail(403, 'ไม่มีสิทธิ์เข้าถึงบัญชีนี้');
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
        const previewTest = body.metadata?.preview_test === true;
        const outputs = previewTest ? body.metadata.output_variables : [];
        if (previewTest && (body.metadata.campaign_id || body.metadata.campaign_batch || !Array.isArray(outputs) || outputs.length > 50
          || outputs.some(key => typeof key !== 'string' || !required.includes(key)) || new Set(outputs).size !== outputs.length)) {
          fail(400, 'กรุณาดึงตัวแปรล่าสุดและตรวจข้อมูลสำหรับโทรทดสอบอีกครั้ง');
        }
        const usesCallback = /\{\{vc_call_reference\}\}/.test(String(detail?.agent_data?.system_instruction || '') + String(detail?.agent_data?.greeting_text || ''));
        if (usesCallback && !callbackConfigured(env)) fail(503, 'Agent นี้ต้องใช้ระบบรับผล ผู้ดูแลต้องตั้งค่าเซิร์ฟเวอร์รับผลก่อนโทร');
        let recordingConnected=false;
        if(usesCallback) {
          const tools=await upstream('/platform-config/tools');
          recordingConnected=Boolean(connectedTranscriptTool(detail,tools,env.VOICE_RESULT_CALLBACK_URL,connection.account_id));
          if(!connectedTool(detail,tools,env.VOICE_RESULT_CALLBACK_URL,connection.account_id)&&!recordingConnected)fail(409,'บอทยังไม่ได้เชื่อมระบบรับผลของบัญชีนี้ กรุณาเชื่อมในขั้นตอนเลือก Agent ก่อนโทร');
        }
        const metadata = { variables, voice_account_id:connection.account_id };
        if (previewTest) { metadata.preview_test = true; metadata.output_variables = outputs; }
        if (body.metadata?.campaign_id) {
          const { data: campaign, error } = await db.from('voice_campaigns').select('id,data,updated_at').eq('id', body.metadata.campaign_id).maybeSingle();
          if (error || !campaign) fail(403, 'ไม่พบแคมเปญของคุณ');
          if(campaign.data?.recordConversation===true) {
            if(body.agent_id!==campaign.data?.agentId)fail(400,'Agent ไม่ตรงกับแคมเปญ');
            if(!recordingConnected)fail(409,'บอทยังไม่ได้เชื่อมบันทึกบทสนทนา กรุณาแก้แคมเปญและเชื่อมในขั้นตอนเลือก Agent');
            metadata.record_conversation=true;
          }
          metadata.campaign_id = campaign.id;
          if(campaign.data?.voiceAccountId && campaign.data.voiceAccountId!==connection.account_id)fail(409,'แคมเปญนี้ใช้บัญชี Voice Bot อีกบัญชี กรุณาเชื่อมบัญชีเดิมหรือสร้างแคมเปญใหม่');
          const {data:foreignAttempt,error:historyError}=await db.from('voice_call_requests').select('id').eq('metadata->>campaign_id',campaign.id).or(`metadata->>voice_account_id.is.null,metadata->>voice_account_id.neq.${connection.account_id}`).limit(1).maybeSingle();
          if(historyError)fail(503,'ยังตรวจบัญชีของคำขอเดิมไม่ได้');
          if(foreignAttempt)fail(409,'แคมเปญนี้มีคำขอของบัญชี Voice Bot อื่นหรือประวัติที่ยังไม่ผูกบัญชี กรุณาเชื่อมบัญชีเดิมหรือติดต่อผู้ดูแล');
          if (body.metadata.campaign_batch === true) {
            if (body.metadata.campaign_version !== campaign.updated_at) fail(409, 'แคมเปญถูกแก้ไขแล้ว กรุณาโหลดใหม่ก่อนเริ่มคิว');
            if (body.agent_id !== campaign.data?.agentId) fail(400, 'Agent ไม่ตรงกับแคมเปญ');
            if (!Number.isInteger(body.metadata.contact_row)) fail(400, 'ต้องระบุแถว CSV');
            const prepared = prepareCampaignRows(campaign.data, required);
            const row = prepared.rows[body.metadata.contact_row];
            if (prepared.errors.length || !row || row.errors.length) fail(400, 'ข้อมูล CSV ของแถวที่เลือกหรือการจับคู่ไม่ครบ กรุณาแก้ไขก่อนเริ่มคิว');
            const {data:last,error:lastError}=await db.from('voice_call_requests').select('id,status,call_id,metadata').eq('metadata->>campaign_id',campaign.id).eq('metadata->>campaign_version',campaign.updated_at).eq('metadata->>contact_row',String(row.index)).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle();
            if(lastError)fail(503,'ตรวจประวัติแถวที่เลือกไม่ได้');
            const retry=body.metadata.campaign_redial_of;
            if(retry!==undefined&&(!last||retry!==last.id||!last.call_id||!terminalCall(last.status)))fail(409,'สายเดิมยังไม่จบหรือประวัติเปลี่ยนแล้ว กรุณาตรวจและยืนยันใหม่');
            if(last&&!retry)fail(409,'แถวนี้มีคำขอแล้ว กรุณาตรวจประวัติ หรือเลือกโทรซ้ำพร้อมยืนยัน');
            if(body.request_id!==await campaignRequestId(campaign.id,campaign.updated_at,row.index,retry))fail(400,'รหัสคำขอของแถวนี้ไม่ตรง กรุณาโหลดหน้าใหม่');
            if(retry)metadata.campaign_redial_of=retry;
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
        if (body.metadata?.campaign_batch !== true && required.some(key => !outputs.includes(key) && (typeof variables[key] !== 'string' || !variables[key].trim()))) fail(400, 'กรุณาเติมตัวแปรใน Prompt ให้ครบก่อนโทร');
        if (previewTest) for (const key of outputs) delete variables[key];
        // Reserved correlation comes from this request, never CSV/browser data.
        delete variables.vc_call_reference;
        delete variables.vc_record_conversation;
        if (usesCallback) {
          metadata.variables = { ...variables, vc_call_reference: body.request_id.toLowerCase(), vc_record_conversation: metadata.record_conversation===true?'true':'false' };
          metadata.result_callback = 1;
          metadata.callback_auth = 'account_v2';
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
      const {data,error}=await db.from('voice_call_requests').select('id,metadata').eq('call_id',tenantRoute[3]).eq('owner_id',user.id).maybeSingle();
      if(error || !data) fail(404,'ไม่พบคำขอโทรในบัญชีนี้');
      if(data.metadata?.voice_account_id!==connection.account_id)fail(403,'สายนี้ใช้บัญชี Voice Bot อีกบัญชี กรุณาเชื่อมบัญชีเดิม');
      ownedCall=data;
    }
    const result = await upstream(target.pathname + target.search);
    if(path==='/me' && result._id!==connection.account_id)fail(403,'บัญชี Voice Bot เปลี่ยนแล้ว กรุณาเชื่อมใหม่');
    if(ownedCall && typeof result.status==='string') {
      if(result.call_id!==tenantRoute[3]) fail(502,'Call ID จากบริการไม่ตรงกับคำขอ');
      const {error}=await db.from('voice_call_requests').update({status:result.status}).eq('id',ownedCall.id).eq('owner_id',user.id);
      if(error) result.persistence_warning='อ่านสถานะล่าสุดแล้ว แต่บันทึกไม่ได้';
    }
    send(200, path === '/me' ? pick(result, ['_id','username','role','permissions','email','verified']) : clean(result));
  } catch (error) { send(error instanceof HttpError ? error.status : 503, { error: error instanceof HttpError ? error.message : 'เชื่อมต่อบริการไม่ได้ กรุณาลองใหม่', ...(error instanceof HttpError && error.code ? { code: error.code } : {}) }); }
}
