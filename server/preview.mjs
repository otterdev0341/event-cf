import { randomUUID } from 'node:crypto';
import { promptVariables } from '../shared/campaign-inputs.mjs';

// Tokens are scoped to one web session. The saved Voice Bot credential never leaves this server.
export async function handlePreview({ id, body, upstream, connection, fail, send }) {
  const account = await upstream('/me');
  if (account._id !== connection.account_id) fail(403, 'บัญชี Voice Bot เปลี่ยนไป กรุณาเชื่อมบัญชีใหม่');
  const agents = await upstream('/agents');
  if (!Array.isArray(agents) || !agents.some(agent => agent.agent_id === id)) fail(403, 'ไม่มีสิทธิ์ทดสอบ Agent นี้');
  const detail = await upstream(`/agents/${id}`);
  const required = promptVariables(detail);
  const values = body?.variables;
  const outputs = body?.outputs;
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Array.isArray(outputs)
    || required.length > 50 || Object.keys(values).length > 50 || outputs.length > 50
    || Object.entries(values).some(([key, value]) => !required.includes(key) || ['__proto__', 'constructor', 'prototype'].includes(key) || typeof value !== 'string' || value.length > 2000)
    || outputs.some(key => typeof key !== 'string' || !required.includes(key))
    || required.some(key => !outputs.includes(key) && !values[key]?.trim())) fail(400, 'กรุณาดึงตัวแปรล่าสุดและกรอกข้อมูลทดสอบให้ครบ');
  const variables = Object.fromEntries(required.map(key => [key, outputs.includes(key) ? '' : values[key].trim()]));
  // A preview has its own reference and cannot overwrite a campaign call result.
  variables.vc_call_reference = randomUUID();
  variables.vc_record_conversation = 'false';
  const replace = text => String(text || '').replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => Object.hasOwn(variables, key) ? variables[key] : match);
  const data = detail.agent_data || {};
  const voice = detail.voice_data || {};
  const live = data.engine_type === 'voice2voice' || data.select_agent === 'gemini_live' || /live/i.test(data.model || data.gemini_live_model || '');
  const config = {
    source: 'preview', variables, metadata: { variables },
    system_instruction: replace(data.system_instruction), greeting_text: replace(data.greeting_text),
    ...(live ? {
      engine_type: data.engine_type || 'voice2voice',
      gemini_model: data.model || data.gemini_live_model || 'gemini-3.1-flash-live-preview',
      llm_provider: data.llm_provider || 'gemini',
      gemini_system_instruction: replace(data.system_instruction),
      ...(data.gemini_voice_name ? { gemini_voice_name: data.gemini_voice_name } : {}),
      gemini_language_code: 'th-TH',
    } : {
      interruptible: voice.interruptible === true,
      asr_config: JSON.stringify({ asr_provider: voice.asrProvider || voice.asr_provider || 'botnoi-aws-th-noise-classifier-v17c', asr_language_code: voice.languageCode || voice.language_code || 'th-TH', timeout: 60, asr_vad_rules: { false_silence_sec: .1, true_silence_sec: .25, false_timeout_sec: 3, ...voice.asr_vad_rules } }),
      tts_config: JSON.stringify({ tts_provider: voice.ttsProvider || voice.tts_provider || 'botnoivoice', tts_params: { speaker: Number(voice.speakerCode || voice.speaker_code || 1), language: voice.languageCode_tts || voice.language_code_tts || 'th', speed: voice.speed || 1 } }),
      ...(data.llm_provider ? { llm_provider: data.llm_provider } : {}),
    }),
  };
  const token = await upstream('/call/tokens', { agent_id: id, channel: 'web' });
  if (typeof token?.ephemeral_token !== 'string' || !token.ephemeral_token) fail(502, 'บริการยังไม่ส่งสิทธิ์เริ่มบทสนทนา กรุณาลองใหม่');
  send(200, { ephemeral_token: token.ephemeral_token, websocket_url: 'wss://voicebot-ws-stg.botnoigroup.com/v1/call', input_variables: config, streaming_text: live });
}
