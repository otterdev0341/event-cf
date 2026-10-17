import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { connectionStore } from './connection.mjs';
import { prepareCampaignRows, promptVariables } from '../shared/campaign-inputs.mjs';
import { campaignRequestId, terminalCall, latestAttempt } from '../shared/campaign-queue.mjs';
import { firstScheduleTime, nextScheduleTime } from '../shared/campaign-schedule.mjs';

export function schedulerSecret(env) {
  if ((env.VOICE_RESULT_CALLBACK_SECRET || '').length < 32) throw Error('Scheduler is not configured');
  return createHmac('sha256', env.VOICE_RESULT_CALLBACK_SECRET).update('voice-campaign-scheduler-v1').digest('hex');
}
const publicJob = job => job ? Object.fromEntries(['id','campaign_id','campaign_version','run_at','status','last_error','updated_at','recurrence','weekdays','local_time','redial','contact_rows','completed_runs','last_completed_at'].map(k=>[k,job[k]])) : null;

// This context is constructed only by server code, never from HTTP request data.
async function invoke(env, store, user, job, path, body, deadline) {
  const { handleVoice } = await import('./voice.mjs');
  let status, result;
  await handleVoice({method:body?'POST':'GET',url:'/api/voice?path='+encodeURIComponent(path),headers:{},body},
    {setHeader(){},set statusCode(value){status=value;},end(value){result=JSON.parse(value);}},env,{db:store,user,job,deadline});
  if(status!==200 || result?.persistence_warning) throw Error(result?.error || result?.persistence_warning || 'ตรวจบริการโทรไม่สำเร็จ');
  return result;
}

export async function handleSchedule({method,body,campaignId,store,user,env,connection,fail,send,invokeCall=invoke}) {
  const {data:campaign,error}=await store.from('voice_campaigns').select('*').eq('id',campaignId).eq('owner_id',user.id).maybeSingle();
  if(error || !campaign)fail(404,'ไม่พบแคมเปญของคุณ');
  const {data:jobs,error:jobError}=await store.from('voice_campaign_jobs').select('*').eq('campaign_id',campaignId).eq('owner_id',user.id).order('created_at',{ascending:false}).limit(1);
  if(jobError)fail(503,'ระบบตั้งเวลาโทรยังไม่พร้อม กรุณาติดต่อผู้ดูแล');
  const job=jobs?.[0];
  const {data:health}=await store.from('voice_scheduler_health').select('last_tick').eq('id',true).maybeSingle();
  const ready=Boolean(health && Date.now()-Date.parse(health.last_tick)<180000);
  if(method==='GET')return send(200,{job:publicJob(job),ready});
  if(body?.action==='cancel') {
    if(!job || body.job_id!==job.id)fail(409,'คิวเปลี่ยนแล้ว กรุณารีเฟรช');
    const {error}=await store.from('voice_campaign_jobs').update({status:'cancelled',updated_at:new Date().toISOString()}).eq('id',job.id).eq('owner_id',user.id).in('status',['scheduled','running','failed']);
    if(error)fail(503,'ยกเลิกคิวไม่ได้ กรุณาลองใหม่');
    return send(200,{job:publicJob({...job,status:'cancelled'}),ready});
  }
  if(body?.action!=='configure' || body.consent!==true || body.campaign_version!==campaign.updated_at || campaign.state!=='saved')fail(409,'กรุณาตรวจและยืนยันแคมเปญล่าสุดก่อนตั้งเวลา');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id || ''))fail(400,'ไม่มีรหัสการตั้งเวลา');
  // The browser keeps this ID through retries; each new confirmation has its own ID.
  const {data:existing,error:existingError}=await store.from('voice_campaign_jobs').select('*').eq('owner_id',user.id).eq('id',body.request_id).maybeSingle();
  if(existingError)fail(503,'ตรวจการตั้งเวลาเดิมไม่ได้');
  if(existing) {
    if(existing.campaign_id!==campaignId || Date.parse(existing.campaign_version)!==Date.parse(campaign.updated_at))fail(409,'รหัสการตั้งเวลานี้ถูกใช้แล้ว');
    return send(200,{job:publicJob(existing),ready});
  }
  if(job && ['scheduled','running'].includes(job.status))fail(409,'แคมเปญนี้มีคิวอยู่แล้ว กรุณายกเลิกคิวเดิมก่อน');
  if(!ready)fail(503,'ตัวตั้งเวลาโทรยังไม่พร้อม ยังไม่ได้เริ่มคิว กรุณาลองใหม่ภายหลัง');
  if(!connection || connection.expires_at && Date.parse(connection.expires_at)<=Date.now())fail(428,'กรุณาเชื่อมบัญชี Voice Bot ใหม่ก่อนตั้งเวลา');
  const rule=body.schedule;
  if(!rule || !['once','daily','weekly'].includes(rule.recurrence) || typeof rule.redial!=='boolean' || !Array.isArray(rule.weekdays) || rule.weekdays.length>7 || rule.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6) || new Set(rule.weekdays).size!==rule.weekdays.length)fail(400,'รูปแบบการตั้งเวลาไม่ถูกต้อง');
  const runAt=firstScheduleTime(rule);
  if(!runAt)fail(400,'กรุณาเลือกวันเวลาในอนาคต และวันที่ต้องการโทรซ้ำให้ครบ (เวลาไทย)');
  const selected=body.contact_rows ?? null;
  if(selected!==null && (!Array.isArray(selected) || !selected.length || selected.length>5000 || new Set(selected).size!==selected.length || selected.some(i=>!Number.isInteger(i)||i<0||i>=(campaign.data.csv?.rows?.length || 0))))fail(400,'กรุณาเลือกรายชื่อให้ถูกต้อง');
  if(connection.expires_at && Date.parse(connection.expires_at)<=Date.parse(runAt))fail(428,'Session Voice Bot จะหมดอายุก่อนเวลาโทร กรุณาเชื่อมใหม่');
  const agent=await invokeCall(env,store,user,null,`/agents/${campaign.data.agentId}`);
  const rows=prepareCampaignRows(campaign.data,promptVariables(agent));
  const targets=rows.rows.filter(r=>selected===null || selected.includes(r.index));
  if(rows.errors.length || !targets.length || targets.some(r=>r.errors.length))fail(400,'ข้อมูลรายชื่อหรือการจับคู่ Agent ยังไม่ครบ');
  if(campaign.data.voiceAccountId && campaign.data.voiceAccountId!==connection.account_id)fail(409,'บัญชี Voice Bot ไม่ตรงกับแคมเปญ');
  const {data:foreign,error:attemptError}=await store.from('voice_call_requests').select('id').eq('owner_id',user.id).eq('metadata->>campaign_id',campaignId).or(`metadata->>voice_account_id.is.null,metadata->>voice_account_id.neq.${connection.account_id},metadata->>campaign_version.is.null,metadata->>campaign_version.neq.${campaign.updated_at}`).limit(1);
  if(attemptError)fail(503,'อ่านประวัติการโทรไม่ได้');
  if(foreign?.length)fail(409,'ประวัติใช้บัญชีหรือแคมเปญเวอร์ชันอื่น กรุณาตรวจประวัติก่อนตั้งเวลา');
  const {data:saved,error:saveError}=await store.from('voice_campaign_jobs').insert({id:body.request_id,owner_id:user.id,campaign_id:campaignId,campaign_version:campaign.updated_at,account_id:connection.account_id,run_at:runAt,next_run_at:runAt,recurrence:rule.recurrence,weekdays:rule.recurrence==='weekly'?rule.weekdays:[],local_time:rule.time,redial:rule.redial,contact_rows:selected,run_id:randomUUID()}).select('*').single();
  if(saveError)fail(409,'บันทึกคิวไม่ได้หรือมีคิวแล้ว กรุณารีเฟรชสถานะ');
  return send(200,{job:publicJob(saved),ready});
}

