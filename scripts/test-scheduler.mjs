import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { scheduledTime, firstScheduleTime, nextScheduleTime } from '../shared/campaign-schedule.mjs';
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
  await test('Recurring migration installs and is repeatable',async()=>{const sql=readFileSync(new URL('../supabase/migrations/202610170002_optional_recurring_schedules.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);});
  await db.query("insert into voice_campaigns(id,owner_id,state,data) values($1,$2,'saved',$3)",[campaignId,owner,JSON.stringify({agentId:'agt_fixture'})]);
  const version=(await db.query('select updated_at from voice_campaigns')).rows[0].updated_at;
  await db.query("insert into voice_campaign_jobs(owner_id,campaign_id,campaign_version,account_id,run_at,next_run_at) values($1,$2,$3,'account',now()+interval '1 day',now())",[owner,campaignId,version]);
  await test('A future job cannot be claimed',async()=>assert.equal((await db.query('select * from claim_voice_campaign_job()')).rows.length,0));
  await db.exec("update voice_campaign_jobs set run_at=now()-interval '1 second'");
  await test('Only one worker can claim a due job',async()=>{job=(await db.query('select * from claim_voice_campaign_job()')).rows[0];assert.ok(job.lease_id);assert.equal((await db.query('select * from claim_voice_campaign_job()')).rows.length,0);});
  const reserve=(lease=job.lease_id,overrides={})=>db.query("select reserve_scheduled_voice_call($1,$2,$3,'0812345678','agt_fixture',$4)",[job.id,lease,'44444444-4444-4444-8444-444444444444',JSON.stringify({campaign_id:campaignId,campaign_version:version,voice_account_id:'account',schedule_run_id:job.run_id,contact_row:0,...overrides})]);
  await test('A stale worker cannot reserve a call',async()=>assert.rejects(reserve(other),/job_not_active/));
  await test('Cancellation after claim prevents the next reservation',async()=>{await db.exec("update voice_campaign_jobs set status='cancelled'");await assert.rejects(reserve(),/job_not_active/);await db.exec("update voice_campaign_jobs set status='running'");});
  await test('Editing a campaign invalidates the confirmed job',async()=>{await db.exec("update voice_campaigns set updated_at=updated_at+interval '1 second'");await assert.rejects(reserve(),/campaign_changed/);await db.query('update voice_campaigns set updated_at=$1',[version]);});
  await test('Only the current occurrence and authorized rows can reserve calls',async()=>{await assert.rejects(reserve(job.lease_id,{schedule_run_id:other}),/invalid_call/);await db.exec('update voice_campaign_jobs set contact_rows=ARRAY[1]');await assert.rejects(reserve(),/invalid_call/);await db.exec('update voice_campaign_jobs set contact_rows=null');await assert.rejects(reserve(job.lease_id,{campaign_redial_of:other}),/invalid_call/);});
  await test('Durable reservation prevents a duplicate dial after retry',async()=>{await reserve();await assert.rejects(reserve(),/duplicate key|row_already_dispatched/);assert.equal((await db.query('select * from voice_call_requests')).rows.length,1);});
  await test('Expired worker lease cannot reserve another call',async()=>{await db.exec("update voice_campaign_jobs set lease_until=now()-interval '1 second'");await assert.rejects(reserve(),/job_not_active/);});
  await test('A cancelled alarm can be replaced without editing the campaign version',async()=>{await db.exec("update voice_campaign_jobs set status='cancelled'");await db.query("insert into voice_campaign_jobs(owner_id,campaign_id,campaign_version,account_id,run_at,next_run_at) values($1,$2,$3,'account',now()+interval '1 day',now()+interval '1 day')",[owner,campaignId,version]);await assert.rejects(db.query("insert into voice_campaign_jobs(owner_id,campaign_id,campaign_version,account_id,run_at,next_run_at) values($1,$2,$3,'account',now(),now())",[owner,campaignId,version]),/duplicate key/);});
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
  return {dial,get update(){return update;},run:()=>processCampaignJob({store,job:{id:'job',owner_id:owner,campaign_id:campaignId,campaign_version:version,account_id:'account',lease_id:'lease',run_id:'run1',run_at:'2026-10-17T00:00:00Z',...options.job},env:{},invokeCall}),attempt:(row,status,call_id)=>({id:'request'+row,call_id,status,metadata:{campaign_id:campaignId,campaign_version:version,contact_row:row,voice_account_id:'account'}})};
}
await test('A worker tick submits only one row',async()=>{const h=harness();await h.run();assert.equal(h.dial.length,1);assert.equal(h.dial[0].metadata.contact_row,0);assert.equal(h.update.status,'running');});
await test('A running call is polled without dialing again',async()=>{const a=harness().attempt(0,'ringing','oc_old');const h=harness({attempts:[a]});await h.run();assert.equal(h.dial.length,0);assert.equal(h.update.status,'running');});
await test('After a call ends the next row is dialed',async()=>{const h=harness({attempts:[harness().attempt(0,'ringing','oc_old')],status:'completed'});await h.run();assert.equal(h.dial.length,1);assert.equal(h.dial[0].metadata.contact_row,1);});
await test('An uncertain reservation stops the job without redial',async()=>{const h=harness({attempts:[harness().attempt(0,'unknown',null)]});await h.run();assert.equal(h.dial.length,0);assert.equal(h.update.status,'failed');});
await test('Changed campaign or account stops before dialing',async()=>{for(const options of [{changed:true},{account:'foreign'}]){const h=harness(options);await h.run();assert.equal(h.dial.length,0);assert.equal(h.update.status,'failed');}});
await test('All completed rows finish the job without redial',async()=>{const h=harness({attempts:[harness().attempt(0,'completed','a'),harness().attempt(1,'completed','b')]});await h.run();assert.equal(h.dial.length,0);assert.equal(h.update.status,'completed');});
function enrollment(options={}) {
  const version='2026-10-17T00:00:00Z', writes=[], filters=[],requestId='55555555-5555-4555-8555-555555555555';
  const future=new Date(Date.now()+86400000).toISOString().slice(0,10);
  const campaign={id:campaignId,state:'saved',updated_at:version,data:{agentId:'agt_fixture',csv:{headers:['phone'],rows:[['0812345678']]},mapping:{phone:'phone'},variableBindings:{}}};
  const store={from(table){const result=()=>table==='voice_campaigns'?{data:options.foreign?null:campaign}:table==='voice_scheduler_health'?{data:{last_tick:options.stale?'2000-01-01':new Date().toISOString()}}:table==='voice_call_requests'?{data:options.foreignHistory?[{id:'old'}]:[]}:{data:options.active?[{id:'active',status:'scheduled'}]:[]};
    const q={select(){return q;},eq(k,v){filters.push([table,k,v]);return q;},or(){return q;},order(){return q;},limit(){return q;},insert(data){writes.push(data);return q;},single:async()=>({data:{...writes[0]}}),maybeSingle:async()=>table==='voice_campaign_jobs'?{data:options.existing||null}:result(),then(resolve){resolve(result());}};return q;}};
  let response;
  const body={action:'configure',request_id:requestId,consent:true,campaign_version:version,schedule:{date:future,time:'12:00',recurrence:'once',weekdays:[],redial:false}};
  return {writes,filters,body,get response(){return response;},run:overrides=>handleSchedule({method:'POST',body:{...body,...overrides},campaignId,store,user:{id:owner},env:{},connection:{account_id:'account',expires_at:options.expired?'2000-01-01':null},fail:(status,message)=>{throw Object.assign(Error(message),{status});},send:(status,data)=>{response={status,data};},invokeCall:async()=>({agent_data:{greeting_text:'Hello'}})})};
}
await test('Alarm configuration uses the owner and requires explicit consent',async()=>{
  const h=enrollment();await assert.rejects(h.run({consent:false}),e=>e.status===409);assert.equal(h.writes.length,0);
  await h.run();assert.equal(h.writes.length,1);assert.ok(Date.parse(h.writes[0].run_at)>Date.now());assert.equal(h.writes[0].owner_id,owner);assert.ok(h.filters.some(([t,k,v])=>t==='voice_campaigns'&&k==='owner_id'&&v===owner));
});
await test('Unhealthy scheduler, expired token, foreign campaign or incompatible history cannot enqueue',async()=>{
  for(const options of [{stale:true},{expired:true},{foreign:true},{foreignHistory:true},{active:true}]){const h=enrollment(options);await assert.rejects(h.run());assert.equal(h.writes.length,0);}
});
await test('A repeated confirmation returns only its own saved alarm without another insert',async()=>{
  const h=enrollment({existing:{id:'55555555-5555-4555-8555-555555555555',campaign_id:campaignId,campaign_version:'2026-10-17T00:00:00Z',status:'scheduled'}});await h.run();assert.equal(h.writes.length,0);assert.equal(h.response.data.job.id,h.body.request_id);
});
await test('Alarms reject missing weekdays, invalid row selections and forged schedule IDs',async()=>{
  for(const patch of [{request_id:'invalid'},{contact_rows:[]},{contact_rows:[99]},{contact_rows:[0,0]},{schedule:{date:'2027-01-01',time:'09:00',recurrence:'weekly',weekdays:[],redial:false}}]){const h=enrollment();await assert.rejects(h.run(patch));assert.equal(h.writes.length,0);}
});
await test('An existing campaign can receive a new optional recurring alarm',async()=>{
  const h=enrollment();await h.run({schedule:{...h.body.schedule,recurrence:'daily',redial:true}});assert.equal(h.writes[0].recurrence,'daily');assert.equal(h.writes[0].redial,true);
});
await test('An old automatic-create request no longer starts calls',async()=>{const h=enrollment();await assert.rejects(h.run({action:'start'}));assert.equal(h.writes.length,0);});
await test('Daily and weekly alarms advance in Thailand time without catch-up bursts',()=>{
  assert.equal(nextScheduleTime('2026-10-17T02:00:00Z','daily','09:00'),'2026-10-18T02:00:00.000Z');
  assert.equal(nextScheduleTime('2026-10-17T02:00:00Z','weekly','09:00',[1]),'2026-10-19T02:00:00.000Z');
  assert.equal(firstScheduleTime({date:'2026-10-01',time:'09:00',recurrence:'daily'},Date.parse('2026-10-17T10:00:00Z')),'2026-10-18T02:00:00.000Z');
  assert.equal(firstScheduleTime({date:'2026-10-17',time:'09:00',recurrence:'once'},Date.parse('2026-10-17T10:00:00Z')),null);
  assert.equal(nextScheduleTime('2026-12-31T16:59:00Z','daily','00:00'),'2026-12-31T17:00:00.000Z');
});
await test('A completed repeating run waits for the next alarm instead of redialing immediately',async()=>{
  const h=harness({attempts:[harness().attempt(0,'completed','a'),harness().attempt(1,'completed','b')],job:{recurrence:'daily',local_time:'09:00',weekdays:[]}});await h.run();assert.equal(h.dial.length,0);assert.equal(h.update.status,'scheduled');assert.ok(Date.parse(h.update.next_run_at)>Date.now());assert.notEqual(h.update.run_id,'run1');
});
await test('Redial is explicit and every run uses its previous terminal call ID',async()=>{
  const prior=harness().attempt(0,'completed','a');const h=harness({attempts:[prior],job:{redial:true}});await h.run();assert.equal(h.dial.length,1);assert.equal(h.dial[0].metadata.campaign_redial_of,prior.id);
});
await test('A row already dispatched in this alarm occurrence is not sent twice',async()=>{
  const prior=harness().attempt(0,'completed','a');prior.metadata.schedule_job_id='job';prior.metadata.schedule_run_id='run1';const h=harness({attempts:[prior],job:{redial:true}});await h.run();assert.equal(h.dial.length,1);assert.equal(h.dial[0].metadata.contact_row,1);
});
await test('An alarm only dispatches its selected contact rows',async()=>{const h=harness({job:{contact_rows:[1]}});await h.run();assert.equal(h.dial[0].metadata.contact_row,1);});
console.log(`${passed} scheduler checks passed; no real calls made.`);
