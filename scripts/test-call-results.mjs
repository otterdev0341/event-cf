import assert from 'node:assert/strict';
import {providerOutcome,matchingLogPath,effectiveOutcome,resultsCsv,latestContactCalls} from '../shared/call-results.mjs';
import {callResultDisplay,talkSeconds,talkDuration,needsFollowUp,awaitingResult,guestBucket,liveBucket,callChoices,readableTranscript,displayPhone} from '../shared/call-display.mjs';
import {unansweredRows} from '../shared/campaign-queue.mjs';
// Backend handler cases live in backend/results_test.go.
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
await test('Completed call never implies confirmed or false needs_agent',()=>assert.deepEqual(providerOutcome({status:'completed',metadata:{variables:{call_result:'CONFIRMED'}}}),{call_result:'UNDETERMINED',needs_agent:null,source:'unavailable'}));
await test('Explicit outputs retain false and reject unknown result codes',()=>{assert.equal(providerOutcome({outputs:{call_result:'CONFIRMED',needs_agent:false}}).needs_agent,false);assert.equal(providerOutcome({call_result:'success'}).call_result,'UNDETERMINED');});
await test('Transcript words never classify response',()=>assert.equal(providerOutcome({},{text:'user: confirmed yes'}).source,'unavailable'));
await test('Logs require exact call linkage, never time or agent proximity',()=>{assert.equal(matchingLogPath(['logs/other.txt'],{call_id:'oc_fixture'}),null);assert.equal(matchingLogPath(['logs/oc_fixture-extra.txt'],{call_id:'oc_fixture'}),null);assert.equal(matchingLogPath(['logs/oc_fixture.txt'],{call_id:'oc_fixture'}),'logs/oc_fixture.txt');assert.equal(matchingLogPath(['a/oc_fixture.txt','b/oc_fixture.txt'],{call_id:'oc_fixture'}),null);});
await test('CSV preserves Thai, quotes, leading zero and escapes spreadsheet formulas',()=>{const text=resultsCsv(['name','phone','note'],[['ทดสอบ','0967033424','=1+1'],['a,"b"','+66967033424','line\n2']]);assert.ok(text.startsWith('\uFEFF'));assert.ok(text.includes('"0967033424"'));assert.ok(text.includes('"\'=1+1"'));assert.ok(text.includes('"a,""b"""'));});
await test('Latest contact result replaces the displayed outcome while keeping all original attempts',()=>{const attempts=[{id:'old',created_at:'2026-01-01T00:00:00Z',metadata:{contact_row:0,campaign_version:'v'},response:{callback:{outcome:{call_result:'CONFIRMED',needs_agent:false,source:'agent_tool'}}}},{id:'new',created_at:'2026-01-02T00:00:00Z',metadata:{contact_row:0,campaign_version:'v'},response:{callback:{outcome:{call_result:'DECLINED',needs_agent:false,source:'agent_tool'}}}}];const latest=latestContactCalls(attempts,'v',1);assert.equal(latest.length,1);assert.equal(effectiveOutcome(latest[0].response).call_result,'DECLINED');assert.equal(attempts.length,2);assert.equal(effectiveOutcome(attempts[0].response).call_result,'CONFIRMED');});
await test('A new pending call does not inherit a previous confirmation and versions or rows are not mixed',()=>{const attempts=[{id:'old',created_at:'2026-01-01',metadata:{contact_row:0,campaign_version:'v'},response:{review:{call_result:'CONFIRMED'}}},{id:'new',created_at:'2026-01-02',metadata:{contact_row:0,campaign_version:'v'},response:{}},{id:'another',created_at:'2026-01-03',metadata:{contact_row:1,campaign_version:'v'},response:{}},{id:'future',created_at:'2026-01-04',metadata:{contact_row:0,campaign_version:'other'},response:{}},{id:'invalid',created_at:'2026-01-05',metadata:{contact_row:99,campaign_version:'v'},response:{}}];const latest=latestContactCalls(attempts,'v',2);assert.deepEqual(latest.map(a=>a.id),['another','new']);assert.equal(effectiveOutcome(latest.find(a=>a.id==='new').response).call_result,'UNDETERMINED');});
await test('Only completed calls without outcomes display ended; failed calls display no answer',()=>{assert.equal(callResultDisplay({status:'completed',response:{}}).label,'วางสายก่อนตอบ');for(const status of ['failed','no-answer']){const display=callResultDisplay({status,response:{}});assert.equal(display.key,'NO_ANSWER');assert.equal(display.label,'ไม่รับสาย');}for(const status of ['queued','ringing','in-progress','unknown','busy','cancelled','canceled'])assert.equal(callResultDisplay({status,response:{}}).key,'UNDETERMINED');assert.equal(effectiveOutcome({}).call_result,'UNDETERMINED');});
await test('Real outcomes override the ended display and late callbacks remain visible',()=>{const attempt={status:'completed',response:{}};assert.equal(callResultDisplay(attempt).key,'ENDED_WITHOUT_RESULT');attempt.response.callback={outcome:{call_result:'CONFIRMED',needs_agent:false,source:'agent_tool'}};assert.equal(callResultDisplay(attempt).label,'มางาน');attempt.response.review={call_result:'DECLINED',needs_agent:false,source:'manual'};assert.equal(callResultDisplay(attempt).key,'DECLINED');});
await test('Talk duration excludes ringing and uses actual connected timestamps',()=>{const attempt={status:'completed',created_at:'2026-10-15T00:00:00Z',response:{followup:{answered_at:'2026-10-15T00:00:30Z',completed_at:'2026-10-15T00:02:35Z'}}};assert.equal(talkSeconds(attempt),125);assert.equal(talkDuration(attempt),'2 นาที 5 วินาที');for(const times of [{},{answered_at:null,completed_at:'2026-10-15T00:02:35Z'},{answered_at:'bad',completed_at:'bad'},{answered_at:'2026-10-15T00:03:00Z',completed_at:'2026-10-15T00:02:35Z'}])assert.equal(talkDuration({status:'completed',response:{followup:times}}),'ยังไม่มีข้อมูลเวลา');assert.equal(talkDuration({status:'completed',response:{followup:{answered_at:'2026-10-15T00:00:00Z',completed_at:'2026-10-15T00:00:00Z'}}}),'0 นาที 0 วินาที');});
await test('Unanswered calls display a dash while numeric duration and known connected time remain available',()=>{for(const status of ['failed','no-answer','busy']){assert.equal(talkDuration({status,response:{followup:{answered_at:null,completed_at:null}}}),status==='busy'?'0 นาที 0 วินาที':'—');assert.equal(talkSeconds({status,response:{}}),null);assert.equal(talkSeconds({status,response:{followup:{answered_at:'invalid'}}}),null);}assert.equal(talkDuration({status:'completed',response:{followup:{answered_at:'2026-10-15T00:00:00Z',completed_at:'2026-10-15T00:00:20Z'}}}),'0 นาที 20 วินาที');});
await test('Follow-up count uses the same rule as the redial scope',()=>{
 const cases=[['failed',{}],['completed',{}],['completed',{followup:{outcome:{call_result:'CALLBACK_REQUESTED'}}}],['completed',{callback:{outcome:{call_result:'CONFIRMED'}}}],['completed',{review:{call_result:'UNDETERMINED'},callback:{outcome:{call_result:'DECLINED'}}}],['completed',{followup:{outcome:{call_result:'WRONG_PERSON'}}}],['in-progress',{}],['busy',{followup:{outcome:{call_result:'NO_ANSWER'}}}]];
 const full=cases.map(([status,response],i)=>({id:'a'+i,status,created_at:'2026-10-01T00:00:00Z',metadata:{contact_row:i},response}));
 const flat=full.map(a=>({...a,review:a.response.review?.call_result,callback:a.response.callback?.outcome?.call_result,followup:a.response.followup?.outcome?.call_result}));
 const redial=unansweredRows(full.map((_,index)=>({index})),flat);
 assert.deepEqual(full.filter(needsFollowUp).map(a=>a.metadata.contact_row),redial);
 assert.deepEqual(redial,[0,1,2,7]);
});
await test('A completed call waits for its result until the backend marks it final or an hour passes',()=>{
 const now=Date.parse('2026-10-01T01:00:00Z');
 const call=(over)=>({status:'completed',created_at:'2026-10-01T00:30:00Z',response:{followup:{final:false}},...over});
 assert.equal(awaitingResult(call(),now),true);
 assert.equal(awaitingResult(call({response:{followup:{final:true}}}),now),false);
 assert.equal(awaitingResult(call({created_at:'2026-09-30T23:00:00Z'}),now),false);
 assert.equal(awaitingResult(call({response:{callback:{outcome:{call_result:'CONFIRMED'}}}}),now),false);
 assert.equal(awaitingResult(call({status:'failed'}),now),false);
});
await test('Every guest falls in one group, and redial plus awaiting equals the redial scope',()=>{
 const now=Date.parse('2026-10-01T01:00:00Z');
 const cases=[['failed',{}],['completed',{followup:{final:true}}],['completed',{followup:{outcome:{call_result:'CALLBACK_REQUESTED'},final:true}}],['completed',{callback:{outcome:{call_result:'CONFIRMED'}}}],['completed',{review:{call_result:'DECLINED'},callback:{outcome:{call_result:'CONFIRMED'}}}],['completed',{followup:{outcome:{call_result:'WRONG_PERSON'}}}],['in-progress',{}],['busy',{}],['completed',{followup:{final:false}}],['completed',{callback:{outcome:{call_result:'REQUEST_AGENT'}}}]];
 const full=cases.map(([status,response],i)=>({id:'a'+i,status,created_at:'2026-10-01T00:30:00Z',metadata:{contact_row:i},response}));
 const flat=full.map(a=>({...a,review:a.response.review?.call_result,callback:a.response.callback?.outcome?.call_result,followup:a.response.followup?.outcome?.call_result}));
 const buckets=full.map(a=>guestBucket(a,now));
 assert.deepEqual(buckets,['redial','redial','redial','confirmed','declined','staff','calling','redial','awaiting','staff']);
 assert.equal(guestBucket(undefined,now),'pending');
 // Only a call still on the line is "calling"; one that ended and waits for its result is "awaiting".
 assert.ok(full.every((a,i)=>(buckets[i]==='awaiting')===awaitingResult(a,now)));
 const redialOrAwaiting=full.filter((a,i)=>buckets[i]==='redial'||buckets[i]==='awaiting').map(a=>a.metadata.contact_row);
 assert.deepEqual(redialOrAwaiting,unansweredRows(full.map((_,index)=>({index})),flat));
 // A call this tab is placing counts as calling until its saved record catches up.
 assert.equal(liveBucket(undefined,'waiting',now),'pending');
 assert.equal(liveBucket(undefined,'submitting',now),'calling');
 assert.equal(liveBucket(full[3],'ringing',now),'calling');
 assert.equal(liveBucket(full[3],undefined,now),'confirmed');
});
await test('Redial calls exactly the "ต้องโทรซ้ำ" group; a call still waiting for its result is not called again',()=>{
 const now=Date.parse('2026-10-01T01:00:00Z');
 // Rows: 0 never called, 1 no answer, 2 confirmed, 3 ended within the hour and still waiting, 4 asked for staff, 5 still ringing, 6 callback requested.
 const calls=[[1,'failed',{}],[2,'completed',{callback:{outcome:{call_result:'CONFIRMED'}}}],[3,'completed',{followup:{final:false}}],[4,'completed',{callback:{outcome:{call_result:'REQUEST_AGENT'}}}],[5,'ringing',{}],[6,'completed',{followup:{outcome:{call_result:'CALLBACK_REQUESTED'},final:true}}]];
 const attempts=calls.map(([row,status,response])=>({id:'c'+row,status,created_at:'2026-10-01T00:30:00Z',metadata:{contact_row:row},response}));
 const rows=[0,1,2,3,4,5,6].map(index=>({index,errors:[]}));
 const {fresh,redial}=callChoices(rows,attempts,now);
 assert.deepEqual(fresh.map(r=>r.index),[0,5]);
 assert.ok(fresh.every(r=>r.redialOf===undefined));
 assert.deepEqual(redial.map(r=>r.index),rows.filter(r=>guestBucket(attempts.find(a=>a.metadata.contact_row===r.index),now)==='redial').map(r=>r.index));
 assert.deepEqual(redial.map(r=>[r.index,r.redialOf]),[[1,'c1'],[6,'c6']]);
 // The one call button: never-called and unfinished rows first, then redials; the waiting row 3 is in neither.
 assert.deepEqual(callChoices(rows,attempts,now).next.map(r=>[r.index,r.redialOf]),[[0,undefined],[5,undefined],[1,'c1'],[6,'c6']]);
});
await test('Transcripts name บอท and แขก, and phones read as Thai numbers',()=>{
 assert.equal(readableTranscript('[turn=a1] Agent: สวัสดีค่ะ\nUser: ได้ครับ\nagent : ขอบคุณค่ะ'),'บอท: สวัสดีค่ะ\nแขก: ได้ครับ\nบอท: ขอบคุณค่ะ');
 assert.equal(readableTranscript('Customer said User: yes'),'Customer said User: yes');
 assert.equal(displayPhone('+66812385265'),'081-238-5265');
 assert.equal(displayPhone('0812385265'),'081-238-5265');
 assert.equal(displayPhone('021234567'),'02-123-4567');
 assert.equal(displayPhone('1150'),'1150');
});
console.log(`${passed} call-result checks passed; no live calls or database writes.`);
