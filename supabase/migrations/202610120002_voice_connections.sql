begin;
create table if not exists public.voice_bot_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  account_id text not null check(account_id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  username text not null default '', email text not null default '', role text not null default '',
  verified boolean, expires_at timestamptz,
  token_ciphertext text not null check(token_ciphertext like 'v1.%' and length(token_ciphertext)<20000),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.voice_bot_connections enable row level security;
revoke all on public.voice_bot_connections from public,anon,authenticated;
grant all on public.voice_bot_connections to service_role;
alter table public.voice_agent_setup_locks add column if not exists account_id text not null default 'legacy';
alter table public.voice_agent_setup_locks drop constraint if exists voice_agent_setup_locks_pkey;
alter table public.voice_agent_setup_locks add primary key(account_id,agent_id);
alter table public.voice_agent_setup_audits add column if not exists account_id text not null default 'legacy';
drop function if exists public.acquire_voice_agent_setup(text,uuid);
create or replace function public.acquire_voice_agent_setup(p_agent_id text,p_lock_id uuid,p_account_id text default 'legacy')
returns boolean language plpgsql security definer set search_path='' as $$
declare acquired uuid;
begin
  if p_agent_id !~ '^agt_[a-zA-Z0-9_-]+$' or p_account_id !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'invalid_agent'; end if;
  insert into public.voice_agent_setup_locks(account_id,agent_id,lock_id,expires_at)
  values(p_account_id,p_agent_id,p_lock_id,clock_timestamp()+interval '120 seconds')
  on conflict(account_id,agent_id) do update set lock_id=excluded.lock_id,expires_at=excluded.expires_at
  where public.voice_agent_setup_locks.expires_at<clock_timestamp() returning lock_id into acquired;
  return acquired is not null;
end $$;
revoke all on function public.acquire_voice_agent_setup(text,uuid,text) from public,anon,authenticated;
grant execute on function public.acquire_voice_agent_setup(text,uuid,text) to service_role;
commit;
