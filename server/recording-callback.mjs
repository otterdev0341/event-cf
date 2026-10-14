import { createHash, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { accountRecordingSecret } from './connection.mjs';
import { audioEntries } from './audio-library.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=value=>createHash('sha256').update(value).digest();
const fields=['request_id','call_id','agent_id','file_path'];
const validBody=body=>body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===fields.length&&fields.every(key=>Object.hasOwn(body,key))&&typeof body.request_id==='string'&&uuid.test(body.request_id)&&typeof body.call_id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(body.call_id)&&typeof body.agent_id==='string'&&/^agt_[a-zA-Z0-9_-]{1,100}$/.test(body.agent_id)&&typeof body.file_path==='string'&&body.file_path.length<=400;

// A provider event explicitly joins the app request, provider call and file.
// It cannot create calls, choose another owner/campaign or supply a download URL.
export async function handleRecordingCallback(req,res,env=process.env) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  try {
    if(req.method!=='POST'){res.setHeader('Allow','POST');return send(405,{error:'POST required'});}
    if(!(env.SUPABASE_URL||env.VITE_SUPABASE_URL)||!env.SUPABASE_SERVICE_ROLE_KEY||typeof env.VOICE_RESULT_CALLBACK_SECRET!=='string'||env.VOICE_RESULT_CALLBACK_SECRET.length<32)return send(503,{error:'Recording receiver is not configured'});
    const authorization=req.headers.authorization;
    if(typeof authorization!=='string'||!/^Bearer [a-zA-Z0-9_-]{43}$/.test(authorization))return send(401,{error:'Invalid recording callback credentials'});
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return send(415,{error:'JSON required'});
    let raw='';
    if(req.body!==undefined)raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
    else for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)return send(413,{error:'Payload too large'});}
    if(Buffer.byteLength(raw)>4096)return send(413,{error:'Payload too large'});
    let body;try{body=JSON.parse(raw);}catch{return send(400,{error:'Invalid JSON'});}
    if(!validBody(body))return send(400,{error:'Send request_id, call_id, agent_id and file_path only'});
    const db=createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})}});
    const {data:record,error}=await db.from('voice_call_requests').select('id,owner_id,agent_id,call_id,metadata,response,created_at').eq('id',body.request_id).maybeSingle();
    if(error)return send(503,{error:'Storage unavailable; retry later'});
    const accountId=record?.metadata?.voice_account_id;
    if(!accountId||!timingSafeEqual(digest(authorization.slice(7)),digest(accountRecordingSecret(accountId,env))))return send(401,{error:'Invalid recording callback credentials'});
    const {data:connection,error:connectionError}=await db.from('voice_bot_connections').select('account_id').eq('owner_id',record.owner_id).maybeSingle();
    if(connectionError)return send(503,{error:'Connection storage unavailable; retry later'});
    if(connection?.account_id!==accountId)return send(401,{error:'Original Voice Bot account is no longer connected'});
    if(record.agent_id!==body.agent_id||typeof record.metadata.campaign_id!=='string'||!uuid.test(record.metadata.campaign_id))return send(404,{error:'Unknown campaign call reference'});
    if(!record.call_id)return send(409,{error:'Call not yet persisted; retry later'});
    if(record.call_id!==body.call_id)return send(409,{error:'Call ID does not match the request'});
    const date=Date.parse(record.created_at);
    if(!Number.isFinite(date))return send(503,{error:'Stored call date is unavailable'});
    const range={start:new Date(date-86400000).toISOString().slice(0,10),end:new Date(date+86400000).toISOString().slice(0,10)};
    const entry=audioEntries([body.file_path],record.agent_id,range)[0];
    if(!entry)return send(400,{error:'File must belong to this Agent and call date range'});
    const timestamp=entry.file_time.replace(' ','T')+'Z';
    const fileDate=Date.parse(timestamp);
    if(!Number.isFinite(fileDate)||new Date(fileDate).toISOString().slice(0,19)!==timestamp.slice(0,19))return send(400,{error:'Invalid file timestamp'});
    const original=record.response;
    const fingerprint=createHash('sha256').update(JSON.stringify([record.id,record.call_id,record.agent_id,entry.id])).digest('hex');
    const previous=original?.audio_link;
    if(previous)return previous.recording_id===entry.id?send(200,{received:true,duplicate:true}):send(409,{error:'A different recording is already linked; existing history was preserved'});
    const audioLink={recording_id:entry.id,request_id:record.id,call_id:record.call_id,campaign_id:record.metadata.campaign_id,agent_id:record.agent_id,account_id:accountId,source:'provider_callback',fingerprint,updated_at:new Date().toISOString()};
    let update=db.from('voice_call_requests').update({response:{...original,audio_link:audioLink}}).eq('id',record.id).eq('owner_id',record.owner_id).eq('agent_id',record.agent_id).eq('call_id',record.call_id).eq('metadata->>voice_account_id',accountId).eq('metadata->>campaign_id',record.metadata.campaign_id).is('response->audio_link->>updated_at',null);
    for(const [path,value] of [['response->callback->>received_at',original?.callback?.received_at],['response->review->>updated_at',original?.review?.updated_at],['response->followup->>checked_at',original?.followup?.checked_at],['response->transcript->>received_at',original?.transcript?.received_at]])update=value?update.eq(path,value):update.is(path,null);
    const saved=await update.select('id');
    if(saved.error)return send(503,{error:'Recording reference was not saved; retry later'});
    if(!saved.data?.length)return send(409,{error:'Concurrent update; retry the same payload'});
    return send(200,{received:true});
  }catch{return send(503,{error:'Recording receiver unavailable; retry later'});}
}
