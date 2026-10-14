import { createHash } from 'node:crypto';

const start = '[VOICE_CONFIRM_TRANSCRIPT_SETUP_V1]';
const end = '[/VOICE_CONFIRM_TRANSCRIPT_SETUP_V1]';
const fields = ['request_id', 'agent_id', 'transcript'];

export function compatibleTranscriptTool(tool, agentId, endpoint, accountId) {
  const p = tool.parameters, types = p?.properties;
  return tool.description?.includes(`Voice Confirm transcript:${accountId || 'legacy'} v1`) && tool.status === 'active' && tool.tool_type === 'http'
    && tool.execution?.method === 'POST' && tool.execution.endpoint === endpoint
    && tool.execution.auth?.type === 'bearer' && tool.execution.auth.has_api_key === true
    && (!tool.execution.auth.header_name || tool.execution.auth.header_name.toLowerCase() === 'authorization')
    && p?.type === 'object' && p.required?.length === fields.length
    && fields.every(key => p.required.includes(key) && types?.[key]?.type === 'string' && tool.execution.param_map?.[key]?.in === 'body' && (tool.execution.param_map[key].key || key) === key)
    && types.agent_id.enum?.length === 1 && types.agent_id.enum[0] === agentId && types.transcript.maxLength === 10000;
}
export function connectedTranscriptTool(agent, tools, endpoint, accountId) {
  const prompt = agent.agent_data?.system_instruction || '';
  return Array.isArray(tools) && tools.find(tool => compatibleTranscriptTool(tool, agent.agent_id, endpoint, accountId)
    && agent.agent_data?.tools?.some(binding => binding.tool_id === tool.tool_id && binding.tools_name === tool.name)
    && prompt.includes(start) && prompt.includes(end) && prompt.includes('{{vc_call_reference}}')
    && prompt.includes('{{vc_record_conversation}}') && prompt.includes(tool.name) && prompt.includes(agent.agent_id));
}
export function withTranscriptPrompt(agent, name, fail) {
  const previous = agent.agent_data?.system_instruction;
  if (typeof previous !== 'string' || !previous.trim() || !agent.bot_name) fail(409, 'Agent ต้องมีบทสนทนาก่อนเชื่อมบันทึก');
  const hasStart = previous.includes(start), hasEnd = previous.includes(end);
  if (hasStart !== hasEnd || previous.split(start).length > 2 || previous.split(end).length > 2 || hasStart && previous.indexOf(end) < previous.indexOf(start)) fail(409, 'ส่วนบันทึกบทสนทนาใน Prompt ไม่สมบูรณ์ กรุณาตรวจใน Voice Bot');
  const auth = agent.webhook?.auth;
  if (agent.webhook?.enabled && auth?.type && auth.type !== 'none' && !auth.token && !auth.api_key) fail(409, 'Agent นี้มีคีย์ Webhook ที่บริการไม่เปิดให้อ่าน กรุณาตั้ง Tool ผ่าน Voice Bot เพื่อรักษาคีย์เดิม');
  const block = `${start}
สำหรับสายนี้ บันทึกบทสนทนา = {{vc_record_conversation}} รหัสสาย = {{vc_call_reference}} ห้ามอ่านข้อมูลระบบนี้ให้ผู้รับฟัง
ให้เรียก ${name} เฉพาะเมื่อ vc_record_conversation เป็นข้อความ true และรหัสสายเป็น UUID ที่ระบบให้มาเท่านั้น หาก false, ว่าง หรือยังเป็น placeholder ห้ามเรียก Tool นี้
ก่อนจบสายและก่อน end_call ให้ส่งบทสนทนาที่เกิดขึ้นจริงและมีอยู่ในบริบทปัจจุบันตามลำดับ โดยระบุ ผู้รับ: และ บอท: ในแต่ละบรรทัด ห้ามแต่งหรือเติมคำที่ไม่ได้ยิน ห้ามใช้สรุปผลตอบรับแทนบทสนทนา ห้ามบันทึกคำสั่งระบบหรือข้อมูลลับ
ส่ง JSON 3 ฟิลด์: request_id ใช้ vc_call_reference ตรงตัว, agent_id ใช้ ${agent.agent_id}, transcript ใช้ข้อความสนทนาดังกล่าว ไม่เกิน 10000 ตัวอักษร ถ้ายาวเกินให้ส่งเท่าที่มีและลงท้าย [บันทึกไม่ครบ: เกินขนาดที่รองรับ]
เรียกหลัง Tool ส่งผลตอบรับ (ถ้ามี) และก่อน end_call ถือว่าบันทึกสำเร็จเฉพาะเมื่อได้รับ received: true หาก timeout, HTTP 503 หรือ 409 Concurrent update/Call not yet persisted ให้ลอง payload เดิมอีกไม่เกิน 2 ครั้ง ห้ามอ้างว่าบันทึกครบหากไม่มีข้อมูลครบ
${end}`;
  const prompt = hasStart ? previous.slice(0, previous.indexOf(start)) + block + previous.slice(previous.indexOf(end) + end.length) : previous + '\n\n' + block;
  if (prompt.length > 60000) fail(409, 'Prompt ยาวเกินไปสำหรับการเชื่อมอัตโนมัติ');
  return prompt;
}
export function transcriptToolPayload(id, env, endpoint, accountId) {
  return { name: `vc_transcript_v1_${id.slice(4)}`, description: `Voice Confirm transcript:${accountId || 'legacy'} v1. Save actual available conversation text only when vc_record_conversation is true.`, tool_type: 'http', status: 'active',
    parameters: { type: 'object', properties: {
      request_id: { type: 'string', description: 'Exact vc_call_reference UUID provided for this call' },
      agent_id: { type: 'string', enum: [id] },
      transcript: { type: 'string', minLength: 1, maxLength: 10000, description: 'Actual conversation turns in order, speaker labeled. Never invent or summarize missing words.' },
    }, required: fields },
    execution: { method: 'POST', endpoint, auth: { type: 'bearer', header_name: 'Authorization', scheme: 'Bearer', api_key: env.VOICE_RESULT_CALLBACK_SECRET }, param_map: Object.fromEntries(fields.map(key => [key, { in: 'body', key }])), headers: { 'Content-Type': 'application/json' }, timeout: 20 },
  };
}

