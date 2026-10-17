import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { scheduledTime } from '../shared/campaign-schedule.mjs';
import { processCampaignJob, handleScheduler, handleSchedule } from '../server/scheduler.mjs';
let passed=0;
async function test(name,run){await run();passed++;console.log('PASS',name);}
await test('Thailand dates stay correct across UTC midnight and reject invalid dates',()=>{
  assert.equal(scheduledTime('2026-10-20','00:15'),'2026-10-19T17:15:00.000Z');
  for(const [d,t] of [['2026-02-30','09:00'],['2026-10-20','24:00'],['2026-10-20','09:60'],['','09:00']])assert.equal(scheduledTime(d,t),null);
});
await test('Worker endpoint rejects requests without the dedicated credential',async()=>{
  let status;const res={setHeader(){},set statusCode(v){status=v;},end(){}};
  await handleScheduler({method:'POST',headers:{authorization:'Bearer forged'}},res,{VOICE_RESULT_CALLBACK_SECRET:'fixture-secret-longer-than-thirty-two-characters'});
  assert.equal(status,401);
});
const db=new PGlite(), owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', campaignId='33333333-3333-4333-8333-333333333333';
let job;
try {
  await db.exec(`create role authenticated; create role anon; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; insert into auth.users values('${owner}'),('${other}');`);
  await db.exec(readFileSync(new URL('../supabase/migrations/202610090001_voice_workspace.sql',import.meta.url),'utf8'));
  await test('Scheduler migration installs and can be reapplied',async()=>{const sql=readFileSync(new URL('../supabase/migrations/202610170001_campaign_jobs.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);});
  await db.query("insert into voice_campaigns(id,owner_id,state,data) values($1,$2,'saved',$3)",[campaignId,owner,JSON.stringify({agentId:'agt_fixture'})]);
  const version=(await db.query('select updated_at from voice_campaigns')).rows[0].updated_at;
  await db.query("insert into voice_campaign_jobs(owner_id,campaign_id,campaign_version,account_id,run_at,next_run_at) values($1,$2,$3,'account',now()+interval '1 day',now())",[owner,campaignId,version]);
  await test('A future job cannot be claimed',async()=>assert.equal((await db.query('select * from claim_voice_campaign_job()')).rows.length,0));
  await db.exec("update voice_campaign_jobs set run_at=now()-interval '1 second'");
  await test('Only one worker can claim a due job',async()=>{job=(await db.query('select * from claim_voice_campaign_job()')).rows[0];assert.ok(job.lease_id);assert.equal((await db.query('select * from claim_voice_campaign_job()')).rows.length,0);});
  const reserve=(lease=job.lease_id)=>db.query("select reserve_scheduled_voice_call($1,$2,$3,'0812345678','agt_fixture',$4)",[job.id,lease,'44444444-4444-4444-8444-444444444444',JSON.stringify({campaign_id:campaignId,campaign_version:version,voice_account_id:'account'})]);
  await test('A stale worker cannot reserve a call',async()=>assert.rejects(reserve(other),/job_not_active/));
  await test('Cancellation after claim prevents the next reservation',async()=>{await db.exec("update voice_campaign_jobs set status='cancelled'");await assert.rejects(reserve(),/job_not_active/);await db.exec("update voice_campaign_jobs set status='running'");});
  await test('Editing a campaign invalidates the confirmed job',async()=>{await db.exec("update voice_campaigns set updated_at=updated_at+interval '1 second'");await assert.rejects(reserve(),/campaign_changed/);await db.query('update voice_campaigns set updated_at=$1',[version]);});
  await test('Durable reservation prevents a duplicate dial after retry',async()=>{await reserve();await assert.rejects(reserve(),/duplicate key/);assert.equal((await db.query('select * from voice_call_requests')).rows.length,1);});
  await test('Expired worker lease cannot reserve another call',async()=>{await db.exec("update voice_campaign_jobs set lease_until=now()-interval '1 second'");await assert.rejects(reserve(),/job_not_active/);});
  await test('Other users cannot read jobs, modify them or invoke worker RPCs',async()=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);await db.exec('set role authenticated');
    assert.equal((await db.query('select * from voice_campaign_jobs')).rows.length,0);
    await assert.rejects(db.exec("update voice_campaign_jobs set status='running'"),/permission denied/);
    await assert.rejects(db.exec('select * from claim_voice_campaign_job()'),/permission denied/);
    await assert.rejects(db.exec('select * from voice_scheduler_health'),/permission denied/);await db.exec('reset role');
  });
}finally{await db.close();}

function harness(options={}) {
  const version='2026-10-17T00:00:00+00:00',dial=[];let update;
  const campaign={id:campaignId,state:'saved',updated_at:version,data:{agentId:'agt_fixture',csv:{headers:['phone'],rows:[['0812345678'],['0898765432']]},mapping:{phone:'phone'},variableBindings:{}}};
  const attempts=options.attempts || [];
  const store={auth:{admin:{getUserById:async()=>({data:{user:{id:owner}},error:null})}},from(table){
    const q={select(){return q;},eq(){return q;},order(){return q;},update(value){update=value;return q;},maybeSingle:async()=>({data:options.changed?{...campaign,updated_at:'2027-01-01'}:campaign}),range:async()=>({data:attempts,error:null}),then(resolve){resolve({error:null});}};return q;
  }};
  const invokeCall=async(_env,_store,_user,_job,path,body)=>{
    if(path==='/me')return {_id:options.account || 'account'};
    if(path.startsWith('/agents/'))return {agent_data:{greeting_text:'Hello'}};
    if(path.includes('/overview'))return {sections:{tenant:{ok:true,data:{outbound:{enabled:true},readiness:{pbx:{ready:true}}}},trunk_status:{ok:true,data:{mode:'ip'}}}};
    if(body){dial.push(body);if(options.timeout)throw Error('uncertain');return {call_id:'oc_new'};}
    return {status:options.status || 'ringing'};
  };
  return {dial,get update(){return update;},run:()=>processCampaignJob({store,job:{id:'job',owner_id:owner,campaign_id:campaignId,campaign_version:version,account_id:'account',lease_id:'lease'},env:{},invokeCall}),attempt:(row,status,call_id)=>({id:'request'+row,call_id,status,metadata:{campaign_id:campaignId,campaign_version:version,contact_row:row,voice_account_id:'account'}})};
}
await test('A worker tick submits only one row',async()=>{const h=harness();await h.run();assert.equal(h.dial.length,1);assert.equal(h.dial[0].metadata.contact_row,0);assert.equal(h.update.status,'running');});
await test('A running call is polled without dialing again',async()=>{const a=harness().attempt(0,'ringing','oc_old');const h=harness({attempts:[a]});await h.run();assert.equal(h.dial.length,0);assert.equal(h.update.status,'running');});
await test('After a call ends the next row is dialed',async()=>{const h=harness({attempts:[harness().attempt(0,'ringing','oc_old')],status:'completed'});await h.run();assert.equal(h.dial.length,1);assert.equal(h.dial[0].metadata.contact_row,1);});
await test('An uncertain reservation stops the job without redial',async()=>{const h=harness({attempts:[harness().attempt(0,'unknown',null)]});await h.run();assert.equal(h.dial.length,0);assert.equal(h.update.status,'failed');});
await test('Changed campaign or account stops before dialing',async()=>{for(const options of [{changed:true},{account:'foreign'}]){const h=harness(options);await h.run();assert.equal(h.dial.length,0);assert.equal(h.update.status,'failed');}});
await test('All completed rows finish the job without redial',async()=>{const h=harness({attempts:[harness().attempt(0,'completed','a'),harness().attempt(1,'completed','b')]});await h.run();assert.equal(h.dial.length,0);assert.equal(h.update.status,'completed');});
function enrollment(options={}) {
  const version='2026-10-17T00:00:00Z', writes=[], filters=[];
  const future=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const campaign={id:campaignId,state:'saved',updated_at:version,data:{agentId:'agt_fixture',callStartMode:'scheduled',callStartDate:future,callStartTime:'12:00',csv:{headers:['phone'],rows:[['0812345678']]},mapping:{phone:'phone'},variableBindings:{}}};
  const store={from(table){let inserted=false;const result=()=>table==='voice_campaigns'?{data:options.foreign?null:campaign}:table==='voice_scheduler_health'?{data:{last_tick:options.stale?'2000-01-01':new Date().toISOString()}}:table==='voice_call_requests'?{data:options.previous?[{id:'old'}]:[]}:{data:options.job?[options.job]:[]};const q={select(){return q;},eq(k,v){filters.push([table,k,v]);return q;},order(){return q;},limit(){return q;},insert(data){inserted=true;writes.push(data);return q;},single:async()=>({data:{id:'new',...writes[0]}}),maybeSingle:async()=>result(),then(resolve){resolve(result());}};return q;}};
  let response;
  return {writes,filters,get response(){return response;},run:body=>handleSchedule({method:'POST',body:body || {action:'start',consent:true,campaign_version:version},campaignId,store,user:{id:owner},env:{},connection:{account_id:'account',expires_at:options.expired?'2000-01-01':null},fail:(status,message)=>{throw Object.assign(Error(message),{status});},send:(status,data)=>{response={status,data};},invokeCall:async()=>({agent_data:{greeting_text:'Hello'}})})};
}
await test('Enrollment uses saved date and owner and requires explicit consent',async()=>{
  const h=enrollment();await assert.rejects(h.run({action:'start',campaign_version:'2026-10-17T00:00:00Z'}),e=>e.status===409);assert.equal(h.writes.length,0);
  await h.run();assert.equal(h.writes.length,1);assert.ok(Date.parse(h.writes[0].run_at)>Date.now());assert.equal(h.writes[0].owner_id,owner);assert.ok(h.filters.some(([t,k,v])=>t==='voice_campaigns'&&k==='owner_id'&&v===owner));
});
await test('Unhealthy scheduler, expired token, foreign campaign or old calls cannot enqueue',async()=>{
  for(const options of [{stale:true},{expired:true},{foreign:true},{previous:true}]){const h=enrollment(options);await assert.rejects(h.run());assert.equal(h.writes.length,0);}
});
await test('A repeated confirmation returns the existing job without another insert',async()=>{
  const h=enrollment({job:{id:'existing',campaign_version:'2026-10-17T00:00:00Z',status:'scheduled'}});await h.run();assert.equal(h.writes.length,0);assert.equal(h.response.data.job.id,'existing');
});
console.log(`${passed} scheduler checks passed; no real calls made.`);
