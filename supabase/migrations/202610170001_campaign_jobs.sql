begin;
create table if not exists public.voice_campaign_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.voice_campaigns(id) on delete cascade,
  campaign_version timestamptz not null,
  account_id text not null,
  run_at timestamptz not null,
  next_run_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','running','completed','cancelled','failed')),
  lease_id uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, campaign_version)
);
create unique index if not exists voice_campaign_job_active on public.voice_campaign_jobs(campaign_id) where status in ('scheduled','running');
create index if not exists voice_campaign_job_due on public.voice_campaign_jobs(next_run_at) where status in ('scheduled','running');
alter table public.voice_campaign_jobs enable row level security;
revoke all on public.voice_campaign_jobs from public, anon, authenticated;
grant select on public.voice_campaign_jobs to authenticated;
grant all on public.voice_campaign_jobs to service_role;
drop policy if exists voice_job_owner_read on public.voice_campaign_jobs;
create policy voice_job_owner_read on public.voice_campaign_jobs for select to authenticated using ((select auth.uid())=owner_id);

create table if not exists public.voice_scheduler_health (id boolean primary key default true check (id), last_tick timestamptz not null);
alter table public.voice_scheduler_health enable row level security;
revoke all on public.voice_scheduler_health from public, anon, authenticated;
grant all on public.voice_scheduler_health to service_role;

create or replace function public.claim_voice_campaign_job()
returns setof public.voice_campaign_jobs language plpgsql security definer set search_path='' as $$
declare job public.voice_campaign_jobs;
begin
  -- A short global lease serializes all workers, including overlapping cron requests.
  perform pg_advisory_xact_lock(170017);
  if exists(select 1 from public.voice_campaign_jobs where lease_until>now()) then return; end if;
  select * into job from public.voice_campaign_jobs
    where status in ('scheduled','running') and run_at<=now() and next_run_at<=now()
    order by next_run_at, created_at for update skip locked limit 1;
  if not found then return; end if;
  return query update public.voice_campaign_jobs set status='running', lease_id=gen_random_uuid(),
    lease_until=now()+interval '90 seconds', next_run_at=now()+interval '1 minute', updated_at=now()
    where id=job.id returning *;
end $$;
revoke all on function public.claim_voice_campaign_job() from public, anon, authenticated;
grant execute on function public.claim_voice_campaign_job() to service_role;

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
    or p_metadata->>'voice_account_id' is distinct from job.account_id then raise exception 'invalid_call'; end if;
  perform pg_advisory_xact_lock(hashtextextended(job.owner_id::text,1));
  if (select count(*) from public.voice_call_requests where owner_id=job.owner_id and created_at>now()-interval '1 minute')>=5 then raise exception 'rate_limit'; end if;
  insert into public.voice_call_requests(id,owner_id,destination,agent_id,metadata)
    values(p_id,job.owner_id,p_destination,p_agent_id,p_metadata || jsonb_build_object('schedule_job_id',job.id));
end $$;
revoke all on function public.reserve_scheduled_voice_call(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_scheduled_voice_call(uuid,uuid,uuid,text,text,jsonb) to service_role;
commit;
