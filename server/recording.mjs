import { matchingLogPath } from '../shared/call-results.mjs';
import { terminalCall } from '../shared/campaign-queue.mjs';
import { audioEntries, logFileListPath, streamWav } from './audio-library.mjs';
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
  return paired.length===1?paired[0]:paired.length===0&&/\.txt$/i.test(log)?log.replace(/\.txt$/i,'.wav'):null;
}
export function safeRecordingUrl(value) {
  try{const url=new URL(value);const host=url.hostname.toLowerCase();
    if(url.protocol!=='https:'||url.username||url.password||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||!host.includes('.')||/^\d+\.\d+\.\d+\.\d+$/.test(host)||host.includes(':'))return null;
    if([...url.searchParams.keys()].some(k=>/^(access_token|authorization|api_key|jwt)$/i.test(k)))return null;
    return url.href;
  }catch{return null;}
}
export async function handleRecording({id,db,user,accountId,upstream,logsFetch,fail,send,res,binary=false}) {
  const {data:record,error}=await db.from('voice_call_requests').select('id,call_id,agent_id,metadata,created_at').eq('id',id).eq('owner_id',user.id).maybeSingle();
  if(error||!record)fail(404,'ไม่พบคำขอโทรในบัญชีนี้');
  if(record.metadata?.voice_account_id!==accountId)fail(403,'ต้องเชื่อมบัญชี Voice Bot เดิมเพื่อฟังเสียงสายนี้');
  if(!record.call_id)return send(200,{state:'not_available',message:'ยังไม่มี Call ID จึงตรวจไฟล์เสียงไม่ได้'});
  const account=await upstream('/me');
  if(account._id!==accountId)fail(403,'บัญชี Voice Bot ไม่ตรงกับสายนี้');
  const call=await upstream(`/v1/provisioning/tenants/${encodeURIComponent(accountId)}/calls/${encodeURIComponent(record.call_id)}`);
  if(call.call_id!==record.call_id)fail(502,'Call ID จากบริการไม่ตรงกับคำขอ');
  if(!terminalCall(call.status))return send(200,{state:'pending',message:'สายยังไม่จบ กดตรวจเสียงอีกครั้งหลังจบสาย'});
  const date=Date.parse(call.created_at||record.created_at);
  if(!Number.isFinite(date))fail(502,'บริการไม่ระบุวันที่ของสายนี้');
  const range={start:new Date(date-86400000).toISOString().slice(0,10),end:new Date(date+86400000).toISOString().slice(0,10)};
  const listing=await logsFetch(logFileListPath(record.agent_id,range));
  if(!listing.ok)fail(502,`บริการรายการเสียงตอบกลับ HTTP ${listing.status}`);
  const files=await listing.json();
  const entries=audioEntries(files,record.agent_id,range);
  const ownedPaths=entries.map(entry=>entry.path);
  const ownedLogs=Array.isArray(files)?files.filter(path=>typeof path==='string'&&ownedPaths.includes(path.replace(/\.txt$/i,'.wav'))):[];
  const path=recordingPath([...ownedPaths,...ownedLogs],call);
  if(!path)return send(200,{state:'not_available',message:'บริการยังไม่มีไฟล์เสียงที่เชื่อมกับ Call ID นี้'});
  if(binary)return streamWav(await logsFetch('/logs/audio?'+new URLSearchParams({file_path:path})),res,fail);
  return send(200,{state:'available',playback_path:`/workspace/calls/${id}/recording-audio`});
}
