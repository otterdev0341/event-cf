import { matchingLogPath } from '../shared/call-results.mjs';
import { terminalCall } from '../shared/campaign-queue.mjs';
const audioPath=path=>typeof path==='string'&&/\.(wav|mp3|ogg|m4a|flac|webm)$/i.test(path);
export function recordingPath(files,call) {
  if(!Array.isArray(files))return null;
  const paths=files.filter(audioPath);
  const explicit=call.recording_file_path||call.audio_file_path;
  if(typeof explicit==='string'&&paths.includes(explicit))return explicit;
  const exact=paths.filter(path=>path.split(/[/.]/).includes(call.call_id));
  if(exact.length===1)return exact[0];
  const log=matchingLogPath(files,call);
  if(!log)return null;
  const paired=paths.filter(path=>path.replace(/\.[^.]+$/,'')===log.replace(/\.[^.]+$/,''));
  return paired.length===1?paired[0]:paired.length===0?log:null;
}
export function safeRecordingUrl(value) {
  try{const url=new URL(value);const host=url.hostname.toLowerCase();
    if(url.protocol!=='https:'||url.username||url.password||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||!host.includes('.')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.includes(':'))return null;
    if([...url.searchParams.keys()].some(k=>/^(access_token|authorization|api_key|jwt)$/i.test(k)))return null;
    return url.href;
  }catch{return null;}
}
export async function handleRecording({id,db,user,accountId,upstream,fail,send}) {
  const {data:record,error}=await db.from('voice_call_requests').select('id,call_id,agent_id,metadata').eq('id',id).eq('owner_id',user.id).maybeSingle();
  if(error||!record)fail(404,'ไม่พบคำขอโทรในบัญชีนี้');
  if(record.metadata?.voice_account_id!==accountId)fail(403,'ต้องเชื่อมบัญชี Voice Bot เดิมเพื่อฟังเสียงสายนี้');
  if(!record.call_id)return send(200,{state:'not_available',message:'ยังไม่มี Call ID จึงตรวจไฟล์เสียงไม่ได้'});
  const account=await upstream('/me');
  if(account._id!==accountId)fail(403,'บัญชี Voice Bot ไม่ตรงกับสายนี้');
  const call=await upstream(`/v1/provisioning/tenants/${encodeURIComponent(accountId)}/calls/${encodeURIComponent(record.call_id)}`);
  if(call.call_id!==record.call_id)fail(502,'Call ID จากบริการไม่ตรงกับคำขอ');
  if(!terminalCall(call.status))return send(200,{state:'pending',message:'สายยังไม่จบ กดตรวจเสียงอีกครั้งหลังจบสาย'});
  const files=await upstream(`/logs/list_file/?agent_id=${encodeURIComponent(record.agent_id)}`);
  const path=recordingPath(files,call);
  if(!path)return send(200,{state:'not_available',message:'บริการยังไม่มีไฟล์เสียงที่เชื่อมกับ Call ID นี้'});
  let result;
  try{result=await upstream(`/logs/audio_url?file_path=${encodeURIComponent(path)}`);}catch(error){if(/HTTP 404\b/.test(error.message))return send(200,{state:'not_available',message:'บริการมีบันทึกสายนี้ แต่ยังไม่มีไฟล์เสียง'});throw error;}
  const url=safeRecordingUrl(typeof result==='string'?result:result?.audio_url||result?.url||result?.download_url);
  if(!url)fail(502,'บริการยังไม่ส่งลิงก์เสียงที่ใช้งานได้ กรุณาตรวจอีกครั้ง');
  // Signed links are short-lived capabilities: return only on explicit request, never persist in the database.
  return send(200,{state:'available',url});
}
