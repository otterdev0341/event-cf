import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleResultCallback } from '../server/callback.mjs';
import { effectiveOutcome } from '../shared/call-results.mjs';
import { promptVariables } from '../shared/campaign-inputs.mjs';
const id='22222222-2222-4222-8222-222222222222', owner='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://callback-db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-role',VOICE_RESULT_CALLBACK_SECRET:'fixture-secret-32-characters-long-enough'};
let record, options, requests, patches, passed=0;
const reset=()=>{options={};requests=[];patches=[];record={id,owner_id:owner,agent_id:'agt_fixture',call_id:'oc_fixture',status:'completed',metadata:{result_callback:1,variables:{vc_call_reference:id}},response:{review:{call_result:'DECLINED',needs_agent:null,evidence:'Manual evidence',updated_at:'manual-time'},followup:{checked_at:'check-time'}}};};
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);requests.push({url,init});
 assert.equal(url.hostname,'callback-db.invalid','Callback never calls other services or dials');
 assert.equal(url.pathname,'/rest/v1/voice_call_requests');
 assert.equal(new Headers(init.headers).get('apikey'),'fixture-service-role');
 assert.equal(url.searchParams.get('id'),'eq.'+id);
 if(init.method==='PATCH') {
  const patch=JSON.parse(init.body);patches.push(patch);
  assert.deepEqual(Object.keys(patch),['response'],'No call status/owner/contact changes');
  assert.equal(url.searchParams.get('owner_id'),'eq.'+owner);
  assert.equal(url.searchParams.get('agent_id'),'eq.agt_fixture');
  assert.equal(url.searchParams.get('call_id'),'eq.oc_fixture');
  assert.equal(url.searchParams.get('response->callback->>received_at'),'is.null');
  assert.equal(url.searchParams.get('response->review->>updated_at'),'eq.manual-time');
  assert.equal(url.searchParams.get('response->followup->>checked_at'),'eq.check-time');
  if(options.writeError)return Response.json({message:'private db error'},{status:500});
  if(options.conflict)return Response.json([]);
  record={...record,...patch};return Response.json([{id}]);
 }
 if(options.readError)return Response.json({message:'private db error'},{status:500});
 return Response.json(options.missing?null:record);
};
const payload=()=>({request_id:id,agent_id:'agt_fixture',call_result:'CONFIRMED',needs_agent:false,evidence:'Recipient explicitly confirmed attendance'});
async function invoke(body=payload(),extra={}) {
 const req=Readable.from([typeof body==='string'?body:JSON.stringify(body)]);
 Object.assign(req,{method:'POST',headers:{authorization:'Bearer '+env.VOICE_RESULT_CALLBACK_SECRET,'content-type':'application/json'},...extra.req});
 if(extra.parsed!==undefined)req.body=extra.parsed;
 let data;const res={statusCode:200,setHeader(){},end(s){data=JSON.parse(s);}};
 await handleResultCallback(req,res,{...env,...extra.env});return {status:res.statusCode,data};
}
async function test(name,fn){reset();await fn();passed++;console.log('PASS '+name);}
await test('Unconfigured receiver fails closed',async()=>{for(const vars of [{SUPABASE_SERVICE_ROLE_KEY:''},{VOICE_RESULT_CALLBACK_SECRET:'short'},{SUPABASE_URL:''}])assert.equal((await invoke(payload(),{env:vars})).status,503);assert.equal(requests.length,0);});
await test('Only authenticated POST JSON requests are accepted',async()=>{assert.equal((await invoke(payload(),{req:{method:'GET'}})).status,405);for(const authorization of ['', 'Bearer wrong',undefined])assert.equal((await invoke(payload(),{req:{headers:{authorization,'content-type':'application/json'}}})).status,401);assert.equal(requests.length,0);});
await test('Content type, malformed JSON and size rejected before database',async()=>{assert.equal((await invoke(payload(),{req:{headers:{authorization:'Bearer '+env.VOICE_RESULT_CALLBACK_SECRET}}})).status,415);assert.equal((await invoke('{')).status,400);assert.equal((await invoke('a'.repeat(16001))).status,413);assert.equal((await invoke(payload(),{parsed:{text:'a'.repeat(16001)}})).status,413);assert.equal(requests.length,0);});
await test('Payload uses explicit typed result with no owner or arbitrary response fields',async()=>{for(const value of [null,[],{...payload(),owner_id:owner},{...payload(),needs_agent:'false'},{...payload(),evidence:''},{...payload(),call_result:'completed'},{...payload(),call_result:['CONFIRMED']},{...payload(),request_id:[id]}])assert.equal((await invoke(value)).status,400);assert.equal(requests.length,0);});
await test('Unknown request and wrong Agent cannot write',async()=>{options.missing=true;assert.equal((await invoke()).status,404);options.missing=false;record.agent_id='agt_other';assert.equal((await invoke()).status,404);assert.equal(patches.length,0);});
await test('Legacy/unrelated call references cannot receive results',async()=>{delete record.metadata.result_callback;assert.equal((await invoke()).status,404);record.metadata.result_callback=1;record.metadata.variables.vc_call_reference='other';assert.equal((await invoke()).status,404);assert.equal(patches.length,0);});
await test('Callback arriving before initial persistence is retriable without write',async()=>{record.call_id=null;assert.equal((await invoke()).status,409);assert.equal(patches.length,0);});
await test('Result persists evidence and source while preserving manual review and phone status',async()=>{const r=await invoke();assert.equal(r.status,200);assert.equal(record.status,'completed');assert.equal(record.response.callback.call_id,'oc_fixture');assert.equal(record.response.callback.outcome.needs_agent,false);assert.equal(record.response.callback.outcome.source,'agent_tool');assert.equal(record.response.review.call_result,'DECLINED');assert.equal(record.response.followup.checked_at,'check-time');assert.ok(record.response.callback.received_at);assert.equal(effectiveOutcome(record.response).source,'manual');});
await test('Identical retry succeeds without another write',async()=>{await invoke();const r=await invoke();assert.equal(r.status,200);assert.equal(r.data.duplicate,true);assert.equal(patches.length,1);});
await test('Different final result cannot overwrite accepted result',async()=>{await invoke();assert.equal((await invoke({...payload(),call_result:'DECLINED'})).status,409);assert.equal(patches.length,1);});
await test('Concurrent update returns conflict without success',async()=>{options.conflict=true;assert.equal((await invoke()).status,409);assert.equal(record.response.callback,undefined);});
await test('Database errors are retriable and do not expose details',async()=>{options.readError=true;let r=await invoke();assert.equal(r.status,503);assert.ok(!JSON.stringify(r).includes('private db'));options.readError=false;options.writeError=true;assert.equal((await invoke()).status,503);});
await test('Agent callback takes priority over stale polled outputs but manual review wins',()=>{const callback={outcome:{call_result:'CONFIRMED',needs_agent:false,source:'agent_tool'}};assert.equal(effectiveOutcome({callback,followup:{outcome:{call_result:'UNDETERMINED',source:'unavailable'}}}).call_result,'CONFIRMED');assert.equal(effectiveOutcome({callback,review:{call_result:'DECLINED'}}).call_result,'DECLINED');});
await test('Reserved callback reference is never requested from a CSV column',()=>assert.deepEqual(promptVariables({agent_data:{system_instruction:'{{applicant_name}} {{vc_call_reference}} {{call_result}}'}}),['applicant_name','call_result']));
console.log(`${passed} callback checks passed; all data and network calls are isolated fixtures.`);
