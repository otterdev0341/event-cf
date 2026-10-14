import assert from 'node:assert/strict';
import { normalizeCaller, lookupEvents, handleInboundEvents } from '../server/inbound-events.mjs';

const account = 'account_fixture', owner = 'owner_fixture', cid = '11111111-1111-4111-8111-111111111111';
const campaign = (id = cid) => ({ id, updated_at: '2026-10-14T00:00:00Z', data: { name: 'Fixture event', eventDate: '2026-10-20', eventTime: '10:00',
  csv: { headers: ['phone','private_note'], rows: [['0812345678','PRIVATE_CUSTOMER_NOTE']] }, mapping: { phone: 'phone' },
  inboundInfo: { accountId: account, enabled: true, location: 'Fixture venue', details: 'Public event details' } } });
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS '+name); }
await test('Normalize Thai caller formats and reject hidden or malformed identity', () => {
  for (const value of ['0812345678','+66812345678','66812345678','081-234-5678']) assert.equal(normalizeCaller(value), '+66812345678');
  for (const value of [null, '', 'anonymous', 'PRIVATE', '08123', '{{caller_number}}']) assert.equal(normalizeCaller(value), null);
});
await test('Match by mapped phone; repeated CSV contacts yield one event', () => {
  const record = campaign(); record.data.csv.rows.push(['+66812345678','SECRET']);
  const result = lookupEvents([record], account, '+66812345678');
  assert.equal(result.status, 'matched'); assert.equal(result.events.length, 1);
});
await test('Multiple events are returned for explicit choice, never arbitrarily selected', () => {
  assert.equal(lookupEvents([campaign(), campaign('22222222-2222-4222-8222-222222222222')], account, '0812345678').status, 'choose_event');
});
await test('Disabled, other-account and unmapped campaigns are excluded', () => {
  const disabled = campaign(); disabled.data.inboundInfo.enabled = false;
  const other = campaign(); other.data.inboundInfo.accountId = 'other_account';
  const unmapped = campaign(); unmapped.data.mapping = {};
  assert.deepEqual(lookupEvents([disabled,other,unmapped],account,'0812345678'), {status:'no_match', events:[]});
});
await test('Lookup projects only event facts, never CSV notes or contact rows', () => {
  const serialized = JSON.stringify(lookupEvents([campaign()], account, '0812345678'));
  assert.ok(!serialized.includes('PRIVATE_CUSTOMER_NOTE')); assert.ok(!serialized.includes('0812345678')); assert.ok(!serialized.includes('csv'));
  assert.ok(serialized.includes('Public event details'));
});
await test('Unavailable caller never matches blank CSV cells', () => {
  const record=campaign(); record.data.csv.rows=[['','PRIVATE']];
  assert.deepEqual(lookupEvents([record],account,'anonymous'), {status:'caller_unavailable',events:[]});
});

async function invoke({body={call_id:'call_fixture'}, action='lookup', method='POST', connectionAccount=account, direction='inbound', stale=false, race=false}={}) {
  const filters=[], writes=[]; let sent;
  const row=campaign();
  const chain={ select(){return chain;}, eq(key,value){filters.push([key,value]);return chain;}, order(){return chain;},
    range(){return Promise.resolve({data:[row],error:null});}, maybeSingle(){return Promise.resolve({data:row,error:null});},
    update(value){writes.push(value);return chain;}, then(resolve){return Promise.resolve({data:race?[]:[{...row,data:writes[0].data}],error:null}).then(resolve);} };
  const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
  const upstream=async path=>path==='/me'?{_id:account}:path==='/calls/call_fixture'?{id:'call_fixture',direction,number:'+66812345678'}:assert.fail('Unexpected upstream route');
  try { await handleInboundEvents({action,id:cid,method,body:stale?{account_id:account,enabled:true,location:'Fixture',details:'Facts',expected_updated_at:'stale'}:body,
    user:{id:owner}, connection:{account_id:connectionAccount,owner_id:owner}, store:{from(name){assert.equal(name,'voice_campaigns');return chain;}},upstream,fail,send:(status,data)=>{sent={status,data};}}); }
  catch(error){sent={status:error.status||500};}
  return {sent,filters,writes};
}
await test('Authenticated lookup reads canonical number by call ID and scopes database owner/state', async () => {
  const result=await invoke(); assert.equal(result.sent.status,200); assert.equal(result.sent.data.status,'matched');
  assert.ok(result.filters.some(([k,v])=>k==='owner_id'&&v===owner)); assert.ok(result.filters.some(([k,v])=>k==='state'&&v==='saved')); assert.equal(result.writes.length,0);
});
await test('Reject client supplied phone numbers and outbound call identities', async () => {
  assert.equal((await invoke({body:{call_id:'call_fixture',phone_number:'0812345678'}})).sent.status,400);
  assert.equal((await invoke({direction:'outbound'})).sent.status,404);
});
await test('Connection mismatch fails before reading campaign records', async () => {
  const result=await invoke({connectionAccount:'other_account'}); assert.equal(result.sent.status,403);assert.equal(result.filters.length,0);
});
await test('Stale event edits cannot overwrite campaign data', async () => {
  const result=await invoke({action:'save',stale:true});assert.equal(result.sent.status,409);assert.equal(result.writes.length,0);
});
await test('Event save preserves CSV and outbound data and checks owner, state and timestamp', async () => {
  const result=await invoke({action:'save',body:{account_id:account,enabled:true,location:'New venue',details:'New factual details',expected_updated_at:'2026-10-14T00:00:00Z'}});
  assert.equal(result.sent.status,200);assert.equal(result.writes.length,1);
  assert.deepEqual(result.writes[0].data.csv,campaign().data.csv);assert.equal(result.writes[0].data.eventDate,'2026-10-20');
  assert.equal(result.writes[0].data.inboundInfo.accountId,account);
  assert.equal(result.filters.filter(([k,v])=>k==='owner_id'&&v===owner).length,2);
  assert.ok(result.filters.some(([k,v])=>k==='updated_at'&&v==='2026-10-14T00:00:00Z'));
});
await test('Concurrent event save reports conflict rather than success', async () => {
  const result=await invoke({action:'save',race:true,body:{account_id:account,enabled:true,location:'New venue',details:'Facts',expected_updated_at:'2026-10-14T00:00:00Z'}});
  assert.equal(result.sent.status,409);
});
console.log(`${passed} inbound event tests passed`);
