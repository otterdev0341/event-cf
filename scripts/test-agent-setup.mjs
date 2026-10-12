import assert from 'node:assert/strict';
import { handleAgentSetup, setupRevision, isSetupAdmin } from '../server/agent-setup.mjs';

const id='agt_fixture', user={id:'11111111-1111-4111-8111-111111111111',email:'admin@example.invalid',email_confirmed_at:'confirmed'};
const env={VOICE_ADMIN_EMAILS:user.email,SUPABASE_URL:'https://setup-db.invalid',SUPABASE_SERVICE_ROLE_KEY:'service-fixture',VOICE_RESULT_CALLBACK_SECRET:'callback-fixture-secret-longer-than-32',VOICE_RESULT_CALLBACK_URL:'https://receiver.invalid/api/voice-result'};
let agent, tools, events, options, passed=0;
function reset(){agent={agent_id:id,bot_name:'Fixture',agent_data:{system_instruction:'Original {{guest_name}}',greeting_text:'Hello',tools:[{tool_id:'original_tool',tools_name:'original_tool'}],model:'original_model'},voice_data:{voice:'original'},transfer:{number:'original'},webhook:{enabled:false}};tools=[];events=[];options={};}
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 assert.equal(url.hostname,'setup-db.invalid');assert.equal(new Headers(init.headers).get('apikey'),'service-fixture');
 const body=init.body?JSON.parse(init.body):null;events.push({db:url.pathname,method:init.method,body});
 if(url.pathname.endsWith('/rpc/acquire_voice_agent_setup')) return options.noMigration?Response.json({message:'fixture'},{status:500}):Response.json(!options.lockBusy);
 if(url.pathname.endsWith('/voice_agent_setup_audits')) return options.auditFail && init.method==='POST'?Response.json({message:'fixture'},{status:500}):new Response(null,{status:204});
 if(url.pathname.endsWith('/voice_agent_setup_locks'))return new Response(null,{status:204});
 throw Error('Unexpected database call');
};
async function upstream(path,body,method='GET'){
 events.push({path,method,body});
 if(path==='/agents')return [{agent_id:id,name:'Fixture'}];
 if(path==='/agents/'+id){if(options.changeAfterCreate&&tools.length)agent.agent_data.system_instruction='Concurrent edit';return structuredClone(agent);}
 if(path==='/platform-config/tools'&&method==='GET')return structuredClone(tools);
 if(path==='/platform-config/tools'&&method==='POST'){
  if(options.createTimeout)throw Error('fixture timeout');
  const saved=structuredClone(body);saved.tool_id='tool_fixture';saved.execution.auth={type:'bearer',has_api_key:true};tools.push(saved);return saved;
 }
 if(path==='/agent/create_update_agent'&&method==='PUT'){
  if(options.updateFail)throw Error('fixture update failed');
  agent=structuredClone(body);return {success:true};
 }
 throw Error('Unexpected upstream operation');
}
async function invoke(method='POST',extra={}){
 let output;const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 try{await handleAgentSetup({id,method,body:{confirm:true,expected_revision:setupRevision(agent),...extra.body},user:extra.user||user,env:{...env,...extra.env},connection:extra.connection,upstream,fail,send:(status,data)=>{events.push({response:true});output={status,data};},deadline:AbortSignal.timeout(10000)});return output;}catch(e){return {status:e.status||502,data:{error:e.message}};}
}
const writes=()=>events.filter(x=>x.path&&x.method!=='GET');
async function test(name,fn){reset();await fn();passed++;console.log('PASS '+name);}
await test('Admin authority comes only from confirmed server allowlists',()=>{assert.ok(isSetupAdmin(user,env));assert.ok(!isSetupAdmin({...user,email_confirmed_at:null},env));assert.ok(!isSetupAdmin({...user,email:'member@example.invalid',user_metadata:{admin:true}},env));assert.ok(!isSetupAdmin(user,{}));});
await test('Members may read status but never configure agents or inspect backups',async()=>{const member={...user,email:'member@example.invalid'};const r=await invoke('GET',{user:member});assert.equal(r.status,200);assert.equal(r.data.can_manage,false);assert.equal(r.data.connected,false);assert.equal(events.filter(x=>x.db).length,0);events=[];assert.equal((await invoke('POST',{user:member})).status,403);assert.equal(events.length,0);});
await test('Confirmation and revision are required; arbitrary endpoint and secrets rejected',async()=>{for(const body of [{confirm:false},{expected_revision:''},{endpoint:'https://evil.invalid'},{api_key:'forged'}]){assert.equal((await invoke('POST',{body})).status,400);assert.equal(writes().length,0);}});
await test('Configuration fails closed before mutations',async()=>{for(const vars of [{VOICE_RESULT_CALLBACK_SECRET:''},{VOICE_RESULT_CALLBACK_URL:'http://receiver.invalid/api/voice-result'},{VOICE_RESULT_CALLBACK_URL:'https://receiver.invalid/api/voice-result?secret=bad'},{SUPABASE_SERVICE_ROLE_KEY:''}]){assert.equal((await invoke('POST',{env:vars})).status,503);assert.equal(writes().length,0);}});
await test('Stale preview cannot modify shared agents',async()=>{assert.equal((await invoke('POST',{body:{expected_revision:'0'.repeat(64)}})).status,409);assert.equal(writes().length,0);});
await test('Missing database migration and busy lock prevent any external mutation',async()=>{options.noMigration=true;assert.equal((await invoke()).status,503);options.noMigration=false;options.lockBusy=true;assert.equal((await invoke()).status,409);assert.equal(writes().length,0);});
await test('Backup failure stops tool creation and releases lock',async()=>{options.auditFail=true;assert.equal((await invoke()).status,503);assert.equal(writes().length,0);assert.ok(events.some(x=>x.db?.endsWith('voice_agent_setup_locks')&&x.method==='DELETE'));});
await test('Connect creates typed body parameters and preserves prior Agent configuration',async()=>{const original=structuredClone(agent);const r=await invoke();assert.equal(r.status,200);assert.equal(r.data.connected,true);assert.ok(agent.agent_data.system_instruction.startsWith(original.agent_data.system_instruction));assert.ok(agent.agent_data.system_instruction.includes('{{vc_call_reference}}'));assert.deepEqual(agent.voice_data,original.voice_data);assert.deepEqual(agent.transfer,original.transfer);assert.deepEqual(agent.webhook,original.webhook);assert.equal(agent.agent_data.model,'original_model');assert.deepEqual(agent.agent_data.tools[0],original.agent_data.tools[0]);const t=tools[0];assert.equal(t.parameters.properties.needs_agent.type,'boolean');assert.deepEqual(t.parameters.properties.agent_id.enum,[id]);for(const k of t.parameters.required)assert.equal(t.execution.param_map[k].in,'body');const backup=events.find(x=>x.db?.endsWith('voice_agent_setup_audits')&&x.method==='POST');assert.deepEqual(backup.body.before_config,original);assert.ok(events.indexOf(backup)<events.findIndex(x=>x.path==='/platform-config/tools'&&x.method==='POST'));assert.ok(!JSON.stringify(r).includes(env.VOICE_RESULT_CALLBACK_SECRET));assert.ok(!JSON.stringify(r).includes('Original'));});
await test('Repeated connect is idempotent and does not create tools or append instructions twice',async()=>{await invoke();const previous=structuredClone(agent);events=[];const r=await invoke();assert.equal(r.status,200);assert.equal(r.data.already_connected,true);assert.equal(writes().length,0);assert.deepEqual(agent,previous);});
await test('Existing compatible Tool is reused when restoring an unbound Agent',async()=>{await invoke();agent.agent_data.system_instruction='Original';agent.agent_data.tools=[];events=[];assert.equal((await invoke()).status,200);assert.equal(events.filter(x=>x.path==='/platform-config/tools'&&x.method==='POST').length,0);assert.equal(tools.length,1);});
await test('Conflicting Tool name is rejected without overwriting external tools',async()=>{tools=[{name:'vc_result_fixture',tool_id:'unrelated',execution:{endpoint:'https://unrelated.invalid'}}];assert.equal((await invoke()).status,409);assert.equal(writes().length,0);});
await test('Concurrent edit after creating Tool prevents Agent overwrite',async()=>{options.changeAfterCreate=true;assert.equal((await invoke()).status,409);assert.equal(events.filter(x=>x.path==='/agent/create_update_agent').length,0);assert.equal(agent.agent_data.system_instruction,'Concurrent edit');});
await test('Failed agent update is recoverable using stored Tool and backup',async()=>{options.updateFail=true;assert.equal((await invoke()).status,502);assert.equal(tools.length,1);assert.ok(events.some(x=>x.db?.endsWith('voice_agent_setup_audits')&&x.body?.status==='failed'));options.updateFail=false;assert.equal((await invoke()).status,200);assert.equal(tools.length,1);});
await test('Tool creation timeout is never blindly retried and lock is released',async()=>{options.createTimeout=true;assert.equal((await invoke()).status,502);assert.equal(events.filter(x=>x.path==='/platform-config/tools'&&x.method==='POST').length,1);assert.ok(events.some(x=>x.db?.endsWith('voice_agent_setup_locks')&&x.method==='DELETE'));});
await test('Malformed managed block fails before any external mutation',async()=>{agent.agent_data.system_instruction+='[VOICE_CONFIRM_RESULT_SETUP_V1]';assert.equal((await invoke()).status,409);assert.equal(writes().length,0);});
await test('Write-only webhook credentials are never silently cleared',async()=>{agent.webhook={enabled:true,auth:{type:'bearer',has_api_key:true}};assert.equal((await invoke()).status,409);assert.equal(writes().length,0);});
await test('Serverless response ends only after the setup lock is released',async()=>{assert.equal((await invoke()).status,200);const released=events.findIndex(x=>x.db?.endsWith('voice_agent_setup_locks')&&x.method==='DELETE');const sent=events.findIndex(x=>x.response);assert.ok(released>=0&&sent>released);});
await test('A linked member configures only their own account with scoped audits and locks',async()=>{const member={...user,email:'member@example.invalid'};const connection={owner_id:member.id,account_id:'account_fixture'};const r=await invoke('POST',{user:member,connection});assert.equal(r.status,200);assert.equal(r.data.can_manage,true);assert.equal(r.data.connected,true);assert.equal(tools[0].name,'vc_result_v2_fixture');assert.ok(tools[0].description.includes('Voice Confirm account:account_fixture v2'));assert.equal(events.find(x=>x.db?.endsWith('/rpc/acquire_voice_agent_setup')).body.p_account_id,'account_fixture');assert.equal(events.find(x=>x.db?.endsWith('/voice_agent_setup_audits')&&x.method==='POST').body.account_id,'account_fixture');});
await test('A connection owned by someone else never grants setup authority',async()=>{const r=await invoke('POST',{connection:{owner_id:'other_owner',account_id:'other_account'}});assert.equal(r.status,403);assert.equal(events.length,0);});
console.log(`${passed} agent setup checks passed; all credentials, data and network responses are isolated fixtures.`);
