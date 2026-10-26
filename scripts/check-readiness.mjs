// Read-only connectivity checks. Never creates accounts, records or outbound calls.
import { loadEnv } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const env=loadEnv('development',process.cwd(),'');
const report=[];
async function check(name,fn){try{report.push({check:name,...await fn()});}catch{report.push({check:name,status:'unreachable'});}}
await check('server-only configuration',async()=>({status:env.VOICE_BOT_ACCESS_TOKEN?'configured':'missing',accessMode:env.VOICE_ACCESS_MODE?.trim()||'members',allowedUsers:(env.VOICE_ALLOWED_USER_IDS||'').split(',').filter(Boolean).length,allowedEmails:(env.VOICE_ALLOWED_EMAILS||'').split(',').filter(Boolean).length,legacyBrowserTokenPresent:Boolean(env.VITE_VOICE_BOT_ACCESS_TOKEN)}));
const sbHeaders={apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY};
await check('Supabase Auth',async()=>{const r=await fetch(env.VITE_SUPABASE_URL+'/auth/v1/settings',{headers:sbHeaders,signal:AbortSignal.timeout(10000)});return {http:r.status};});
for(const table of ['voice_campaigns','voice_call_requests']) await check('Supabase '+table,async()=>{const r=await fetch(env.VITE_SUPABASE_URL+'/rest/v1/'+table+'?select=id&limit=0',{headers:sbHeaders,signal:AbortSignal.timeout(10000)});const data=await r.json().catch(()=>null);return {http:r.status,code:data?.code||null,anonymousBlocked:(r.status===401 || r.status===403) && data?.code==='42501' && data?.message===('permission denied for table '+table)};});
await check('Voice Bot account token',async()=>{const r=await fetch((env.VOICE_BOT_BASE_URL||'https://api-voicebot-stg.botnoigroup.com')+'/me',{headers:{Authorization:'Bearer '+env.VOICE_BOT_ACCESS_TOKEN},signal:AbortSignal.timeout(10000)});const data=await r.json().catch(()=>null);return {http:r.status,accountReturned:Boolean(data?._id)};});
for(const auth of ['', 'Bearer invalid-test-session']) await check(auth?'local backend rejects forged session':'local backend rejects anonymous',async()=>{const r=await fetch('http://127.0.0.1:5173/event-confirm/api/voice?path=%2Fme',{headers:auth?{Authorization:auth}:{},signal:AbortSignal.timeout(15000)});return {http:r.status};});
await check('build excludes Voice Bot secret',async()=>{const files=readdirSync('dist/assets').filter(f=>f.endsWith('.js'));const token=env.VOICE_BOT_ACCESS_TOKEN;return {status:!token?'not-configured':files.some(f=>readFileSync(join('dist/assets',f),'utf8').includes(token))?'FAIL-secret-present':'pass'};});
console.log(JSON.stringify(report,null,2));
const blocked = report.filter(r => r.status === 'unreachable' || r.status === 'missing' || r.status === 'FAIL-secret-present' || (r.check === 'server-only configuration' && (!['members','allowlist'].includes(r.accessMode) || (r.accessMode === 'allowlist' && !r.allowedUsers && !r.allowedEmails))) || (r.check.startsWith('Supabase voice_') ? !r.anonymousBlocked : (r.http && r.http !== (r.check.startsWith('local backend') ? 401 : 200))));
console.log(blocked.length ? 'BLOCKED: ' + blocked.map(r => r.check).join(', ') : 'READ-ONLY CHECKS PASSED; signed-in workflow and outbound call still require verification.');
if (blocked.length) process.exitCode = 1;
