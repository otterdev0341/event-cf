import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function keyOf(env) {
  const raw=env.VOICE_CONNECTION_ENCRYPTION_KEY || '';
  if(!/^[A-Za-z0-9+/]{43}=$/.test(raw)) throw Error('Connection encryption is not configured');
  const key=Buffer.from(raw,'base64'); if(key.length!==32)throw Error('Invalid encryption key'); return key;
}
export function sealToken(token,owner,env) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',keyOf(env),iv);
  cipher.setAAD(Buffer.from('voice-connection-v1:'+owner));
  const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');
}
export function openToken(value,owner,env) {
  const [version,iv,tag,text,...extra]=String(value).split('.');
  if(version!=='v1'||extra.length||!iv||!tag||!text)throw Error('Invalid encrypted connection');
  const decipher=createDecipheriv('aes-256-gcm',keyOf(env),Buffer.from(iv,'base64'));
  decipher.setAAD(Buffer.from('voice-connection-v1:'+owner));decipher.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(text,'base64')),decipher.final()]).toString('utf8');
}
export function accountCallbackSecret(accountId,env) {
  if(!accountId || typeof env.VOICE_RESULT_CALLBACK_SECRET!=='string'||env.VOICE_RESULT_CALLBACK_SECRET.length<32)throw Error('Callback is not configured');
  return createHmac('sha256',env.VOICE_RESULT_CALLBACK_SECRET).update('voice-account-result-v2:'+accountId).digest('base64url');
}
export function accountRecordingSecret(accountId,env) {
  if(!accountId || typeof env.VOICE_RESULT_CALLBACK_SECRET!=='string'||env.VOICE_RESULT_CALLBACK_SECRET.length<32)throw Error('Recording callback is not configured');
  return createHmac('sha256',env.VOICE_RESULT_CALLBACK_SECRET).update('voice-account-recording-v1:'+accountId).digest('base64url');
}
export function connectionStore(env,deadline) {
  keyOf(env);
  if(!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Connection storage is not configured');
  return createClient(env.SUPABASE_URL||env.VITE_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.any([deadline,AbortSignal.timeout(10000)])})}});
}
export async function loadConnection(db,user,env,fail) {
  const {data,error}=await db.from('voice_bot_connections').select('*').eq('owner_id',user.id).maybeSingle();
  if(error)fail(503,'ยังอ่านการเชื่อมบัญชีไม่ได้ กรุณาติดต่อผู้ดูแล');
  if(!data)return null;
  let token;try{token=openToken(data.token_ciphertext,user.id,env);}catch{fail(503,'อ่านคีย์ที่เข้ารหัสไม่ได้ กรุณาติดต่อผู้ดูแล');}
  return {...data,token};
}
const accountOf = value => ({account_id:value._id,username:value.username || '',email:value.email || '',role:value.role || '',verified:typeof value.verified==='boolean'?value.verified:null});
const publicConnection = value => value?{connected:true,account_id:value.account_id,username:value.username,email:value.email,role:value.role,verified:value.verified,expires_at:value.expires_at,updated_at:value.updated_at,expired:Boolean(value.expires_at&&Date.parse(value.expires_at)<=Date.now())}:{connected:false};
export function tokenExpiry(token) {
  if(typeof token!=='string'||token.length>12000||!/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))throw Error('Invalid JWT');
  const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
  if(payload.exp===undefined)return null;
  if(typeof payload.exp!=='number'||!Number.isFinite(payload.exp)||payload.exp<=0)throw Error('Invalid expiry');
  return new Date(payload.exp*1000).toISOString();
}
export async function verifyVoiceToken(token,env,deadline,fail) {
  let expiresAt;try{expiresAt=tokenExpiry(token);}catch{fail(400,'กรุณาใส่ Session JWT ของ Voice Bot ให้ครบ');}
  if(expiresAt&&Date.parse(expiresAt)<=Date.now())fail(400,'Session JWT หมดอายุแล้ว กรุณาคัดลอกตัวใหม่จาก Voice Bot');
  const base=new URL(env.VOICE_BOT_BASE_URL||'https://api-voicebot-stg.botnoigroup.com');
  if(base.protocol!=='https:'||base.username||base.password)fail(503,'การตั้งค่าบริการไม่ถูกต้อง');
  const response=await fetch(new URL('/me',base),{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.any([deadline,AbortSignal.timeout(15000)])});
  if([401,403].includes(response.status))fail(400,'Voice Bot ไม่รับ Session JWT นี้ กรุณาเข้าสู่ระบบ Voice Bot แล้วคัดลอกใหม่');
  if(!response.ok)fail(503,'Voice Bot ยังตรวจบัญชีไม่ได้ กรุณาลองใหม่');
  const value=await response.json();
  if(typeof value._id!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(value._id))fail(502,'บริการไม่ส่งรหัสบัญชีที่ใช้งานได้');
  return {...accountOf(value),expires_at:expiresAt};
}
export async function handleConnection({method,body,user,env,db,connection,deadline,fail,send}) {
  if(method==='GET')return send(200,publicConnection(connection));
  if(!body||Array.isArray(body)||typeof body!=='object')fail(400,'รูปแบบคำขอไม่ถูกต้อง');
  if(!['verify','connect','disconnect'].includes(body.action))fail(400,'การเชื่อมบัญชีไม่ถูกต้อง');
  const allowed=body.action==='verify'?['action','token']:body.action==='connect'?['action','token','confirm','expected_account_id','expected_updated_at']:['action','confirm','expected_updated_at'];
  if(Object.keys(body).some(k=>!allowed.includes(k)))fail(400,'ข้อมูลการเชื่อมบัญชีไม่ถูกต้อง');
  if(body.action!=='verify'&&(body.confirm!==true||(body.expected_updated_at??null)!==(connection?.updated_at??null)))fail(409,'การเชื่อมบัญชีเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่และยืนยันอีกครั้ง');
  if(body.action==='disconnect') {
    if(connection){const {data,error}=await db.from('voice_bot_connections').delete().eq('owner_id',user.id).eq('updated_at',connection.updated_at).select('owner_id');if(error||!data?.length)fail(409,'ยังยกเลิกการเชื่อมไม่ได้ กรุณาโหลดหน้าใหม่');}
    return send(200,{connected:false});
  }
  const account=await verifyVoiceToken(body.token,env,deadline,fail);
  if(body.action==='verify')return send(200,{account});
  if(body.expected_account_id!==account.account_id)fail(409,'บัญชีจาก Token ไม่ตรงกับที่ตรวจไว้ กรุณาตรวจใหม่ก่อนบันทึก');
  const values={owner_id:user.id,...account,token_ciphertext:sealToken(body.token,user.id,env),updated_at:new Date().toISOString()};
  let query=connection?db.from('voice_bot_connections').update(values).eq('owner_id',user.id).eq('updated_at',connection.updated_at):db.from('voice_bot_connections').insert(values);
  const {data,error}=await query.select('owner_id');
  if(error||!data?.length)fail(409,'บันทึกการเชื่อมไม่ได้หรือมีการเปลี่ยนพร้อมกัน กรุณาโหลดหน้าใหม่');
  return send(200,publicConnection(values));
}
