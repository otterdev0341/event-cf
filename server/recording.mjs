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
export async function handleRecording({id,db,user,accountId,upstream,logsFetch,fail,send,res,binary=false,method='GET',body}) {
  const {data:record,error}=await db.from('voice_call_requests').select('id,call_id,agent_id,metadata,response,created_at').eq('id',id).eq('owner_id',user.id).maybeSingle();
  if(error||!record)fail(404,'ไม่พบคำขอโทรในบัญชีนี้');
  if(record.metadata?.voice_account_id!==accountId)fail(403,'ต้องเชื่อมบัญชี Voice Bot เดิมเพื่อฟังเสียงสายนี้');
  if(!record.call_id){if(method==='POST')fail(400,'ยังไม่มี Call ID จึงบันทึกเสียงกับสายไม่ได้');return send(200,{state:'not_available',message:'ยังไม่มี Call ID จึงตรวจไฟล์เสียงไม่ได้'});}
  const account=await upstream('/me');
  if(account._id!==accountId)fail(403,'บัญชี Voice Bot ไม่ตรงกับสายนี้');
  const agents=await upstream('/agents');
  if(!Array.isArray(agents)||!agents.some(agent=>agent.agent_id===record.agent_id))fail(403,'Agent ของสายนี้ไม่อยู่ในบัญชีที่เชื่อม');
  if(method==='POST'&&(!body||body.confirm!==true||typeof body.recording_id!=='string'||!/^[a-f0-9]{64}$/.test(body.recording_id)||!(body.expected_link_at===null||typeof body.expected_link_at==='string')))fail(400,'กรุณาเลือกและยืนยันไฟล์เสียงของสายนี้');
  const call=await upstream(`/v1/provisioning/tenants/${encodeURIComponent(accountId)}/calls/${encodeURIComponent(record.call_id)}`);
  if(call.call_id!==record.call_id)fail(502,'Call ID จากบริการไม่ตรงกับคำขอ');
  if(!terminalCall(call.status)){if(method==='POST')fail(409,'สายยังไม่จบ กรุณาตรวจเสียงใหม่หลังจบสาย');return send(200,{state:'pending',message:'สายยังไม่จบ กดตรวจเสียงอีกครั้งหลังจบสาย'});}
  const date=Date.parse(call.created_at||record.created_at);
  if(!Number.isFinite(date))fail(502,'บริการไม่ระบุวันที่ของสายนี้');
  const range={start:new Date(date-86400000).toISOString().slice(0,10),end:new Date(date+86400000).toISOString().slice(0,10)};
  const listing=await logsFetch(logFileListPath(record.agent_id,range));
  if(!listing.ok)fail(502,`บริการรายการเสียงตอบกลับ HTTP ${listing.status}`);
  const files=await listing.json();
  const entries=audioEntries(files,record.agent_id,range);
  const ownedPaths=entries.map(entry=>entry.path);
  const ownedLogs=Array.isArray(files)?files.filter(path=>typeof path==='string'&&ownedPaths.includes(path.replace(/\.txt$/i,'.wav'))):[];
  const link=record.response?.audio_link;
  const linked=link?.account_id===accountId&&link?.agent_id===record.agent_id?entries.find(entry=>entry.id===link.recording_id):null;
  if(method==='POST') {
    if((link?.updated_at??null)!==body.expected_link_at)fail(409,'ไฟล์ที่เชื่อมถูกแก้ไขแล้ว กรุณาตรวจเสียงใหม่');
    const entry=entries.find(item=>item.id===body.recording_id);
    if(!entry)fail(400,'ไฟล์นี้ไม่อยู่ในรายการเสียงของ Agent และช่วงเวลาสายนี้');
    // Verify the listed TXT actually has a WAV before saving the user's association.
    const audio=await logsFetch('/logs/audio?'+new URLSearchParams({file_path:entry.path}));
    if(!audio.ok||!audio.body)fail(502,'บริการยังไม่มีไฟล์เสียงที่เปิดฟังได้');
    const reader=audio.body.getReader();let prefix=Buffer.alloc(0);
    try { while(prefix.length<12){const part=await reader.read();if(part.done)break;prefix=Buffer.concat([prefix,Buffer.from(part.value).subarray(0,12-prefix.length)]);} }
    finally {await reader.cancel().catch(()=>{});}
    if(prefix.length<12||prefix.toString('ascii',0,4)!=='RIFF'||prefix.toString('ascii',8,12)!=='WAVE')fail(502,'บริการไม่ได้ส่งไฟล์ WAV ที่ถูกต้อง');
    const audioLink={recording_id:entry.id,agent_id:record.agent_id,account_id:accountId,updated_at:new Date().toISOString(),linked_by:user.id,source:'manual'};
    let update=db.from('voice_call_requests').update({response:{...record.response,audio_link:audioLink}}).eq('id',id).eq('owner_id',user.id).eq('call_id',record.call_id);
    for(const [path,value] of [['response->audio_link->>updated_at',link?.updated_at],['response->callback->>received_at',record.response?.callback?.received_at],['response->review->>updated_at',record.response?.review?.updated_at],['response->followup->>checked_at',record.response?.followup?.checked_at],['response->transcript->>received_at',record.response?.transcript?.received_at]])update=value?update.eq(path,value):update.is(path,null);
    const {data:saved,error:writeError}=await update.select('id');
    if(writeError||!saved?.length)fail(409,'มีการอัปเดตพร้อมกัน กรุณาตรวจเสียงใหม่');
    return send(200,{state:'available',playback_path:`/workspace/calls/${id}/recording-audio`,source:'manual',linked_at:audioLink.updated_at});
  }
  const exactPath=recordingPath([...ownedPaths,...ownedLogs],call);
  const path=linked?.path||exactPath;
  if(!path) {
    if(binary)fail(404,'ยังไม่ได้เชื่อมไฟล์เสียงกับสายนี้');
    return send(200,{state:'not_available',message:'บริการยังไม่ระบุไฟล์ของ Call ID นี้ เลือกฟังและยืนยันไฟล์ที่ตรงกับสายก่อนบันทึก',agent_id:record.agent_id,range:{start_date:range.start,end_date:range.end},candidates:entries.slice(0,100).map(({path,...entry})=>entry),has_more:entries.length>100,linked_at:link?.updated_at??null});
  }
  if(binary)return streamWav(await logsFetch('/logs/audio?'+new URLSearchParams({file_path:path})),res,fail);
  return send(200,{state:'available',playback_path:`/workspace/calls/${id}/recording-audio`,source:linked?'manual':'provider',linked_at:link?.updated_at??null});
}