export async function processCampaignJob({store,job,env,invokeCall=invoke}) {
  const deadline=AbortSignal.timeout(45000);
  const finish=async(status,error=null,extra={})=>{
    const {error:saveError}=await store.from('voice_campaign_jobs').update({status,last_error:error,lease_id:null,lease_until:null,updated_at:new Date().toISOString(),...extra}).eq('id',job.id).eq('lease_id',job.lease_id).eq('status','running');
    if(saveError)throw Error('Could not save worker progress');
  };
  try {
    const {data:{user},error:authError}=await store.auth.admin.getUserById(job.owner_id);
    if(authError || !user)throw Error('ไม่พบบัญชีเจ้าของแคมเปญ');
    const {data:campaign,error}=await store.from('voice_campaigns').select('*').eq('id',job.campaign_id).eq('owner_id',job.owner_id).maybeSingle();
    if(error || !campaign || campaign.state!=='saved' || Date.parse(campaign.updated_at)!==Date.parse(job.campaign_version))throw Error('แคมเปญถูกแก้ไขหลังยืนยัน คิวหยุดแล้ว');
    const call=(path,body)=>invokeCall(env,store,user,job,path,body,deadline);
    const account=await call('/me');
    if(account._id!==job.account_id)throw Error('บัญชี Voice Bot เปลี่ยนแล้ว คิวหยุดแล้ว');
    const attempts=[];
    for(let offset=0;;offset+=500) {
      const {data,error}=await store.from('voice_call_requests').select('id,call_id,status,created_at,metadata').eq('owner_id',job.owner_id).eq('metadata->>campaign_id',job.campaign_id).order('created_at').order('id').range(offset,offset+499);
      if(error)throw Error('อ่านประวัติการโทรไม่ได้');
      attempts.push(...data); if(data.length<500)break;
    }
    if(attempts.some(a=>a.metadata.voice_account_id!==job.account_id || a.metadata.campaign_version!==campaign.updated_at))throw Error('บัญชีหรือเวอร์ชันของประวัติไม่ตรงกับคิว');
    const pending=attempts.filter(a=>!terminalCall(a.status));
    if(pending.length>1)throw Error('พบหลายสายยังไม่จบ กรุณาตรวจประวัติ');
    for(const attempt of pending) {
      if(!attempt.call_id)throw Error('ยังยืนยันคำขอเดิมไม่ได้ คิวหยุดเพื่อป้องกันโทรซ้ำ');
      const result=await call(`/v1/provisioning/tenants/${job.account_id}/calls/${attempt.call_id}`);
      if(!terminalCall(result.status)){await finish('running');return;}
      attempt.status=result.status;
    }
    const agent=await call(`/agents/${campaign.data.agentId}`);
    const prepared=prepareCampaignRows(campaign.data,promptVariables(agent));
    const targets=prepared.rows.filter(r=>!job.contact_rows || job.contact_rows.includes(r.index));
    if(prepared.errors.length || !targets.length || targets.some(r=>r.errors.length))throw Error('ข้อมูล Agent หรือรายชื่อเปลี่ยนแล้ว กรุณาตรวจแคมเปญ');
    const thisRun=attempts.filter(a=>a.metadata.schedule_job_id===job.id && a.metadata.schedule_run_id===job.run_id);
    const row=targets.find(r=>!thisRun.some(a=>a.metadata.contact_row===r.index) && (job.redial || !latestAttempt(attempts,r.index)));
    if(!row){
      const completed={completed_runs:(job.completed_runs || 0)+1,last_completed_at:new Date().toISOString()};
      if(job.recurrence && job.recurrence!=='once') {
        const next=nextScheduleTime(Math.max(Date.now(),Date.parse(job.run_at)),job.recurrence,job.local_time,job.weekdays);
        if(!next)throw Error('คำนวณรอบถัดไปไม่ได้ กรุณาตั้งเวลาใหม่');
        await finish('scheduled',null,{...completed,run_at:next,next_run_at:next,run_id:randomUUID()});
      } else await finish('completed',null,completed);
      return;
    }
    const previous=latestAttempt(attempts,row.index);
    const redialOf=previous?.id;
    if(previous && (!previous.call_id || !terminalCall(previous.status)))throw Error('ยังยืนยันสายก่อนหน้าไม่ได้ คิวหยุดเพื่อป้องกันโทรซ้ำ');
    const overview=await call(`/v1/provisioning/tenants/${job.account_id}/overview?include=tenant,trunk_status`);
    const config=overview.sections?.tenant,trunk=overview.sections?.trunk_status;
    if(!config?.ok || !trunk?.ok || !config.data.outbound?.enabled || trunk.data.disabled_at || !config.data.readiness?.pbx?.ready || (trunk.data.mode!=='ip' && trunk.data.registration?.state!=='registered'))throw Error('คู่สายไม่พร้อม กรุณาตรวจการเชื่อมต่อ');
    const result=await call(`/v1/provisioning/tenants/${job.account_id}/calls`,{consent:true,destination:row.destination,agent_id:campaign.data.agentId,request_id:await campaignRequestId(campaign.id,campaign.updated_at,row.index,redialOf),metadata:{variables:{},campaign_id:campaign.id,campaign_version:campaign.updated_at,campaign_batch:true,contact_row:row.index,...(redialOf?{campaign_redial_of:redialOf}:{})}});
    if(!result.call_id)throw Error('ไม่ได้รับ Call ID คิวหยุดเพื่อป้องกันโทรซ้ำ');
    await finish('running');
  } catch(error) {
    await finish('failed',error.message?.slice(0,500) || 'คิวหยุด กรุณาตรวจการเชื่อมต่อ');
  }
}

export async function handleScheduler(req,res,env=process.env) {
  const send=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));};
  try {
    const expected=Buffer.from('Bearer '+schedulerSecret(env)), supplied=Buffer.from(String(req.headers.authorization || ''));
    if(req.method!=='POST' || supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return send(401,{error:'Unauthorized'});
    const store=connectionStore(env,AbortSignal.timeout(55000));
    const {error}=await store.from('voice_scheduler_health').upsert({id:true,last_tick:new Date().toISOString()});
    if(error)throw Error('Scheduler database unavailable');
    const {data:jobs,error:claimError}=await store.rpc('claim_voice_campaign_job');
    if(claimError)throw Error('Could not claim job');
    if(jobs?.[0])await processCampaignJob({store,job:jobs[0],env});
    return send(200,{ok:true,processed:jobs?.length || 0});
  }catch {return send(503,{error:'Scheduler unavailable'});}
}
