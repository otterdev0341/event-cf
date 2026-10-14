import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { handleVoice } from '../server/voice.mjs';
import { audioEntries, audioDateRange } from '../server/audio-library.mjs';
import { sealToken } from '../server/connection.mjs';

const owner='11111111-1111-4111-8111-111111111111',agentId='agt_fixture';
const env={VITE_SUPABASE_URL:'https://audio-db.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'fixture-role',VOICE_CONNECTION_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64'),VOICE_BOT_BASE_URL:'https://voice.invalid',VOICE_BOT_LOGS_BASE_URL:'https://logs.invalid'};
const file='agt_fixture/2026-10-14_12-30-15_33333333-3333-4333-8333-333333333333_0.txt';
const wav=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVE'),Buffer.alloc(32)]);
const range={start:'2026-10-13',end:'2026-10-14'};
const fileId=audioEntries([file],agentId,range)[0].id;
let options={},requests=[],passed=0;
globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);requests.push({url,init});
  if(url.hostname==='audio-db.invalid'){
    if(url.pathname==='/auth/v1/user')return Response.json({id:owner,email:'fixture@example.invalid',email_confirmed_at:'confirmed'});
    if(url.pathname.endsWith('/voice_bot_connections')){assert.equal(url.searchParams.get('owner_id'),'eq.'+owner);return Response.json({owner_id:owner,account_id:'tenant_fixture',token_ciphertext:sealToken('upstream-fixture-secret',owner,env)});}
  }
  assert.equal(new Headers(init.headers).get('Authorization'),'Bearer upstream-fixture-secret');
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  if(url.hostname==='voice.invalid'){
    if(url.pathname==='/me')return Response.json({_id:options.wrongAccount?'other':'tenant_fixture'});
    if(url.pathname==='/agents')return Response.json(options.foreign?[]:[{agent_id:agentId}]);
  }
  if(url.hostname==='logs.invalid'){
    if(options.noScope)return new Response(null,{status:403});
    if(url.pathname==='/logs/list_file/'){assert.equal(url.searchParams.get('agent_id'),agentId);assert.equal(url.searchParams.get('start_date'),'2026/10/13');assert.equal(url.searchParams.get('end_date'),'2026/10/14');return Response.json(options.files||[file]);}
    if(url.pathname==='/logs/audio'){
      assert.equal(url.searchParams.get('file_path'),file.replace('.txt','.wav'));
      if(options.missingAudio)return new Response(null,{status:404});
      if(options.html)return new Response('<html>invalid</html>',{headers:{'Content-Type':'text/html'}});
      if(options.tooLarge)return new Response(wav,{headers:{'Content-Length':String(65*1024*1024)}});
      if(options.split)return new Response(new ReadableStream({start(controller){controller.enqueue(wav.subarray(0,5));controller.enqueue(wav.subarray(5,9));controller.enqueue(wav.subarray(9));controller.close();}}));
      return new Response(wav,{headers:{'Content-Type':'audio/wav'}});
    }
  }
  throw Error('Unexpected fixture request');
};
class ResponseCapture extends Writable {
  statusCode=200;headers={};chunks=[];headersSent=false;
  setHeader(key,value){assert.equal(this.headersSent,false);this.headers[key.toLowerCase()]=value;}
  _write(chunk,encoding,callback){this.headersSent=true;this.chunks.push(Buffer.from(chunk));callback();}
}
async function invoke(file='',extra={}){
  const path=`/workspace/agents/${agentId}/audio${file?'/'+file:''}?start_date=2026-10-13&end_date=2026-10-14`;
  const req=Readable.from([]);Object.assign(req,{url:'/api/voice?path='+encodeURIComponent(extra.path||path),method:extra.method||'GET',headers:extra.unauth?{}:{authorization:'Bearer website-fixture'}});
  const res=new ResponseCapture();await handleVoice(req,res,env);const body=Buffer.concat(res.chunks);
  return {status:res.statusCode,headers:res.headers,body,data:res.headers['content-type']?.includes('application/json')?JSON.parse(body.toString()):null};
}
async function test(name,fn){options={};requests=[];await fn();passed++;console.log('PASS '+name);}
const audioRequests=()=>requests.filter(request=>request.url.pathname==='/logs/audio');
await test('Dated listing converts .txt to .wav, deduplicates and never exposes paths or tokens',async()=>{options.files=[file,file.replace('.txt','.wav')];const result=await invoke();assert.equal(result.status,200);assert.equal(result.data.total,1);assert.equal(result.data.items[0].file_time,'2026-10-14 12:30:15');assert.ok(!JSON.stringify(result.data).includes('upstream-fixture-secret'));assert.ok(!JSON.stringify(result.data).includes('33333333-3333'));assert.equal(audioRequests().length,0);});
await test('Files from other agents, traversal and outside dates never enter the library',()=>{const entries=audioEntries([file,file.replace('agt_fixture','agt_other'),'agt_fixture/../'+file,file.replace('2026-10-14','2026-10-01'),'https://evil.invalid/'+file],agentId,range);assert.equal(entries.length,1);});
await test('Only selected owned hash streams verified binary WAV, not audio_url JSON',async()=>{const result=await invoke(fileId);assert.equal(result.status,200);assert.equal(result.headers['content-type'],'audio/wav');assert.deepEqual(result.body,wav);assert.equal(audioRequests().length,1);assert.equal(requests.filter(r=>r.url.pathname==='/logs/audio_url').length,0);assert.equal(result.headers['cache-control'],'private, no-store');});
await test('Small upstream chunks still verify and reconstruct the exact WAV header',async()=>{options.split=true;assert.deepEqual((await invoke(fileId)).body,wav);});
await test('Foreign Agent and changed account are rejected before reading file lists',async()=>{options.foreign=true;assert.equal((await invoke()).status,403);assert.equal(requests.filter(r=>r.url.hostname==='logs.invalid').length,0);options.foreign=false;options.wrongAccount=true;assert.equal((await invoke()).status,403);assert.equal(requests.filter(r=>r.url.hostname==='logs.invalid').length,0);});
await test('Authentication and GET are required',async()=>{assert.equal((await invoke('',{unauth:true})).status,401);assert.equal((await invoke('',{method:'POST'})).status,405);assert.equal(requests.filter(r=>r.url.hostname==='logs.invalid').length,0);});
await test('Raw path and arbitrary URL parameters cannot select another recording',async()=>{const path=`/workspace/agents/${agentId}/audio?start_date=2026-10-13&end_date=2026-10-14&file_path=other.wav`;assert.equal((await invoke('',{path})).status,400);assert.equal(requests.filter(r=>r.url.hostname==='logs.invalid').length,0);});
await test('Unknown hash is rejected without fetching audio',async()=>{assert.equal((await invoke('0'.repeat(64))).status,404);assert.equal(audioRequests().length,0);});
await test('Expired or unsupported log API credentials return connection guidance',async()=>{options.noScope=true;assert.equal((await invoke()).status,428);assert.equal(audioRequests().length,0);});
await test('Missing WAV returns an explicit unavailable message',async()=>{options.missingAudio=true;const result=await invoke(fileId);assert.equal(result.status,404);assert.ok(result.data.error.includes('ยังไม่มีไฟล์เสียง'));});
await test('HTML or non-WAV bytes are rejected before opening audio response',async()=>{options.html=true;const result=await invoke(fileId);assert.equal(result.status,502);assert.ok(result.headers['content-type'].includes('application/json'));});
await test('Oversized audio is rejected before streaming',async()=>{options.tooLarge=true;assert.equal((await invoke(fileId)).status,413);});
await test('Invalid dates and unbounded history are rejected',()=>{const fail=(status,message)=>{throw Object.assign(Error(message),{status});};for(const value of ['start_date=2026-02-30&end_date=2026-03-01','start_date=2026-10-14&end_date=2026-10-13','start_date=2026-01-01&end_date=2026-10-14'])assert.throws(()=>audioDateRange(new URLSearchParams(value),fail),e=>e.status===400);});
console.log(`${passed} audio checks passed; synthetic WAV only, no live audio content or calls`);
