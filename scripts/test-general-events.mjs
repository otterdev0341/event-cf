import assert from 'node:assert/strict';
import { generalCredential, searchGeneralEvents, handleGeneralEventTool, withGeneralPrompt } from '../server/general-events.mjs';
const owner='11111111-1111-4111-8111-111111111111', account='account_fixture';
const env={SUPABASE_URL:'https://general-db.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',VOICE_RESULT_CALLBACK_SECRET:'fixture-general-longer-than-32-characters'};
const record=(id='22222222-2222-4222-8222-222222222222',name='งานประชุม')=>({id, data:{name,eventDate:'2026-10-20',eventTime:'10:00',csv:{rows:[['PRIVATE_PHONE','PRIVATE_NAME']]},inboundInfo:{accountId:account,enabled:true,publicEnabled:true,location:'Public venue',details:'Public facts'}}});
let records=[record()], connectionAccount=account, requests=[], passed=0;
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);assert.equal(url.hostname,'general-db.invalid');requests.push(url);
 assert.equal(new Headers(init.headers).get('apikey'),'fixture-service');assert.ok(url.searchParams.get('owner_id')==='eq.'+owner);
 if(url.pathname.endsWith('/voice_bot_connections'))return Response.json({account_id:connectionAccount});
 if(url.pathname.endsWith('/voice_campaigns')){assert.equal(url.searchParams.get('state'),'eq.saved');return Response.json(records);}
 assert.fail('Unexpected external request');
};
async function invoke(body={query:'',event_id:''},token=generalCredential(owner,account,env),extra={}){
 let output;await handleGeneralEventTool({method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,...extra},{setHeader(){},end(value){output={status:this.statusCode,body:JSON.parse(value)};}},env);return output;
}
async function test(name,fn){records=[record()];connectionAccount=account;requests=[];await fn();passed++;console.log('PASS '+name);}
await test('General lookup never publishes prior private or other-account event details',()=>{const privateRecord=record();delete privateRecord.data.inboundInfo.publicEnabled;const other=record();other.data.inboundInfo.accountId='other';assert.deepEqual(searchGeneralEvents([privateRecord,other],account),{status:'no_match',events:[],has_more:false});});
await test('Search lists only event choices and exact IDs retrieve selected public facts',()=>{const selected=record();const choices=searchGeneralEvents([selected],account,'ประชุม');assert.equal(choices.status,'choose_event');assert.equal(choices.events[0].details,undefined);assert.equal(choices.events[0].location,undefined);const detail=searchGeneralEvents([selected],account,'',selected.id);assert.equal(detail.status,'event_details');assert.equal(detail.events[0].details,'Public facts');assert.ok(!JSON.stringify(detail).includes('PRIVATE'));});
await test('Ambiguous names remain choices and unmatched IDs cannot return another event',()=>{assert.equal(searchGeneralEvents([record(),record('33333333-3333-4333-8333-333333333333','งานประชุม 2')],account,'ประชุม').events.length,2);assert.equal(searchGeneralEvents([record()],account,'','44444444-4444-4444-8444-444444444444').status,'no_match');});
await test('Empty search is bounded and explicitly reports additional events',()=>{const result=searchGeneralEvents(Array.from({length:25},(_,i)=>record(String(i),'งาน '+i)),account);assert.equal(result.events.length,20);assert.equal(result.has_more,true);});
await test('Scoped authentication reads current connection and only owner campaigns',async()=>{const result=await invoke();assert.equal(result.status,200);assert.equal(result.body.status,'choose_event');assert.equal(requests.length,2);});
await test('Forged credentials fail before database requests',async()=>{const token=generalCredential(owner,account,env);const forged=token.slice(0,-1)+(token.endsWith('A')?'B':'A');assert.equal((await invoke(undefined,forged)).status,401);assert.equal(requests.length,0);});
await test('Account replacement revokes previously issued lookup access',async()=>{connectionAccount='different';assert.equal((await invoke()).status,401);assert.equal(requests.length,1);});
await test('Caller identity and arbitrary scope cannot be supplied by the tool',async()=>{for(const body of [{query:'',event_id:'',phone:'PRIVATE_PHONE'},{query:'',event_id:'',owner_id:owner},{query:'',event_id:'invalid'}, {query:'x'.repeat(161),event_id:''}])assert.equal((await invoke(body)).status,400);assert.equal(requests.length,0);});
await test('Malformed JSON, oversized bodies and unsupported methods fail closed',async()=>{assert.equal((await invoke('invalid')).status,400);assert.equal((await invoke('x'.repeat(2049))).status,413);assert.equal((await invoke(undefined,undefined,{method:'GET'})).status,405);});
await test('Managed prompt is idempotent and states selection, no identity and no invented answers',()=>{const agent={bot_name:'Fixture',agent_data:{system_instruction:'Original'}};const fail=()=>assert.fail('Unexpected prompt failure');const prompt=withGeneralPrompt(agent,'vc_fixture',fail);assert.ok(prompt.includes('ไม่ต้องถามเบอร์'));assert.ok(prompt.includes('ห้ามสร้างรหัส'));assert.ok(prompt.includes('ไม่เดาวันหรือสถานที่'));assert.equal(withGeneralPrompt({...agent,agent_data:{system_instruction:prompt}},'vc_fixture',fail),prompt);});
console.log(`${passed} general event checks passed; isolated fixtures only`);
