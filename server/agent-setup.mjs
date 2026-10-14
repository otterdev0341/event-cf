import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { callbackConfigured } from './callback.mjs';
import { connectedTranscriptTool, compatibleTranscriptTool, withTranscriptPrompt, transcriptToolPayload } from './transcript.mjs';
import { connectedGeneralTool, compatibleGeneralTool, withGeneralPrompt, generalToolPayload, generalEndpoint, generalReceptionProfile, validateGeneralReception, generalGreeting } from './general-events.mjs';

const start = '[VOICE_CONFIRM_RESULT_SETUP_V1]';
const end = '[/VOICE_CONFIRM_RESULT_SETUP_V1]';
const fields = ['request_id','agent_id','call_result','needs_agent','evidence'];
const outcomes = ['CONFIRMED','DECLINED','CALLBACK_REQUESTED','REQUEST_AGENT','WRONG_PERSON','UNDETERMINED'];
const split = value => (value || '').split(',').map(s => s.trim()).filter(Boolean);
export const isSetupAdmin = (user, env) => Boolean(user.email_confirmed_at && (
  split(env.VOICE_ADMIN_USER_IDS).includes(user.id) || split(env.VOICE_ADMIN_EMAILS).some(email => email.toLowerCase() === user.email?.toLowerCase())
));
const configOf = agent => Object.fromEntries(['bot_name','agent_data','voice_data','transfer','webhook','agent_id'].filter(k => agent[k] !== undefined).map(k => [k,agent[k]]));
const sorted = x => Array.isArray(x) ? x.map(sorted) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k,sorted(x[k])])) : x;
export const setupRevision = agent => createHash('sha256').update(JSON.stringify(sorted(configOf(agent)))).digest('hex');
function receiverUrl(env) {
  try {
    const url = new URL(env.VOICE_RESULT_CALLBACK_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/api/voice-result') return null;
    return url.href;
  } catch { return null; }
}
function compatibleTool(tool, agentId, endpoint, accountId) {
  const p = tool.parameters;
  const types = p?.properties;
  const restriction = types?.agent_id?.enum;
  return (!accountId || tool.description?.includes('Voice Confirm account:'+accountId+' v2')) && tool.status === 'active' && tool.tool_type === 'http' && tool.execution?.method === 'POST' && tool.execution?.endpoint === endpoint &&
    tool.execution?.auth?.type === 'bearer' && tool.execution.auth.has_api_key === true && (!tool.execution.auth.header_name || tool.execution.auth.header_name.toLowerCase() === 'authorization') &&
    p.type === 'object' && p.required?.length === fields.length && fields.every(k => p.required?.includes(k) && tool.execution.param_map?.[k]?.in === 'body' && (tool.execution.param_map[k].key || k) === k) &&
    fields.every(k => types?.[k]) && types.request_id.type === 'string' && types.agent_id.type === 'string' &&
    (!restriction || restriction.length === 1 && restriction[0] === agentId) && types.call_result.type === 'string' &&
    outcomes.every(k => types.call_result.enum?.includes(k)) && types.needs_agent.type === 'boolean' && types.evidence.type === 'string';
}
export function connectedTool(agent, tools, endpoint, accountId) {
  const prompt = agent.agent_data?.system_instruction || '';
  return Array.isArray(tools) && tools.find(t => compatibleTool(t,agent.agent_id,endpoint,accountId) &&
    agent.agent_data?.tools?.some(binding => binding.tool_id === t.tool_id && binding.tools_name === t.name) &&
    prompt.includes('{{vc_call_reference}}') && prompt.includes(t.name) && prompt.includes(agent.agent_id));
}
function promptBlock(id, name) {
  return `${start}\nระบบส่งรหัสอ้างอิงสายนี้ให้เป็น {{vc_call_reference}} ห้ามอ่านรหัสนี้ให้ผู้รับฟัง ห้ามสร้างหรือเปลี่ยนรหัส และห้ามใช้รหัสผู้สมัครหรือเบอร์โทรแทน\nเมื่อได้ข้อสรุปจากคำพูดจริงของผู้รับแล้ว ก่อนจบการสนทนาและก่อนเรียก end_call ให้เรียก ${name} โดยส่ง JSON 5 ฟิลด์:\nrequest_id: ใช้ vc_call_reference ของสายนี้ตรงตัว\nagent_id: ${id}\ncall_result: CONFIRMED (ตกลง), DECLINED (ปฏิเสธ), CALLBACK_REQUESTED (ขอให้โทรกลับ), REQUEST_AGENT (ขอเจ้าหน้าที่), WRONG_PERSON (ผิดคน), UNDETERMINED (ยังสรุปไม่ได้) ห้ามเดาผลจากการโทรติด และห้ามใช้ NO_ANSWER ขณะกำลังสนทนา\nneeds_agent: JSON boolean true เมื่อต้องการเจ้าหน้าที่, false เมื่อทราบชัดว่าไม่ต้องการ, null เมื่อยังไม่ทราบ ห้ามใช้ข้อความ "true", "false" หรือ "null"\nevidence: คำพูดจริงสั้น ๆ ที่รองรับผล หรือเหตุผลที่ยังสรุปไม่ได้ ห้ามแต่งคำตอบ\nส่งผลสุดท้ายหนึ่งครั้ง ถือว่าสำเร็จเมื่อได้รับ received: true หาก HTTP 400 ให้แก้เฉพาะฟิลด์ที่ API ระบุโดยใช้ข้อมูลจริง หาก timeout, HTTP 503 หรือ 409 Concurrent update/Call not yet persisted ให้ลอง payload เดิมอีกไม่เกิน 2 ครั้ง\nหากรหัสยังเป็น placeholder หรือไม่ใช่ UUID ห้ามเรียก Tool และห้ามอ้างว่าบันทึกสำเร็จ การบันทึกคำขอเจ้าหน้าที่ไม่ใช่การโอนสายหรือการแจ้งเจ้าหน้าที่อัตโนมัติ\nคำสั่งนี้กำหนดวิธีส่งผลแทนตัวอย่างบันทึก Backend ใน Prompt เดิม\n${end}`;
}
function withPrompt(agent, name, fail) {
  const previous = agent.agent_data?.system_instruction;
  if (typeof previous !== 'string' || !previous.trim() || !agent.bot_name) fail(409,'Agent ต้องมีบทสนทนาก่อนเชื่อมระบบรับผล');
  const hasStart = previous.includes(start), hasEnd = previous.includes(end);
  if (hasStart !== hasEnd || previous.split(start).length > 2 || previous.split(end).length > 2 || hasStart && previous.indexOf(end) < previous.indexOf(start)) fail(409,'ส่วนส่งผลใน Prompt ไม่สมบูรณ์ กรุณาตรวจใน Voice Bot ก่อน');
  const auth = agent.webhook?.auth;
  if (agent.webhook?.enabled && auth?.type && auth.type !== 'none' && !auth.token && !auth.api_key) fail(409,'Agent นี้มีคีย์ Webhook ที่บริการไม่เปิดให้อ่าน กรุณาตั้ง Tool ผ่าน Voice Bot เพื่อรักษาคีย์เดิม');
  const block = promptBlock(agent.agent_id,name);
  const prompt = hasStart ? previous.slice(0,previous.indexOf(start)) + block + previous.slice(previous.indexOf(end)+end.length) : previous+'\n\n'+block;
  if (prompt.length > 60000) fail(409,'Prompt ยาวเกินไปสำหรับการเชื่อมอัตโนมัติ');
  return prompt;
}
function toolPayload(id, env, endpoint, accountId) {
  return {name:(accountId?'vc_result_v2_':'vc_result_')+id.slice(4),description:(accountId?'Voice Confirm account:'+accountId+' v2. ':'')+'Save the final recipient response for Voice Confirm before ending the call. Use the provided vc_call_reference; never invent results.',tool_type:'http',status:'active',parameters:{type:'object',properties:{
    request_id:{type:'string',description:'Exact system-provided vc_call_reference UUID; never invent'},
    agent_id:{type:'string',enum:[id]}, call_result:{type:'string',enum:outcomes},
    needs_agent:{type:'boolean',nullable:true,description:'JSON true, false or null, never quoted strings'},
    evidence:{type:'string',minLength:1,maxLength:2000,description:'Actual recipient words supporting the final response'}
  },required:fields},execution:{method:'POST',endpoint,auth:{type:'bearer',header_name:'Authorization',scheme:'Bearer',api_key:env.VOICE_RESULT_CALLBACK_SECRET},param_map:Object.fromEntries(fields.map(k => [k,{in:'body',key:k}])),headers:{'Content-Type':'application/json'},timeout:20}};
}

export async function handleAgentSetup({id,method,body,user,env,connection,upstream,fail,send,deadline,transcript=false,general=false}) {
  const isConnected = general ? (agent,tools,endpoint,account) => connectedGeneralTool(agent,tools,endpoint,account,user.id) : transcript ? connectedTranscriptTool : connectedTool;
  const compatible = general ? (tool,agent,endpoint,account) => compatibleGeneralTool(tool,agent,endpoint,account,user.id) : transcript ? compatibleTranscriptTool : compatibleTool;
  let reception;
  const extendPrompt = general ? (agent,name,fail) => withGeneralPrompt(agent,name,fail,reception) : transcript ? withTranscriptPrompt : withPrompt;
  const makeTool = general ? (id,env,endpoint,account) => generalToolPayload(id,env,endpoint,account,user.id) : transcript ? transcriptToolPayload : toolPayload;
  const accountId=connection?.account_id;
  const canManage = connection?connection.owner_id===user.id&&Boolean(user.email_confirmed_at):isSetupAdmin(user,env);
  if (general && (!connection || (await upstream('/me'))._id !== accountId)) fail(403,'บัญชี Voice Bot ไม่ตรงกับบัญชีที่เชื่อม');
  if (method === 'POST' && !canManage) fail(403,'เฉพาะผู้ดูแลที่กำหนดไว้เท่านั้นที่เชื่อม Agent ได้');
  if (method === 'POST' && (!body || Array.isArray(body) || Object.keys(body).some(k => !(general ? ['confirm','expected_revision','reception'] : ['confirm','expected_revision']).includes(k)) || body.confirm !== true || !/^[0-9a-f]{64}$/.test(body.expected_revision || ''))) fail(400,'กรุณาตรวจ Agent และยืนยันการเชื่อมต่อ');
  if (general && method === 'POST' && body.reception !== undefined) reception = validateGeneralReception(body.reception,fail);
  const agents = await upstream('/agents');
  if (!Array.isArray(agents) || !agents.some(a => a.agent_id === id)) fail(403,'ไม่มีสิทธิ์เชื่อม Agent นี้');
  const endpoint = general ? generalEndpoint(env) : receiverUrl(env);
  const configured = Boolean(callbackConfigured(env) && endpoint);
  let agent = await upstream('/agents/'+id);
  if (agent.agent_id !== id) fail(502,'Agent ที่บริการส่งกลับไม่ตรงกับคำขอ');
  if (general && !reception) reception = generalReceptionProfile(agent);
  let tools = await upstream('/platform-config/tools');
  if (!Array.isArray(tools)) fail(502,'อ่านรายการ Tool ไม่สำเร็จ');
  const status = (value, list) => ({agent_id:id,agent_name:value.bot_name,revision:setupRevision(value),can_manage:canManage,configured,connected:Boolean(endpoint && isConnected(value,list,endpoint,accountId)),...(general ? {reception:generalReceptionProfile(value)} : {})});
  if (method === 'GET') return send(200,status(agent,tools));
  if (!configured) fail(503,'ผู้ดูแลยังตั้งค่า URL หรือระบบรับผลไม่ครบ');
  if (setupRevision(agent) !== body.expected_revision) fail(409,'Agent ถูกแก้ไขแล้ว กรุณาตรวจสถานะใหม่ก่อนเชื่อม');
  const connected = isConnected(agent,tools,endpoint,accountId);
  const currentPrompt = agent.agent_data?.system_instruction ?? agent.agent_data?.system_prompt;
  if (connected && (!general || currentPrompt === extendPrompt(agent,connected.name,fail) && (!body.reception || agent.agent_data.greeting_text === generalGreeting(reception)))) return send(200,{...status(agent,tools),already_connected:true});
  // Abort before creating a tool if the prompt cannot safely be extended.
  extendPrompt(agent,(general?'vc_events_v1_':'vc_result_')+id.slice(4),fail);
  const db = createClient(env.SUPABASE_URL || env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init) => fetch(url,{...init,signal:AbortSignal.any([deadline,AbortSignal.timeout(10000)])})}});
  const operation = randomUUID();
  const {data:locked,error:lockError} = await db.rpc('acquire_voice_agent_setup',{p_agent_id:id,p_lock_id:operation,...(accountId?{p_account_id:accountId}:{})});
  if (lockError) fail(503,'ยังไม่ได้ติดตั้งระบบเก็บการตั้งค่า Agent หรือฐานข้อมูลไม่พร้อม');
  if (locked !== true) fail(409,'มีผู้ดูแลกำลังเชื่อม Agent นี้ กรุณารอสักครู่แล้วตรวจสถานะใหม่');
  let audited = false, tool, response;
  try {
    agent = await upstream('/agents/'+id);
    if (setupRevision(agent) !== body.expected_revision) fail(409,'Agent ถูกแก้ไขแล้ว กรุณาตรวจสถานะใหม่');
    const {error} = await db.from('voice_agent_setup_audits').insert({id:operation,actor_id:user.id,agent_id:id,...(accountId?{account_id:accountId}:{}),before_config:configOf(agent),status:'started'});
    if (error) fail(503,'เก็บการตั้งค่าก่อนแก้ไม่สำเร็จ กรุณาลองใหม่');
    audited = true;
    tools = await upstream('/platform-config/tools');
    const desired = makeTool(id,env,endpoint,accountId);
    const named = tools.filter(t => t.name === desired.name);
    if (named.length > 1 || named.length === 1 && !compatible(named[0],id,endpoint,accountId)) fail(409,'ชื่อ Tool สำหรับ Agent นี้มีการตั้งค่าอื่นอยู่ กรุณาตรวจใน Voice Bot');
    tool = named[0] || tools.find(t => compatible(t,id,endpoint,accountId));
    if (!tool) {
      // No blind retry on an uncertain creation; the next request rechecks the stored tools.
      await upstream('/platform-config/tools',desired,'POST');
      tools = await upstream('/platform-config/tools');
      const created = tools.filter(t => t.name === desired.name && compatible(t,id,endpoint,accountId));
      if (created.length !== 1) fail(502,'ยังยืนยัน Tool ที่สร้างไม่ได้ กรุณาตรวจสถานะใหม่ก่อนลองอีกครั้ง');
      tool = created[0];
    }
    const latest = await upstream('/agents/'+id);
    if (setupRevision(latest) !== body.expected_revision) fail(409,'Agent ถูกแก้ไขระหว่างเชื่อม Tool กรุณาตรวจสถานะใหม่');
    const payload = configOf(latest);
    const promptKey = general && latest.agent_data?.system_instruction === undefined ? 'system_prompt' : 'system_instruction';
    payload.agent_data = {...latest.agent_data,[promptKey]:extendPrompt(latest,tool.name,fail),...(general && body.reception ? {greeting_text:generalGreeting(reception)} : {}),tools:[...(latest.agent_data.tools || []).filter(t => t.tool_id !== tool.tool_id),{tools_name:tool.name,tool_id:tool.tool_id}]};
    await upstream('/agent/create_update_agent',payload,'PUT');
    const verified = await upstream('/agents/'+id);
    if (setupRevision(verified) !== setupRevision(payload) || !isConnected(verified,tools,endpoint,accountId)) fail(502,'บริการยังไม่ยืนยันการเชื่อม Agent กรุณาตรวจสถานะใหม่');
    const {error:auditError} = await db.from('voice_agent_setup_audits').update({status:'connected',tool_id:tool.tool_id,completed_at:new Date().toISOString()}).eq('id',operation);
    response = {...status(verified,tools),...(auditError?{warning:'เชื่อมสำเร็จ แต่บันทึกประวัติการแก้ไขไม่ครบ'}:{})};
  } catch (error) {
    if (audited) await db.from('voice_agent_setup_audits').update({status:'failed',tool_id:tool?.tool_id || null,completed_at:new Date().toISOString()}).eq('id',operation);
    throw error;
  } finally {
    await db.from('voice_agent_setup_locks').delete().eq('agent_id',id).eq('account_id',accountId||'legacy').eq('lock_id',operation);
  }
  // Finish cleanup before ending the response; serverless runtimes may stop work after res.end.
  return send(200,response);
}
