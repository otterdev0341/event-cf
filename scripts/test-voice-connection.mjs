import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleVoice} from '../server/voice.mjs';
import {sealToken,openToken,tokenExpiry} from '../server/connection.mjs';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const env={VITE_SUPABASE_URL:'https://connection-db.invalid',VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',VOICE_CONNECTION_ENCRYPTION_KEY:Buffer.alloc(32,9).toString('base64'),VOICE_BOT_BASE_URL:'https://voice.invalid',VOICE_BOT_ACCESS_TOKEN:'unused-global'};
const jwt=(account='A',exp=Math.floor(Date.now()/1000)+3600)=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:account,exp})).toString('base64url')+'.fixture_signature';
let user,records,requests,options,passed=0;
const reset=()=>{user=owner;records=new Map();requests=[];options={};};
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);requests.push({url,init});
 if(url.hostname==='connection-db.invalid'){
  if(url.pathname==='/auth/v1/user')return Response.json({id:user,email:user+'@example.invalid',email_confirmed_at:'2026-01-01'});
  assert.equal(url.pathname,'/rest/v1/voice_bot_connections');assert.equal(new Headers(init.headers).get('apikey'),'fixture-service');
  const own=url.searchParams.get('owner_id')?.slice(3)||user; assert.equal(own,user,'Only the authenticated owner may use the credential store');
  const original=records.get(own);
  if(init.method==='GET')return Response.json(original||null);
  const expected=url.searchParams.get('updated_at')?.slice(3);
  if(expected && original?.updated_at!==expected)return Response.json([]);
  if(init.method==='DELETE'){records.delete(own);return Response.json([{owner_id:own}]);}
  const value=JSON.parse(init.body);assert.equal(value.owner_id,user);assert.ok(!Object.hasOwn(value,'token'));assert.ok(value.token_ciphertext.startsWith('v1.'));
  if(options.storageFail)return Response.json({message:'private storage failure'},{status:500});
  if(init.method==='POST'&&original)return Response.json({message:'duplicate'},{status:409});
  records.set(own,value);return Response.json([{owner_id:own}]);
 }
 if(url.hostname==='voice.invalid'){
  assert.equal(init.method,'GET','No connection action may dial or alter the provider');assert.equal(url.pathname,'/me');
  if(options.invalidToken)return Response.json({message:'private upstream failure'},{status:401});
  const token=new Headers(init.headers).get('authorization').slice(7);
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));return Response.json({_id:'tenant_'+claims.sub,username:'Account '+claims.sub,email:claims.sub+'@example.invalid',verified:true,password:'do-not-return'});
 }
 throw Error('Unexpected request');
};
async function invoke(body,route='/workspace/connection',headers={}) {
 const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);Object.assign(req,{url:'/api/voice?path='+encodeURIComponent(route),method:body===undefined?'GET':'POST',headers:{authorization:'Bearer fixture-session',...headers}});
 let data;const res={statusCode:200,setHeader(){},end(s){data=JSON.parse(s);}};await handleVoice(req,res,env);return {status:res.statusCode,data};
}
const connect=(token=jwt(),revision=null,id='tenant_A')=>invoke({action:'connect',token,confirm:true,expected_account_id:id,expected_updated_at:revision});
async function test(name,fn){reset();await fn();passed++;console.log('PASS '+name);}
await test('AES-GCM ciphertext is randomized, authenticated and bound to the owner',()=>{const token=jwt(),a=sealToken(token,owner,env),b=sealToken(token,owner,env);assert.notEqual(a,b);assert.equal(openToken(a,owner,env),token);assert.throws(()=>openToken(a,other,env));assert.throws(()=>openToken(a.slice(0,-4)+'AAAA',owner,env));assert.throws(()=>sealToken(token,owner,{...env,VOICE_CONNECTION_ENCRYPTION_KEY:'short'}));});
await test('Unlinked members see a connect state and never inherit a global account',async()=>{assert.deepEqual((await invoke()).data,{connected:false});assert.equal((await invoke(undefined,'/me')).status,428);assert.equal(requests.filter(r=>r.url.hostname==='voice.invalid').length,0);});
await test('Verify shows actual provider identity but neither stores nor returns JWT',async()=>{const token=jwt(),r=await invoke({action:'verify',token});assert.equal(r.status,200);assert.equal(r.data.account.account_id,'tenant_A');assert.equal(records.size,0);assert.ok(!JSON.stringify(r).includes(token));assert.ok(!JSON.stringify(r).includes('do-not-return'));});
await test('Connect requires exact reviewed account and explicit confirmation',async()=>{assert.equal((await invoke({action:'connect',token:jwt(),confirm:false,expected_account_id:'tenant_A'})).status,409);assert.equal((await connect(jwt(),null,'tenant_B')).status,409);assert.equal(records.size,0);});
await test('Personal JWT is encrypted before storage and never returned in GET',async()=>{const token=jwt();assert.equal((await connect(token)).status,200);assert.equal(openToken(records.get(owner).token_ciphertext,owner,env),token);const r=await invoke();assert.equal(r.data.username,'Account A');assert.ok(!JSON.stringify(r).includes(token));assert.ok(!JSON.stringify(r).includes('token_ciphertext'));assert.equal((await invoke(undefined,'/me')).data._id,'tenant_A');});
await test('Two website users keep separate Voice Bot accounts',async()=>{await connect();user=other;assert.equal((await invoke()).data.connected,false);await connect(jwt('B'),null,'tenant_B');assert.equal((await invoke(undefined,'/me')).data._id,'tenant_B');user=owner;assert.equal((await invoke(undefined,'/me')).data._id,'tenant_A');assert.equal(records.size,2);});
await test('Credential replacement and disconnect reject stale previews',async()=>{await connect();assert.equal((await connect(jwt('B'),null,'tenant_B')).status,409);assert.equal((await invoke({action:'disconnect',confirm:true,expected_updated_at:'stale'})).status,409);assert.equal(records.get(owner).account_id,'tenant_A');});
await test('Same-account token renewal and deliberate account replacement work',async()=>{await connect();let revision=records.get(owner).updated_at;assert.equal((await connect(jwt('A',Math.floor(Date.now()/1000)+7200),revision)).status,200);revision=records.get(owner).updated_at;assert.equal((await connect(jwt('B'),revision,'tenant_B')).status,200);assert.equal((await invoke(undefined,'/me')).data._id,'tenant_B');});
await test('Malformed, expired and rejected JWTs never overwrite a valid connection',async()=>{await connect();const previous=structuredClone(records.get(owner));for(const token of ['password',jwt('A',1)])assert.equal((await invoke({action:'verify',token})).status,400);options.invalidToken=true;assert.equal((await invoke({action:'verify',token:jwt('B')})).status,400);assert.deepEqual(records.get(owner),previous);assert.equal(tokenExpiry(jwt('A',undefined))!==null,true);});
await test('Requests cannot specify another owner, ciphertext, callback secret or destination',async()=>{for(const extra of [{owner_id:other},{account_id:'other'},{token_ciphertext:'v1.forged'},{endpoint:'https://evil.invalid'},{callback_secret:'forged'}])assert.equal((await invoke({action:'verify',token:jwt(),...extra})).status,400);assert.equal(records.size,0);});
await test('Cross-site credential writes are rejected before storage access',async()=>{assert.equal((await invoke({action:'verify',token:jwt()},undefined,{'sec-fetch-site':'cross-site'})).status,403);assert.equal(requests.length,1);});
await test('Disconnect removes only the current user credential',async()=>{await connect();user=other;await connect(jwt('B'),null,'tenant_B');user=owner;assert.equal((await invoke({action:'disconnect',confirm:true,expected_updated_at:records.get(owner).updated_at})).status,200);assert.equal(records.has(owner),false);assert.equal(records.has(other),true);assert.equal((await invoke(undefined,'/me')).status,428);});
console.log(`${passed} personal Voice Bot connection checks passed; all credentials and services are isolated fixtures.`);
