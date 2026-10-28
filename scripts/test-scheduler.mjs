import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { scheduledTime, firstScheduleTime, nextScheduleTime } from '../shared/campaign-schedule.mjs';
// Worker and alarm handler cases live in backend/scheduler_test.go.
let passed=0;
async function test(name,run){await run();passed++;console.log('PASS',name);}
await test('Thailand dates stay correct across UTC midnight and reject invalid dates',()=>{
  assert.equal(scheduledTime('2026-10-20','00:15'),'2026-10-19T17:15:00.000Z');
  for(const [d,t] of [['2026-02-30','09:00'],['2026-10-20','24:00'],['2026-10-20','09:60'],['','09:00']])assert.equal(scheduledTime(d,t),null);
});
const db=new PGlite(), owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', campaignId='33333333-3333-4333-8333-333333333333';
let job;
try {
  await db.exec(`create role authenticated; create role anon; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; insert into auth.users values('${owner}'),('${other}');`);
  await db.exec(readFileSync(new URL('../supabase/migrations/202610090001_voice_workspace.sql',import.meta.url),'utf8'));
  await test('Scheduler migration installs and can be reapplied',async()=>{const sql=readFileSync(new URL('../supabase/migrations/202610170001_campaign_jobs.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);});
  await test('Recurring migration installs and is repeatable',async()=>{const sql=readFileSync(new URL('../supabase/migrations/202610170002_optional_recurring_schedules.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);});
  await test('Retry migration installs and is repeatable',async()=>{const sql=readFileSync(new URL('../supabase/migrations/202610280001_campaign_retries.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);});
  await db.query("insert into voice_campaigns(id,owner_id,state,data) values($1,$2,'saved',$3)",[campaignId,owner,JSON.stringify({agentId:'agt_fixture'})]);
  const version=(await db.query('select updated_at from voice_campaigns')).rows[0].updated_at;
  await db.query("insert into voice_campaign_jobs(owner_id,campaign_id,campaign_version,account_id,run_at,next_run_at) values($1,$2,$3,'account',now()+interval '1 day',now())",[owner,campaignId,version]);
  await test('A future job cannot be claimed',async()=>assert.equal((await db.query('select * from claim_voice_campaign_job()')).rows.length,0));
  await db.exec("update voice_campaign_jobs set run_at=now()-interval '1 second'");
  await test('Only one worker can claim a due job',async()=>{job=(await db.query('select * from claim_voice_campaign_job()')).rows[0];assert.ok(job.lease_id);assert.equal(job.max_attempts,3);assert.equal((await db.query('select * from claim_voice_campaign_job()')).rows.length,0);});
  const reserve=(lease=job.lease_id,overrides={})=>db.query("select reserve_scheduled_voice_call($1,$2,$3,'0812345678','agt_fixture',$4)",[job.id,lease,'44444444-4444-4444-8444-444444444444',JSON.stringify({campaign_id:campaignId,campaign_version:version,voice_account_id:'account',schedule_run_id:job.run_id,contact_row:0,...overrides})]);
  await test('A stale worker cannot reserve a call',async()=>assert.rejects(reserve(other),/job_not_active/));
  await test('Cancellation after claim prevents the next reservation',async()=>{await db.exec("update voice_campaign_jobs set status='cancelled'");await assert.rejects(reserve(),/job_not_active/);await db.exec("update voice_campaign_jobs set status='running'");});
  await test('Editing a campaign invalidates the confirmed job',async()=>{await db.exec("update voice_campaigns set updated_at=updated_at+interval '1 second'");await assert.rejects(reserve(),/campaign_changed/);await db.query('update voice_campaigns set updated_at=$1',[version]);});
  await test('Only the current occurrence and authorized rows can reserve calls',async()=>{await assert.rejects(reserve(job.lease_id,{schedule_run_id:other}),/invalid_call/);await db.exec('update voice_campaign_jobs set contact_rows=ARRAY[1]');await assert.rejects(reserve(),/invalid_call/);await db.exec('update voice_campaign_jobs set contact_rows=null');await assert.rejects(reserve(job.lease_id,{campaign_redial_of:other}),/invalid_call/);});
  await test('Durable reservation prevents a duplicate dial after retry',async()=>{await reserve();await assert.rejects(reserve(),/duplicate key|row_already_dispatched/);assert.equal((await db.query('select * from voice_call_requests')).rows.length,1);});
  await test('A run retries its own attempt of the same row at most max_attempts times',async()=>{
    const again=(n,overrides={})=>db.query("select reserve_scheduled_voice_call($1,$2,$3,'0812345678','agt_fixture',$4)",[job.id,job.lease_id,`66666666-6666-4666-8666-${String(n).padStart(12,'0')}`,JSON.stringify({campaign_id:campaignId,campaign_version:version,voice_account_id:'account',schedule_run_id:job.run_id,contact_row:0,campaign_redial_of:'44444444-4444-4444-8444-444444444444',...overrides})]);
    await assert.rejects(again(1,{contact_row:1}),/invalid_call/);
    await again(2);await again(3);
    await assert.rejects(again(4),/row_already_dispatched/);
    assert.equal((await db.query('select * from voice_call_requests')).rows.length,3);
  });
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
await test('Daily and weekly alarms advance in Thailand time without catch-up bursts',()=>{
  assert.equal(nextScheduleTime('2026-10-17T02:00:00Z','daily','09:00'),'2026-10-18T02:00:00.000Z');
  assert.equal(nextScheduleTime('2026-10-17T02:00:00Z','weekly','09:00',[1]),'2026-10-19T02:00:00.000Z');
  assert.equal(firstScheduleTime({date:'2026-10-01',time:'09:00',recurrence:'daily'},Date.parse('2026-10-17T10:00:00Z')),'2026-10-18T02:00:00.000Z');
  assert.equal(firstScheduleTime({date:'2026-10-17',time:'09:00',recurrence:'once'},Date.parse('2026-10-17T10:00:00Z')),null);
  assert.equal(nextScheduleTime('2026-12-31T16:59:00Z','daily','00:00'),'2026-12-31T17:00:00.000Z');
});
console.log(`${passed} scheduler checks passed; no real calls made.`);
