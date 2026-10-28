begin;
-- Automatic retries: a scheduled run may dial one contact row up to max_attempts times.
-- A retry must redial an earlier attempt of the same job, run and row, even when the job does not redial everyone.
alter table public.voice_campaign_jobs add column if not exists max_attempts integer not null default 3 check (max_attempts between 1 and 5);

create or replace function public.reserve_scheduled_voice_call(p_job_id uuid, p_lease_id uuid, p_id uuid, p_destination text, p_agent_id text, p_metadata jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare job public.voice_campaign_jobs; campaign public.voice_campaigns;
begin
  select * into job from public.voice_campaign_jobs where id=p_job_id for update;
  if not found or job.status<>'running' or job.lease_id is distinct from p_lease_id or job.lease_until<=now() or job.run_at>now() then raise exception 'job_not_active'; end if;
  select * into campaign from public.voice_campaigns where id=job.campaign_id and owner_id=job.owner_id for share;
  if not found or campaign.state<>'saved' or campaign.updated_at<>job.campaign_version then raise exception 'campaign_changed'; end if;
  if p_id is null or p_destination !~ '^\+?[0-9]{8,15}$' or p_agent_id is distinct from campaign.data->>'agentId'
    or jsonb_typeof(p_metadata)<>'object' or octet_length(p_metadata::text)>20000
    or p_metadata->>'campaign_id' is distinct from job.campaign_id::text
    or (p_metadata->>'campaign_version')::timestamptz is distinct from job.campaign_version
    or p_metadata->>'voice_account_id' is distinct from job.account_id
    or p_metadata->>'schedule_run_id' is distinct from job.run_id::text
    or (job.contact_rows is not null and not (p_metadata->>'contact_row')::integer=any(job.contact_rows))
    or (not job.redial and p_metadata ? 'campaign_redial_of' and not exists(select 1 from public.voice_call_requests r
      where r.id::text=p_metadata->>'campaign_redial_of' and r.owner_id=job.owner_id and r.metadata->>'schedule_job_id'=job.id::text
        and r.metadata->>'schedule_run_id'=job.run_id::text and r.metadata->>'contact_row'=p_metadata->>'contact_row')) then raise exception 'invalid_call'; end if;
  perform pg_advisory_xact_lock(hashtextextended(job.owner_id::text,1));
  if (select count(*) from public.voice_call_requests where owner_id=job.owner_id and created_at>now()-interval '1 minute')>=5 then raise exception 'rate_limit'; end if;
  if (select count(*) from public.voice_call_requests where owner_id=job.owner_id and metadata->>'schedule_job_id'=job.id::text and metadata->>'schedule_run_id'=job.run_id::text and metadata->>'contact_row'=p_metadata->>'contact_row')>=job.max_attempts then raise exception 'row_already_dispatched'; end if;
  insert into public.voice_call_requests(id,owner_id,destination,agent_id,metadata)
    values(p_id,job.owner_id,p_destination,p_agent_id,p_metadata || jsonb_build_object('schedule_job_id',job.id));
end $$;
revoke all on function public.reserve_scheduled_voice_call(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_scheduled_voice_call(uuid,uuid,uuid,text,text,jsonb) to service_role;
commit;
