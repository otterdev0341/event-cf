import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db=new PGlite(); let passed=0;
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333';
const draft={id,name:'Offline fixture',fileName:'fixture.csv',agentId:'agt_fixture',callingDays:['monday'],csv:{headers:['name','phone'],rows:[['Fixture','0812345678']]},mapping:{name:'guest_name',phone:'phone'}};
await db.exec(`create role authenticated;create role anon;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;grant usage on schema auth to authenticated,anon;insert into auth.users values ('${owner}'),('${other}');`);
async function as(user,role='authenticated'){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec('set role '+role);}
async function save(data=draft,state='editing',version=null){return (await db.query('select to_jsonb(public.save_voice_campaign($1::jsonb,$2,$3::timestamptz)) as record',[JSON.stringify(data),state,version])).rows[0].record;}
async function test(name,run){await run();passed++;console.log('PASS',name);}
try {
await test('Migration executes on a real PostgreSQL engine',async()=>await db.exec(readFileSync(new URL('../supabase/migrations/202610090001_voice_workspace.sql',import.meta.url),'utf8')));
await as(owner);let saved;
await test('Owner can save CSV and read its exact data',async()=>{saved=await save();assert.deepEqual(saved.data.csv,draft.csv);assert.equal((await db.query('select * from public.voice_campaigns')).rows.length,1);});
await test('Same owner update with timestamp succeeds; stale timestamp fails',async()=>{const before=saved.updated_at;saved=await save({...draft,name:'Updated'},'saved',before);await assert.rejects(save(draft,'saved',before),/edit_conflict/);});
await test('Invalid CSV rejected without modifying existing data',async()=>{await assert.rejects(save({...draft,csv:{headers:['x'],rows:[['x','y']]}},'saved',saved.updated_at),/invalid_csv/);assert.equal((await db.query('select data->>\'name\' as name from public.voice_campaigns')).rows[0].name,'Updated');});
await test('Direct insert/update cannot bypass save validation',async()=>{await assert.rejects(db.query("update public.voice_campaigns set state='editing'"),/permission denied/);});
await as(other);
await test('Other user cannot read, delete or overwrite owner campaign',async()=>{assert.equal((await db.query('select * from public.voice_campaigns')).rows.length,0);await db.query('delete from public.voice_campaigns where id=$1',[id]);await assert.rejects(save(),/not_authorized/);});
await as(owner);
await test('Owner campaign survived unauthorized deletion',async()=>assert.equal((await db.query('select * from public.voice_campaigns')).rows.length,1));
await test('Only one editing draft per owner, old draft safely saved',async()=>{saved=await save(draft,'editing',saved.updated_at);await save({...draft,id:'44444444-4444-4444-8444-444444444444'});assert.equal((await db.query("select * from public.voice_campaigns where state='editing'")).rows.length,1);});
async function reserve(n){return db.query("select public.reserve_voice_call($1,'0812345678','agt_fixture','{}'::jsonb)",[`55555555-5555-4555-8555-${String(n).padStart(12,'0')}`]);}
await test('Duplicate call request ID rejected',async()=>{await reserve(1);await assert.rejects(reserve(1),/duplicate key/);});
await test('Sixth call request in one minute is rejected',async()=>{for(let i=2;i<=5;i++)await reserve(i);await assert.rejects(reserve(6),/rate_limit/);});
await as(other);
await test('Other user cannot see or update owner call requests',async()=>{assert.equal((await db.query('select * from public.voice_call_requests')).rows.length,0);assert.equal((await db.query("update public.voice_call_requests set status='fake' returning id")).rows.length,0);});
await as('', 'anon');
await test('Anonymous user cannot read tables or execute save RPC',async()=>{await assert.rejects(db.query('select * from public.voice_campaigns'),/permission denied/);await assert.rejects(save(),/permission denied/);});
console.log(`\n${passed} database checks passed in disposable PostgreSQL; no Supabase data changed.`);
} finally {await db.close();}