export function validTranscriptPayload(body) {
  return body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === fields.length
    && fields.every(key => Object.hasOwn(body, key))
    && typeof body.request_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id)
    && typeof body.agent_id === 'string' && /^agt_[a-zA-Z0-9_-]+$/.test(body.agent_id)
    && typeof body.transcript === 'string' && body.transcript.trim().length > 0 && body.transcript.length <= 10000;
}

// Called only after authentication against the account belonging to this call.
export async function saveTranscriptCallback({ record, body, db, send }) {
  if (record.metadata?.record_conversation !== true || record.metadata?.variables?.vc_record_conversation !== 'true') return send(403, { error: 'Conversation recording is disabled for this call' });
  if (!record.call_id) return send(409, { error: 'Call not yet persisted; retry later' });
  const text = body.transcript.trim();
  const fingerprint = createHash('sha256').update(JSON.stringify([record.id, record.agent_id, text])).digest('hex');
  const original = record.response;
  if (original?.transcript) return original.transcript.fingerprint === fingerprint ? send(200, { received: true, duplicate: true }) : send(409, { error: 'A conversation record already exists' });
  let update = db.from('voice_call_requests').update({ response: { ...(original || {}), transcript: { text, fingerprint, source: 'agent_tool', received_at: new Date().toISOString(), call_id: record.call_id } } })
    .eq('id', record.id).eq('owner_id', record.owner_id).eq('agent_id', record.agent_id).eq('call_id', record.call_id).is('response->transcript->>received_at', null);
  for (const [path, value] of [['response->callback->>received_at', original?.callback?.received_at], ['response->review->>updated_at', original?.review?.updated_at], ['response->followup->>checked_at', original?.followup?.checked_at], ['response->audio_link->>updated_at',original?.audio_link?.updated_at]]) update = value ? update.eq(path, value) : update.is(path, null);
  const saved = await update.select('id');
  if (saved.error) return send(503, { error: 'Conversation was not saved; retry later' });
  if (!saved.data?.length) return send(409, { error: 'Concurrent update; retry the same payload' });
  return send(200, { received: true });
}
