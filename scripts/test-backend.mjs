import assert from 'node:assert/strict';
import { handleVoice } from '../server/voice.mjs';
import { Readable } from 'node:stream';
let passed=0, requests=[], options={};
const userId='11111111-1111-4111-8111-111111111111';
const env={VITE_SUPABASE_URL:'https://supabase.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'test-key',VOICE_BOT_ACCESS_TOKEN:'server-secret-fixture',VOICE_BOT_BASE_URL:'https://voice.invalid',VOICE_ALLOWED_USER_IDS:userId,VOICE_ACCESS_MODE:'allowlist'};
const payload=()=>({destination:'0812345678',agent_id:'agt_fixture',request_id:'22222222-2222-4222-8222-222222222222',consent:true,metadata:{variables:{guest_name:'Fixture'}}});
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url); requests.push({url,init});
 if(url.hostname==='supabase.invalid') {
  if(url.pathname==='/auth/v1/user') return options.invalidSession?Response.json({message:'invalid'},{status:401}):Response.json({id:userId,email:'fixture@example.invalid',email_confirmed_at:options.unconfirmed?null:'2026-01-01'});
  if(url.pathname.endsWith('/rpc/reserve_voice_call')) return options.reserveError?Response.json({message:options.reserveError,code:'P0001'},{status:400}):Response.json(null);
  if(url.pathname.endsWith('/voice_campaigns')) return Response.json(options.noCampaign?null:{id:userId,data:options.campaign || {csv:{rows:[['Fixture']]}},updated_at:'version-1'});
  if(url.pathname.endsWith('/voice_call_requests')) return options.persistError?Response.json({message:'failed'},{status:500}):new Response(null,{status:204});
 }
 if(url.hostname==='voice.invalid') {
  assert.equal(new Headers(init.headers).get('Authorization'),'Bearer server-secret-fixture');
  if(url.pathname==='/me') return Response.json({_id:'tenant_fixture',username:'fixture',access_token:'hidden',password:'hidden'});
  if(url.pathname==='/agents') return Response.json([{agent_id:'agt_fixture',name:'Fixture'}]);
  if(url.pathname==='/platform-config/tools') return Response.json([]);
  if(url.pathname==='/agents/agt_fixture') return Response.json({agent_id:'agt_fixture',agent_data:{greeting_text:options.prompt || 'Hello {{guest_name}}',api_key:'hidden'}});
  if(url.pathname.endsWith('/calls')&&init.method==='POST') {if(options.timeout) throw new Error('timeout');return Response.json({call_id:'oc_fixture',status:'queued'});}
  if(url.pathname.startsWith('/logs')) return Response.json({items:[]});
 }
 throw new Error('Unexpected offline fetch: '+url.hostname+url.pathname);
};
async function invoke(path='/me',body,extra={}) {
 const req=Readable.from(body===undefined?[]:[typeof body==='string'?body:JSON.stringify(body)]);
 Object.assign(req,{url:'/api/voice?path='+encodeURIComponent(path),method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-session',...extra.headers}});
 if(extra.parsedBody!==undefined)req.body=extra.parsedBody;
 let output;const headers={};const res={statusCode:200,setHeader(k,v){headers[k]=v;},end(s){output=JSON.parse(s);}};
 await handleVoice(req,res,{...env,...extra.env});return {status:res.statusCode,data:output,headers};
}
async function test(name,run){requests=[];options={};await run();passed++;console.log('PASS',name);}
const callPath='/v1/provisioning/tenants/tenant_fixture/calls';
const calls=()=>requests.filter(r=>r.url.hostname==='voice.invalid'&&r.init.method==='POST');
await test('Missing configuration fails closed',async()=>assert.equal((await invoke('/me',undefined,{env:{VOICE_BOT_ACCESS_TOKEN:''}})).status,503));
await test('Unauthenticated request is rejected before upstream calls',async()=>{assert.equal((await invoke('/me',undefined,{headers:{authorization:''}})).status,401);assert.equal(requests.length,0);});
await test('Invalid session is rejected',async()=>{options.invalidSession=true;assert.equal((await invoke()).status,401);});
await test('Empty allowlists deny authenticated users',async()=>assert.equal((await invoke('/me',undefined,{env:{VOICE_ALLOWED_USER_IDS:''}})).status,403));
await test('Unconfirmed email is not granted access',async()=>{options.unconfirmed=true;assert.equal((await invoke('/me',undefined,{env:{VOICE_ALLOWED_USER_IDS:'',VOICE_ALLOWED_EMAILS:'fixture@example.invalid'}})).status,403);});
await test('Confirmed email allowlist permits access and response excludes secrets',async()=>{const r=await invoke('/me',undefined,{env:{VOICE_ALLOWED_USER_IDS:'',VOICE_ALLOWED_EMAILS:'FIXTURE@example.invalid'}});assert.equal(r.status,200);assert.equal(r.data.access_token,undefined);assert.equal(r.headers['Cache-Control'],'no-store');});
await test('Member mode permits a confirmed account without an allowlist entry',async()=>{const r=await invoke('/agents',undefined,{env:{VOICE_ACCESS_MODE:'members',VOICE_ALLOWED_USER_IDS:'',VOICE_ALLOWED_EMAILS:''}});assert.equal(r.status,200);assert.equal(r.data[0].agent_id,'agt_fixture');});
await test('Default mode permits confirmed members despite an unrelated legacy allowlist',async()=>assert.equal((await invoke('/me',undefined,{env:{VOICE_ACCESS_MODE:undefined,VOICE_ALLOWED_USER_IDS:'other',VOICE_ALLOWED_EMAILS:'other@example.invalid'}})).status,200));
await test('Member mode rejects unconfirmed email before calling Voice Bot',async()=>{options.unconfirmed=true;assert.equal((await invoke('/agents',undefined,{env:{VOICE_ACCESS_MODE:'members'}})).status,403);assert.equal(requests.filter(r=>r.url.hostname==='voice.invalid').length,0);});
await test('Member mode still rejects invalid sessions',async()=>{options.invalidSession=true;assert.equal((await invoke('/agents',undefined,{env:{VOICE_ACCESS_MODE:'members'}})).status,401);});
await test('Unknown access mode fails closed',async()=>assert.equal((await invoke('/me',undefined,{env:{VOICE_ACCESS_MODE:'typo'}})).status,503));
await test('Absolute URLs and encoded slash attacks rejected',async()=>{for(const path of ['https://evil.invalid','//evil.invalid','/agents/%2Fme','/../me'])assert.equal((await invoke(path)).status,400);});
await test('Admin and credential endpoints unavailable',async()=>{for(const path of ['/me/connector-credentials','/delete-user','/v1/provisioning/tenants/tenant_fixture/trunk/password'])assert.equal((await invoke(path)).status,405);});
await test('Tenant mismatch is forbidden',async()=>assert.equal((await invoke('/v1/provisioning/tenants/other/overview')).status,403));
await test('Agent mismatch is forbidden',async()=>assert.equal((await invoke('/agents/agt_other')).status,403));
await test('Query tokens are rejected; log limit capped',async()=>{assert.equal((await invoke('/me?token=foo')).status,400);assert.equal((await invoke('/logs/call_logs_platform?limit=10000')).status,200);assert.equal(requests.at(-1).url.searchParams.get('limit'),'100');});
await test('Secret fields nested inside Agent config are removed',async()=>{const r=await invoke('/agents/agt_fixture');assert.equal(r.status,200);assert.equal(r.data.agent_data.api_key,undefined);});
await test('Agent setup status is safe for members and direct writes remain denied',async()=>{const r=await invoke('/workspace/agents/agt_fixture/result-setup');assert.equal(r.status,200);assert.equal(r.data.can_manage,false);assert.equal(r.data.connected,false);assert.ok(!JSON.stringify(r.data).includes('hidden'));for(const route of ['/platform-config/tools','/agent/create_update_agent'])assert.equal((await invoke(route,{})).status,405);});
await test('Member setup POST and cross-site admin POST are rejected before Voice Bot changes',async()=>{const path='/workspace/agents/agt_fixture/result-setup';assert.equal((await invoke(path,{confirm:true,expected_revision:'0'.repeat(64)})).status,403);assert.equal((await invoke(path,{}, {env:{VOICE_ADMIN_USER_IDS:userId},headers:{'sec-fetch-site':'cross-site'}})).status,403);assert.equal(requests.filter(r=>r.url.hostname==='voice.invalid').length,0);});
await test('Foreign Agent setup status is denied without reading its configuration',async()=>{assert.equal((await invoke('/workspace/agents/agt_other/result-setup')).status,403);assert.equal(requests.filter(r=>r.url.pathname==='/agents/agt_other').length,0);});
await test('Missing consent prevents dial',async()=>{assert.equal((await invoke(callPath,{...payload(),consent:false})).status,400);assert.equal(calls().length,0);});
await test('Invalid phone, missing variable and foreign agent prevent dial',async()=>{for(const p of [{...payload(),destination:'invalid'},{...payload(),metadata:{variables:{}}},{...payload(),agent_id:'other'}])assert.equal((await invoke(callPath,p)).status,400);assert.equal(calls().length,0);});
await test('Foreign campaign is forbidden',async()=>{options.noCampaign=true;const p=payload();p.metadata.campaign_id=userId;assert.equal((await invoke(callPath,p)).status,403);assert.equal(calls().length,0);});
await test('Rate limit and duplicate reservation prevent dial',async()=>{options.reserveError='rate_limit';assert.equal((await invoke(callPath,payload())).status,429);options.reserveError='duplicate key';assert.equal((await invoke(callPath,payload())).status,409);assert.equal(calls().length,0);});
await test('Accepted call reserves ID before dial and persists Call ID',async()=>{assert.equal((await invoke(callPath,payload())).status,200);assert.equal(calls().length,1);const order=requests.map(r=>r.url.pathname);assert.ok(order.findIndex(p=>p.endsWith('/reserve_voice_call'))<order.findIndex(p=>p.endsWith('/calls')));assert.equal(JSON.parse(calls()[0].init.body).metadata.variables.guest_name,'Fixture');assert.equal(JSON.parse(requests.at(-1).init.body).call_id,'oc_fixture');});
await test('Timeout marks request unknown and never retries the dial',async()=>{options.timeout=true;assert.equal((await invoke(callPath,payload())).status,502);assert.equal(calls().length,1);assert.equal(JSON.parse(requests.at(-1).init.body).status,'unknown');});
await test('Persistence failure preserves successful Call ID with warning',async()=>{options.persistError=true;const r=await invoke(callPath,payload());assert.equal(r.status,200);assert.equal(r.data.call_id,'oc_fixture');assert.ok(r.data.persistence_warning);});
await test('Cross-site call rejected',async()=>{assert.equal((await invoke(callPath,payload(),{headers:{'sec-fetch-site':'cross-site'}})).status,403);assert.equal(calls().length,0);});
await test('Malformed JSON and null body return client errors',async()=>{assert.equal((await invoke(callPath,'{')).status,400);assert.equal((await invoke(callPath,'null')).status,400);assert.equal((await invoke(callPath,{}, {parsedBody:'{'})).status,400);});
await test('Non-string phone and invalid UUID rejected before dial',async()=>{assert.equal((await invoke(callPath,{...payload(),destination:812345678})).status,400);assert.equal((await invoke(callPath,{...payload(),request_id:'-'.repeat(36)})).status,400);assert.equal(calls().length,0);});

const csvCampaign=()=>({agentId:'agt_fixture',csv:{headers:['name','phone'],rows:[['CSV One','0812345678'],['CSV Two','0898765432']]},mapping:{phone:'phone'},variableBindings:{guest_name:{source:'csv',column:'name'},call_result:{source:'output'}}});
const batchPayload=()=>({...payload(),metadata:{campaign_id:userId,contact_row:1,campaign_batch:true,campaign_version:'version-1',variables:{guest_name:'browser override'}}});
await test('Batch derives destination and variables from owner CSV and omits classified outputs',async()=>{options.campaign=csvCampaign();options.prompt='{{guest_name}} {{call_result}}';const r=await invoke(callPath,batchPayload());assert.equal(r.status,200);const body=JSON.parse(calls()[0].init.body);assert.equal(body.destination,'0898765432');assert.equal(body.metadata.variables.guest_name,'CSV Two');assert.equal(body.metadata.variables.call_result,undefined);assert.equal(body.metadata.campaign_version,'version-1');});
await test('Batch rejects stale campaign version before reserving or dialing',async()=>{options.campaign=csvCampaign();const p=batchPayload();p.metadata.campaign_version='old';assert.equal((await invoke(callPath,p)).status,409);assert.equal(calls().length,0);});
await test('Batch rejects incomplete CSV even when browser provides replacement values',async()=>{options.campaign=csvCampaign();options.prompt='{{guest_name}} {{call_result}}';options.campaign.csv.rows[0][0]='';assert.equal((await invoke(callPath,batchPayload())).status,400);assert.equal(calls().length,0);});
await test('Batch requires campaign, row, matching Agent and owner access',async()=>{options.campaign=csvCampaign();for(const change of [{campaign_id:undefined},{contact_row:undefined},{contact_row:-1},{contact_row:20}]){const p=batchPayload();Object.assign(p.metadata,change);assert.equal((await invoke(callPath,p)).status,400);}options.campaign.agentId='other';assert.equal((await invoke(callPath,batchPayload())).status,400);options.noCampaign=true;assert.equal((await invoke(callPath,batchPayload())).status,403);assert.equal(calls().length,0);});
await test('Batch refuses new prompt variables until CSV mapping is updated',async()=>{options.campaign=csvCampaign();options.prompt='{{guest_name}} {{new_input}} {{call_result}}';assert.equal((await invoke(callPath,batchPayload())).status,400);assert.equal(calls().length,0);});

await test('Callback correlation comes from server request ID, never client input',async()=>{options.prompt='{{guest_name}} {{vc_call_reference}}';const body=payload();body.metadata.variables.vc_call_reference='client-forged-reference';const r=await invoke(callPath,body,{env:{SUPABASE_SERVICE_ROLE_KEY:'fixture-role',VOICE_RESULT_CALLBACK_SECRET:'fixture-callback-secret-longer-than-32'}});assert.equal(r.status,200);const sent=JSON.parse(calls()[0].init.body);assert.equal(sent.metadata.variables.vc_call_reference,body.request_id);assert.equal(sent.metadata.result_callback,1);const reserved=JSON.parse(requests.find(r=>r.url.pathname.endsWith('/rpc/reserve_voice_call')).init.body);assert.equal(reserved.p_metadata.variables.vc_call_reference,body.request_id);});
await test('Agent requiring callback cannot dial with an unconfigured receiver',async()=>{options.prompt='{{guest_name}} {{vc_call_reference}}';assert.equal((await invoke(callPath,payload())).status,503);assert.equal(calls().length,0);assert.equal(requests.filter(r=>r.url.pathname.endsWith('/rpc/reserve_voice_call')).length,0);});
console.log(`\n${passed} backend checks passed; every network response was isolated inside this process.`);
