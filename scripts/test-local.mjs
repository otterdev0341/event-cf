import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }
const asModule = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText).toString('base64');
const source = readFileSync(new URL('../src/lib/campaigns.ts', import.meta.url), 'utf8');
let session = { user: { id: 'test-owner' }, access_token: 'test-session' };
let rows = [], dbError = null, revision = 0;
const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null };
globalThis.__testDb = {
  auth: { getSession: async () => ({ data: { session } }) },
  from: () => {
    const chain = { select: () => chain, eq: () => chain, order: () => chain, range: async (from,to) => ({data: rows.slice(from,to+1), error: dbError}), delete: () => ({ eq: async (_,id) => { rows = rows.filter(r => r.id !== id); return { error: dbError }; } }) }; return chain;
  },
  rpc: async (_, args) => {
    if (dbError) return {data:null,error:dbError};
    const existing = rows.find(r => r.id === args.p_data.id);
    if (existing && existing.updated_at !== args.p_expected_updated_at) return {data:null,error:{message:'edit_conflict'}};
    const saved = {id: args.p_data.id, data:args.p_data, state:args.p_state, updated_at: `version-${++revision}`};
    rows = [saved, ...rows.filter(r => r.id !== saved.id).map(r => args.p_state === 'editing' ? {...r,state:'saved'} : r)];
    return {data:saved,error:null};
  }
};
const libUrl=asModule(source.replace("import { supabase } from './supabase';", 'const supabase = globalThis.__testDb;'));
const lib = await import(libUrl);
globalThis.fetch = () => { throw new Error('Unexpected network in offline tests'); };
await test('CSV preserves Thai text, BOM, CRLF and national phone prefix', () => assert.deepEqual(lib.parseCsv('\uFEFFguest_name,phone\r\nผู้ทดสอบ,0812345678\r\n').rows,[['ผู้ทดสอบ','0812345678']]));
await test('CSV quoted commas, multiline text and escaped quotes', () => assert.deepEqual(lib.parseCsv('a,b\n"A, B","one\n""two"""').rows,[['A, B','one\n"two"']]));
await test('Malformed/empty CSV and over 5000 rows rejected', () => { for(const s of ['', 'a,b', 'a,\nx,y', 'a,A\nx,y', 'a,b\nx', 'a,b\n"open', 'a,b\n"x"z,b','phone\n'+'0812345678\n'.repeat(5001)]) assert.throws(()=>lib.parseCsv(s)); });
await test('Mapping avoids duplicate aliases and validates phone', () => { assert.deepEqual(lib.suggestMapping(['ชื่อ','phone_number','mobile']),{'ชื่อ':'guest_name',phone_number:'phone',mobile:''}); assert.equal(lib.mappingErrors(lib.parseCsv('phone\ninvalid'),{phone:'phone'}).length,1); });
await test('Agent mapping keeps phone and removes fields absent from the new prompt', () => {
 const csv=lib.parseCsv('name,phone_number,booking_id\nFixture,0812345678,B1');
 assert.deepEqual(lib.mappingForAgent(csv,{name:'guest_name',phone_number:'phone',booking_id:'old_field'},['booking_id']),{name:'',phone_number:'phone',booking_id:'booking_id'});
});
await test('Returning to the same Agent preserves explicitly skipped columns', () => {
 const csv=lib.parseCsv('guest_name,phone_number\nFixture,0812345678');
 assert.deepEqual(lib.mappingForAgent(csv,{guest_name:'',phone_number:'phone'},['guest_name'],false),{guest_name:'',phone_number:'phone'});
});
await test('Agent without prompt variables can map the dial destination', () => {
 const csv=lib.parseCsv('guest_name,phone_number\nFixture,0812345678');
 const map=lib.mappingForAgent(csv,{},[]); assert.equal(map.phone_number,'phone');assert.equal(map.guest_name,'');assert.equal(lib.mappingErrors(csv,map).length,0);
});
await test('National destination is preserved unless +66 explicitly requested', () => { assert.equal(lib.formatDialDestination('081-234-5678'),'0812345678'); assert.equal(lib.formatDialDestination('081-234-5678','international'),'+66812345678'); });
const draft = {id:'11111111-1111-4111-8111-111111111111',name:'Offline fixture',fileName:'fixture.csv',csv:lib.parseCsv('name,phone\nFixture,0812345678'),mapping:{name:'guest_name',phone:'phone'},callingDays:['monday'],agentId:'fixture-agent',eventDate:'2026-10-10',updatedAt:''};
await test('Per-contact values come from CSV and explicit overrides', () => { const v=lib.resolveVariables(draft,0,{bride_name:'Provided'}); assert.equal(v.guest_name,'Fixture'); assert.equal(v.event_date,'2026-10-10'); assert.equal(v.bride_name,'Provided'); assert.equal(v.phone,undefined); });
await test('Cloud save, reopen and completion update rather than duplicate', async () => { await lib.loadCampaignWorkspace('test-owner'); const saved=await lib.saveDraft(draft); assert.equal(lib.getDraft().id,draft.id); const done=await lib.completeDraft(saved); assert.equal(lib.getDraft(),null); assert.equal(lib.getCampaigns().length,1); await lib.saveDraft(done); assert.equal(lib.getDraft().id,draft.id); });
await test('Stale cloud version is rejected', async () => { await assert.rejects(lib.saveDraft(draft),/อีกหน้าต่าง/); });
await test('Missing table is an error, never an empty success', async () => { dbError={code:'PGRST205',message:'missing'}; await assert.rejects(lib.loadCampaignWorkspace('test-owner'),/ยังไม่ได้ติดตั้ง/); dbError=null; });
await test('Account switch clears cached records and prevents saving', async () => { await lib.loadCampaignWorkspace('test-owner'); session={user:{id:'other-owner'},access_token:'other-session'}; await assert.rejects(lib.saveDraft(draft),/บัญชีเปลี่ยน/); assert.equal(lib.getDraft(),null); assert.deepEqual(lib.getCampaigns(),[]); session={user:{id:'test-owner'},access_token:'test-session'}; });
await test('Legacy data is not silently loaded into cloud', async () => { memory.set('voice-confirm:draft:v1',JSON.stringify(draft)); lib.clearWorkspace(); assert.equal(lib.getLegacyCampaigns().length,1); assert.equal(lib.getDraft(),null); memory.set('voice-confirm:draft:v1','{'); assert.deepEqual(lib.getLegacyCampaigns(),[]); });
const clientSource=readFileSync(new URL('../src/services/botnoi/client.ts',import.meta.url),'utf8').replace("import { supabase } from '../../lib/supabase';",'const supabase = globalThis.__testDb;').replaceAll('import.meta.env.BASE_URL',"'/event-confirm/'");
const clientUrl=asModule(clientSource), client=await import(clientUrl);
await test('No session prevents any network request',async()=>{session=null;await assert.rejects(client.botnoiFetch('/me'),/เข้าสู่ระบบ/);session={user:{id:'test-owner'},access_token:'test-session'};});
await test('Browser sends only Supabase session to same-origin backend',async()=>{globalThis.fetch=async(url,init)=>{assert.equal(url,'/event-confirm/api/voice?path=%2Fme');assert.equal(init.headers.get('Authorization'),'Bearer test-session');return Response.json({_id:'fixture'});};assert.equal((await client.botnoiFetch('/me'))._id,'fixture');});
await test('Absolute upstream URLs cannot bypass backend',async()=>{await assert.rejects(client.botnoiFetch('https://evil.invalid/me'),/เส้นทาง/);});
await test('Backend failure is surfaced without fallback data',async()=>{globalThis.fetch=async()=>Response.json({error:'not allowed'},{status:403});await assert.rejects(client.botnoiFetch('/me'),/not allowed/);});
const outbound=await import(asModule(readFileSync(new URL('../src/services/botnoi/outbound.ts',import.meta.url),'utf8').replace('"../../lib/campaigns"',JSON.stringify(libUrl)).replace('"./client"',JSON.stringify(clientUrl))));
await test('Outbound payload carries consent, request ID and user variables',async()=>{let count=0;globalThis.fetch=async(url,init)=>{count++;const b=JSON.parse(init.body);assert.equal(b.destination,'0812345678');assert.equal(b.consent,true);assert.equal(b.request_id,draft.id);assert.equal(b.metadata.variables.guest_name,'Fixture');return Response.json({call_id:'offline-call'});}; await outbound.placeCall('tenant','081-234-5678','agent',{requestId:draft.id,variables:{guest_name:'Fixture'}});assert.equal(count,1);});
console.log(`\n${passed} local checks passed; no external requests.`);
