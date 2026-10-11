// Only explicit provider output fields are accepted. Never classify CSV inputs or transcript keywords.
export const outcomeLabels = { CONFIRMED:'ตอบตกลง', DECLINED:'ปฏิเสธ', CALLBACK_REQUESTED:'ขอให้โทรกลับ', REQUEST_AGENT:'ขอคุยเจ้าหน้าที่', WRONG_PERSON:'ผิดคน', NO_ANSWER:'ไม่รับสาย', UNDETERMINED:'รอตรวจสอบ' };
export function providerOutcome(call, log) {
  for (const source of [log?.outputs, log?.result, log, call?.outputs, call?.result, call]) {
    if (!source || typeof source !== 'object') continue;
    const result = typeof source.call_result === 'string' ? source.call_result.trim().toUpperCase() : '';
    const needs = typeof source.needs_agent === 'boolean' ? source.needs_agent : null;
    if (Object.hasOwn(outcomeLabels,result) || needs !== null) return {call_result:Object.hasOwn(outcomeLabels,result)?result:'UNDETERMINED',needs_agent:needs,source:'provider'};
  }
  return {call_result:'UNDETERMINED',needs_agent:null,source:'unavailable'};
}
export function transcriptText(log) {
  const value = log?.text ?? log?.transcript ?? log?.messages;
  if (typeof value === 'string') return value.slice(0,100000);
  if (Array.isArray(value)) return value.map(m => typeof m === 'string' ? m : `${m.role || ''}: ${m.text || m.content || ''}`).join('\n').slice(0,100000);
  return '';
}
export function matchingLogPath(files, call) {
  if (!Array.isArray(files)) return null;
  const paths = files.filter(f=>typeof f === 'string');
  const explicit = call.transcript_file_path || call.log_file_path;
  if (typeof explicit === 'string' && paths.includes(explicit)) return explicit;
  if (typeof call.call_id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(call.call_id)) return null;
  const matches=paths.filter(p=>p.split(/[/.]/).includes(call.call_id));
  return matches.length===1 ? matches[0] : null;
}
export function effectiveOutcome(response) {
  return response?.review ? {...response.review,source:'manual'} : response?.callback?.outcome || response?.followup?.outcome || {call_result:'UNDETERMINED',needs_agent:null,source:'unavailable'};
}
export function resultsCsv(headers, rows) {
  const cell = value => {
    let text=String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  return '\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
