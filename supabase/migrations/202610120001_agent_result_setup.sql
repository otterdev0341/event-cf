begin;
create table if not exists public.voice_agent_setup_locks (
  agent_id text primary key,
  lock_id uuid not null,
  expires_at timestamptz not null
);
create table if not exists public.voice_agent_setup_audits (
  id uuid primary key,
  actor_id uuid not null references auth.users(id),
  agent_id text not null,
  before_config jsonb not null,
  tool_id text,
  status text not null check (status in ('started','connected','failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.voice_agent_setup_locks enable row level security;
alter table public.voice_agent_setup_audits enable row level security;
revoke all on public.voice_agent_setup_locks, public.voice_agent_setup_audits from public, anon, authenticated;
grant all on public.voice_agent_setup_locks, public.voice_agent_setup_audits to service_role;
create or replace function public.acquire_voice_agent_setup(p_agent_id text, p_lock_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare acquired uuid;
begin
  if p_agent_id !~ '^agt_[a-zA-Z0-9_-]+$' then raise exception 'invalid_agent'; end if;
  insert into public.voice_agent_setup_locks(agent_id,lock_id,expires_at)
  values(p_agent_id,p_lock_id,clock_timestamp()+interval '120 seconds')
  on conflict(agent_id) do update set lock_id=excluded.lock_id, expires_at=excluded.expires_at
  where public.voice_agent_setup_locks.expires_at < clock_timestamp()
  returning lock_id into acquired;
  return acquired is not null;
end $$;
revoke all on function public.acquire_voice_agent_setup(text,uuid) from public, anon, authenticated;
grant execute on function public.acquire_voice_agent_setup(text,uuid) to service_role;
commit;
