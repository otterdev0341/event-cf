import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleRecordingCallback } from '../server/recording-callback.mjs';
import { accountRecordingSecret, accountCallbackSecret } from '../server/connection.mjs';
import { audioEntries } from '../server/audio-library.mjs';

const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',campaign='44444444-4444-4444-8444-444444444444',account='account_fixture';
const env={SUPABASE_URL:'https://recording-db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',VOICE_RESULT_CALLBACK_SECRET:'fixture-recording-root-secret-over-32-characters'};
const path='agt_fixture/2026-10-14_19-38-55_33333333-3333-4333-8333-333333333333_0.txt';
let record,options,requests,patches,passed=0;
function reset(){options={};requests=[];patches=[];record={id,owner_id:owner,call_id:'oc_fixture',agent_id:'agt_fixture',created_at:'2026-10-14T12:38:51Z',metadata:{campaign_id:campaign,voice_account_id:account,voice_request_id:id},response:{callback:{received_at:'callback-time'},review:{updated_at:'review-time'},followup:{checked_at:'check-time'},transcript:{received_at:'transcript-time'}}};}
globalThis.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);requests.push(url);
  assert.equal(url.hostname,'recording-db.invalid','Callback cannot dial or retrieve other services');
  assert.equal(new Headers(init.headers).get('apikey'),'fixture-service');
  if(url.pathname.endsWith('/voice_bot_connections')){assert.equal(url.searchParams.get('owner_id'),'eq.'+owner);return Response.json(options.disconnected?null:{account_id:options.accountChanged?'another':account});}
  assert.equal(url.pathname,'/rest/v1/voice_call_requests');assert.equal(url.searchParams.get('id'),'eq.'+id);
  if(init.method==='PATCH'){
    const patch=JSON.parse(init.body);patches.push(patch);
    assert.deepEqual(Object.keys(patch),['response']);assert.equal(url.searchParams.get('owner_id'),'eq.'+owner);assert.equal(url.searchParams.get('call_id'),'eq.oc_fixture');assert.equal(url.searchParams.get('agent_id'),'eq.agt_fixture');assert.equal(url.searchParams.get('metadata->>voice_account_id'),'eq.'+account);assert.equal(url.searchParams.get('metadata->>campaign_id'),'eq.'+campaign);
    assert.equal(url.searchParams.get('response->audio_link->>updated_at'),'is.null');
    for(const [field,value] of [['callback->>received_at','callback-time'],['review->>updated_at','review-time'],['followup->>checked_at','check-time'],['transcript->>received_at','transcript-time']])assert.equal(url.searchParams.get('response->'+field),'eq.'+value);
    if(options.writeError)return Response.json({message:'fixture private error'},{status:500});if(options.conflict)return Response.json([]);
    record={...record,...patch};return Response.json([{id}]);
  }
  if(options.readError)return Response.json({message:'fixture private error'},{status:500});
  return Response.json(options.missing?null:record);
};
const payload=()=>({request_id:id,call_id:'oc_fixture',agent_id:'agt_fixture',file_path:path});
async function invoke(body=payload(),token=accountRecordingSecret(account,env),extra={}){
  const req=Readable.from([typeof body==='string'?body:JSON.stringify(body)]);Object.assign(req,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...extra.req});if(extra.parsed!==undefined)req.body=extra.parsed;
  let data;const res={statusCode:200,setHeader(){},end(value){data=JSON.parse(value);}};await handleRecordingCallback(req,res,{...env,...extra.env});return {status:res.statusCode,data};
}
async function test(name,fn){reset();await fn();passed++;console.log('PASS '+name);}
await test('POST and configured server storage are required',async()=>{assert.equal((await invoke(undefined,undefined,{req:{method:'GET'}})).status,405);assert.equal((await invoke(undefined,undefined,{env:{VOICE_RESULT_CALLBACK_SECRET:''}})).status,503);assert.equal(requests.length,0);});
await test('Recording credentials are separate from result credentials and reject malformed auth',async()=>{assert.notEqual(accountRecordingSecret(account,env),accountCallbackSecret(account,env));for(const token of ['', 'bad',accountCallbackSecret(account,env),accountRecordingSecret('another',env)])assert.equal((await invoke(undefined,token)).status,401);assert.equal(patches.length,0);});
await test('Wrong JSON type, invalid syntax, oversized stream and parsed body are rejected',async()=>{assert.equal((await invoke(undefined,undefined,{req:{headers:{authorization:'Bearer '+accountRecordingSecret(account,env),'content-type':'text/plain'}}})).status,415);assert.equal((await invoke('{')).status,400);assert.equal((await invoke('x'.repeat(4097))).status,413);assert.equal((await invoke(undefined,undefined,{parsed:{data:'x'.repeat(4097)}})).status,413);assert.equal(requests.length,0);});
await test('Scope, external URL and extra fields cannot be supplied by callers',async()=>{for(const body of [null,[],{...payload(),owner_id:owner},{...payload(),campaign_id:campaign},{...payload(),recording_id:'arbitrary'},{...payload(),file_path:'https://foreign.invalid/file.wav'},{...payload(),request_id:'bad'},{...payload(),call_id:[]},{...payload(),agent_id:'other'}])assert.equal((await invoke(body)).status,400);assert.equal(patches.length,0);});
await test('Missing requests and changed original connections cannot grant access',async()=>{options.missing=true;assert.equal((await invoke()).status,401);options.missing=false;options.accountChanged=true;assert.equal((await invoke()).status,401);options.accountChanged=false;options.disconnected=true;assert.equal((await invoke()).status,401);assert.equal(patches.length,0);});
await test('Wrong Agent, noncampaign call, wrong Call ID and unpersisted call never save',async()=>{record.agent_id='agt_other';assert.equal((await invoke()).status,404);record.agent_id='agt_fixture';delete record.metadata.campaign_id;assert.equal((await invoke()).status,404);record.metadata.campaign_id=campaign;record.call_id='oc_other';assert.equal((await invoke()).status,409);record.call_id=null;assert.equal((await invoke()).status,409);assert.equal(patches.length,0);});
await test('Only valid files from this Agent and call date range are accepted',async()=>{for(const file of [path.replace('agt_fixture','agt_other'),path.replace('2026-10-14','2026-01-01'),path.replace('19-38-55','99-38-55'),path.replace('_0.txt','_0.wav?token=x'),'../'+path,path.replace('.txt','.mp3')])assert.equal((await invoke({...payload(),file_path:file})).status,400);assert.equal(patches.length,0);});
await test('Explicit provider join saves an opaque recording reference without overwriting evidence',async()=>{const before=structuredClone(record.response);const result=await invoke();assert.deepEqual(result,{status:200,data:{received:true}});const link=record.response.audio_link;assert.equal(link.source,'provider_callback');assert.equal(link.recording_id,audioEntries([path],'agt_fixture',{start:'2026-10-13',end:'2026-10-15'})[0].id);assert.equal(link.request_id,id);assert.equal(link.call_id,'oc_fixture');assert.equal(link.campaign_id,campaign);assert.equal(link.account_id,account);assert.equal(link.file_path,undefined);assert.equal(link.url,undefined);for(const key of Object.keys(before))assert.deepEqual(record.response[key],before[key]);});
await test('Retries and equivalent TXT/WAV filenames are idempotent',async()=>{assert.equal((await invoke()).status,200);assert.deepEqual((await invoke()).data,{received:true,duplicate:true});assert.deepEqual((await invoke({...payload(),file_path:path.replace('.txt','.wav')})).data,{received:true,duplicate:true});assert.equal(patches.length,1);});
await test('Different files cannot overwrite an already linked call',async()=>{await invoke();const previous=structuredClone(record.response.audio_link);assert.equal((await invoke({...payload(),file_path:path.replace('_0.txt','_1.txt')})).status,409);assert.deepEqual(record.response.audio_link,previous);assert.equal(patches.length,1);});
await test('Storage and concurrent result changes return retryable errors',async()=>{options.readError=true;assert.equal((await invoke()).status,503);options.readError=false;options.writeError=true;assert.equal((await invoke()).status,503);options.writeError=false;options.conflict=true;assert.equal((await invoke()).status,409);assert.equal(record.response.audio_link,undefined);});
console.log(`${passed} recording callback checks passed; synthetic references only, no live calls or database writes.`);
