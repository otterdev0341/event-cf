import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const maxAudioBytes = 64 * 1024 * 1024;
const filePattern = /^(agt_[a-zA-Z0-9_-]+)\/(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(\d+)\.(txt|wav)$/i;
export function audioDateRange(query, fail) {
  const start = query.get('start_date'), end = query.get('end_date');
  const valid = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
  if (!valid(start) || !valid(end) || end < start || (Date.parse(end)-Date.parse(start))/86400000 > 30) fail(400, 'เลือกช่วงวันที่ไม่เกิน 31 วัน');
  return { start, end };
}
export function audioEntries(files, agentId, range) {
  if (!Array.isArray(files)) return [];
  const unique = new Map();
  for (const path of files) {
    if (typeof path !== 'string' || path.length > 400) continue;
    const match = path.match(filePattern);
    if (!match || match[1] !== agentId || match[2] < range.start || match[2] > range.end || !Number.isSafeInteger(Number(match[5]))) continue;
    const audioPath = path.replace(/\.txt$/i, '.wav');
    const id = createHash('sha256').update(audioPath).digest('hex');
    unique.set(id, { id, file_time: match[2]+' '+match[3].replaceAll('-',':'), part: Number(match[5]), path: audioPath });
  }
  return [...unique.values()].sort((a,b) => b.file_time.localeCompare(a.file_time) || a.part-b.part || a.id.localeCompare(b.id));
}
export function logFileListPath(agentId, range) {
  return '/logs/list_file/?'+new URLSearchParams({ agent_id:agentId, start_date:range.start.replaceAll('-','/'), end_date:range.end.replaceAll('-','/') });
}
export async function streamWav(response, res, fail) {
  if (response.status === 404) fail(404, 'บันทึกนี้ยังไม่มีไฟล์เสียง');
  if (!response.ok) fail(502, `บริการเสียงตอบกลับ HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length'));
  if (length > maxAudioBytes) { await response.body?.cancel(); fail(413, 'ไฟล์เสียงนี้มีขนาดเกินที่เว็บรองรับ'); }
  if (!response.body) fail(502, 'บริการไม่ส่งไฟล์เสียง');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(()=>{}); };
  res.once('close',cancel);
  let head = Buffer.alloc(0);
  try {
    while (head.length < 12) { const chunk=await reader.read(); if (chunk.done) break; head=Buffer.concat([head,Buffer.from(chunk.value)]); }
    if (head.subarray(0,4).toString() !== 'RIFF' || head.subarray(8,12).toString() !== 'WAVE') fail(502, 'บริการส่งข้อมูลที่ไม่ใช่ไฟล์เสียง WAV');
    if (head.length > maxAudioBytes) fail(413, 'ไฟล์เสียงนี้มีขนาดเกินที่เว็บรองรับ');
    res.statusCode=200; res.setHeader('Content-Type','audio/wav'); res.setHeader('Cache-Control','private, no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Disposition','inline; filename="voice-recording.wav"');
    const chunks = async function* () { let total=head.length; yield head; while (true) { const chunk=await reader.read(); if (chunk.done) break; total+=chunk.value.length; if (total>maxAudioBytes) throw Error('Audio size limit'); yield Buffer.from(chunk.value); } };
    await pipeline(Readable.from(chunks()),res);
  } finally { res.removeListener('close',cancel); await reader.cancel().catch(()=>{}); }
}
export async function handleAudioLibrary({ agentId, fileId, query, accountId, upstream, logsFetch, fail, send, res }) {
  const range = audioDateRange(query,fail);
  const me = await upstream('/me');
  if (me._id !== accountId) fail(403, 'บัญชี Voice Bot ไม่ตรงกับบัญชีที่เชื่อม');
  const agents = await upstream('/agents');
  if (!Array.isArray(agents) || !agents.some(agent => agent.agent_id === agentId)) fail(403, 'ไม่มีสิทธิ์ฟังบันทึกของ Agent นี้');
  const response = await logsFetch(logFileListPath(agentId,range));
  if (!response.ok) fail(502, `บริการรายการเสียงตอบกลับ HTTP ${response.status}`);
  const entries = audioEntries(await response.json(),agentId,range);
  if (!fileId) return send(200, { items:entries.slice(0,100).map(({path,...item})=>item), has_more:entries.length>100, total:entries.length, start_date:range.start, end_date:range.end });
  const selected = entries.find(entry => entry.id === fileId);
  if (!selected) fail(404, 'ไม่พบบันทึกเสียงใน Agent และช่วงวันที่นี้');
  return streamWav(await logsFetch('/logs/audio?'+new URLSearchParams({file_path:selected.path})),res,fail);
}
