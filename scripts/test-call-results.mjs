import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleVoice} from '../server/voice.mjs';
import {providerOutcome,matchingLogPath,effectiveOutcome,resultsCsv} from '../shared/call-results.mjs';
const id='22222222-2222-4222-8222-222222222222',owner='11111111-1111-4111-8111-111111111111';
const env={VITE_SUPABASE_URL:'https://supabase.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'test',VOICE_BOT_ACCESS_TOKEN:'test-secret',VOICE_BOT_BASE_URL:'https://voice.invalid'};
let options,record,requests,patch,passed=0;
const reset=()=>{options={};patch=null;requests=[];record={id,owner_id:owner,call_id:'oc_fixture',agent_id:'agt_fixture',status:'queued',response:{status:'queued'},destination:'0812345678',metadata:{campaign_id:'fixture',contact_row:0},created_at:'2026-10-11T00:00:00Z'};};
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);requests.push({url,init});
 if(url.hostname==='supabase.invalid'){
  if(url.pathname==='/auth/v1/user')return Response.json({id:owner,email:'fixture@example.invalid',email_confirmed_at:'2026-01-01'});
  if(url.pathname.endsWith('/voice_call_requests')){
   assert.equal(url.searchParams.get('owner_id'),'eq.'+owner);
   if(init.method==='PATCH') {patch=JSON.parse(init.body);assert.equal(url.searchParams.get('response->callback->>received_at'),record.response?.callback?.received_at?'eq.'+record.response.callback.received_at:'is.null');assert.equal(url.searchParams.get('response->review->>updated_at'),record.response?.review?.updated_at?'eq.'+record.response.review.updated_at:'is.null');assert.equal(url.searchParams.get('response->followup->>checked_at'),record.response?.followup?.checked_at?'eq.'+record.response.followup.checked_at:'is.null');return Response.json(options.conflict?[]:[{id}]);}
   return Response.json(options.foreign?null:record);
  }
 }
 if(url.hostname==='voice.invalid'){
  assert.equal(init.method,'GET','Result refresh must never dial');
  if(url.pathname==='/me')return Response.json({_id:'tenant_fixture'});
  if(url.pathname.endsWith('/calls/oc_fixture')){if(options.failStatus)return Response.json({},{status:500});return Response.json({call_id:options.wrongId?'other':'oc_fixture',status:'completed',answered_at:'2026-10-11T00:00:01Z',completed_at:'2026-10-11T00:00:21Z',...options.call});}
  if(url.pathname==='/logs/list_file/'){if(options.failLogs)return Response.json({},{status:500});return Response.json(options.files || []);}
  if(url.pathname==='/logs/read_log/')return Response.json(options.log || {text:'user: ตกลงครับ'});
 }
 throw Error('Unexpected fixture request '+url.pathname);
};
async function invoke(body){const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{url:'/api/voice?path='+encodeURIComponent('/workspace/calls/'+id+'/result'),method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture'}});let out;const res={statusCode:200,setHeader(){},end(s){out=JSON.parse(s);}};await handleVoice(req,res,env);return {status:res.statusCode,data:out};}
async function test(name,fn){reset();await fn();passed++;console.log('PASS '+name);}
const review=()=>({call_result:'CONFIRMED',needs_agent:false,evidence:'Heard the recipient confirm',expected_review_at:null});
await test('Completed call never implies confirmed or false needs_agent',()=>assert.deepEqual(providerOutcome({status:'completed',metadata:{variables:{call_result:'CONFIRMED'}}}),{call_result:'UNDETERMINED',needs_agent:null,source:'unavailable'}));
await test('Explicit outputs retain false and reject unknown result codes',()=>{assert.equal(providerOutcome({outputs:{call_result:'CONFIRMED',needs_agent:false}}).needs_agent,false);assert.equal(providerOutcome({call_result:'success'}).call_result,'UNDETERMINED');});
await test('Transcript words never classify response',()=>assert.equal(providerOutcome({},{text:'user: confirmed yes'}).source,'unavailable'));
await test('Logs require exact call linkage, never time or agent proximity',()=>{assert.equal(matchingLogPath(['logs/other.txt'],{call_id:'oc_fixture'}),null);assert.equal(matchingLogPath(['logs/oc_fixture-extra.txt'],{call_id:'oc_fixture'}),null);assert.equal(matchingLogPath(['logs/oc_fixture.txt'],{call_id:'oc_fixture'}),'logs/oc_fixture.txt');assert.equal(matchingLogPath(['a/oc_fixture.txt','b/oc_fixture.txt'],{call_id:'oc_fixture'}),null);});
await test('Foreign call rejected before accessing provider',async()=>{options.foreign=true;assert.equal((await invoke()).status,404);assert.equal(requests.filter(r=>r.url.hostname==='voice.invalid').length,0);});
await test('Refresh persists actual completed state and missing evidence explicitly',async()=>{const r=await invoke();assert.equal(r.status,200);assert.equal(patch.status,'completed');assert.equal(r.data.response.followup.outcome.source,'unavailable');assert.equal(r.data.response.followup.log_state,'not_available');});
await test('Exact linked transcript and structured outputs are retrieved',async()=>{options.files=['logs/oc_fixture.txt'];options.log={text:'user: yes',outputs:{call_result:'CONFIRMED',needs_agent:false}};const r=await invoke();assert.equal(r.data.response.followup.transcript,'user: yes');assert.equal(r.data.response.followup.outcome.call_result,'CONFIRMED');});
await test('Log error does not lose completed status',async()=>{options.failLogs=true;const r=await invoke();assert.equal(r.status,200);assert.equal(patch.status,'completed');assert.equal(r.data.response.followup.log_state,'error');});
await test('Wrong call ID and failed provider read never overwrite data',async()=>{options.wrongId=true;assert.equal((await invoke()).status,502);assert.equal(patch,null);options.wrongId=false;options.failStatus=true;assert.equal((await invoke()).status,502);assert.equal(patch,null);});
await test('Unknown attempt without Call ID never redials',async()=>{record.call_id=null;const r=await invoke();assert.ok(r.data.warning);assert.equal(patch,null);assert.equal(requests.length,2);});
await test('Manual review requires evidence and valid typed fields',async()=>{for(const body of [{...review(),evidence:''},{...review(),call_result:'success'},{...review(),needs_agent:'false'}])assert.equal((await invoke(body)).status,400);assert.equal(patch,null);});
await test('Manual review preserves provider evidence and records owner and time',async()=>{record.response.followup={outcome:{call_result:'UNDETERMINED',needs_agent:null,source:'unavailable'},transcript:'real text'};const r=await invoke(review());assert.equal(r.status,200);assert.equal(patch.response.review.reviewed_by,owner);assert.equal(patch.response.followup.transcript,'real text');assert.equal(effectiveOutcome(patch.response).source,'manual');});
await test('Stale or concurrent updates are visible conflicts',async()=>{record.response.review={updated_at:'new'};assert.equal((await invoke(review())).status,409);record.response={};options.conflict=true;assert.equal((await invoke()).status,409);});
await test('Refresh retains manual review and previously fetched evidence',async()=>{record.response.review={...review(),updated_at:'time'};record.response.followup={transcript:'saved text',outcome:{call_result:'DECLINED',needs_agent:false,source:'provider'}};const r=await invoke();assert.equal(r.status,200);assert.equal(patch.response.review.call_result,'CONFIRMED');assert.equal(patch.response.followup.transcript,'saved text');assert.equal(patch.response.followup.outcome.call_result,'DECLINED');});
await test('CSV preserves Thai, quotes, leading zero and escapes spreadsheet formulas',()=>{const text=resultsCsv(['name','phone','note'],[['ทดสอบ','0967033424','=1+1'],['a,"b"','+66967033424','line\n2']]);assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes('"0967033424"'));assert.ok(text.includes('"\'=1+1"'));assert.ok(text.includes('"a,""b"""'));});
await test('Polling preserves callback result and compares its timestamp before writing',async()=>{record.response.callback={received_at:'callback-time',outcome:{call_result:'CONFIRMED',needs_agent:false,source:'agent_tool'}};const r=await invoke();assert.equal(r.status,200);assert.equal(patch.response.callback.received_at,'callback-time');assert.equal(effectiveOutcome(patch.response).source,'agent_tool');});
console.log(`${passed} call-result checks passed; no live calls or database writes.`);
