-- Run as project owner in the Supabase SQL Editor. No service-role key is used by the app.
begin;
create table if not exists public.voice_campaigns (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  state text not null default 'editing' check (state in ('editing','saved')),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
create index if not exists voice_campaigns_owner on public.voice_campaigns(owner_id, updated_at desc);
create unique index if not exists voice_one_editing_campaign on public.voice_campaigns(owner_id) where state = 'editing';
alter table public.voice_campaigns enable row level security;
revoke all on public.voice_campaigns from anon, authenticated;
grant select, delete on public.voice_campaigns to authenticated;
create policy voice_campaign_owner_read on public.voice_campaigns for select to authenticated using ((select auth.uid()) = owner_id);
create policy voice_campaign_owner_delete on public.voice_campaigns for delete to authenticated using ((select auth.uid()) = owner_id);

-- CSV headers and original rows are preserved together with their mapping in data.
-- Saving is atomic and detects an edit made in another tab/device.
create or replace function public.save_voice_campaign(p_data jsonb, p_state text, p_expected_updated_at timestamptz default null)
returns public.voice_campaigns language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); cid uuid; existing public.voice_campaigns; saved public.voice_campaigns; r jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_state not in ('editing','saved') or jsonb_typeof(p_data) <> 'object' then raise exception 'invalid_campaign'; end if;
  cid := (p_data->>'id')::uuid;
  if cid is null or coalesce(length(trim(p_data->>'name')),0) not between 1 and 120
    or octet_length(p_data::text) > 4194304
    or jsonb_typeof(p_data->'csv'->'headers') is distinct from 'array'
    or jsonb_typeof(p_data->'csv'->'rows') is distinct from 'array'
    or jsonb_typeof(p_data->'mapping') is distinct from 'object'
    or jsonb_typeof(p_data->'callingDays') is distinct from 'array'
    or jsonb_typeof(p_data->'fileName') is distinct from 'string'
    or jsonb_typeof(p_data->'agentId') is distinct from 'string'
    then raise exception 'invalid_campaign'; end if;
  if jsonb_array_length(p_data->'csv'->'rows') not between 1 and 5000
    or jsonb_array_length(p_data->'csv'->'headers') not between 1 and 100 then raise exception 'invalid_csv'; end if;
  if exists (select 1 from jsonb_array_elements(p_data->'csv'->'headers') v where jsonb_typeof(v) <> 'string')
    or exists (select 1 from jsonb_each(p_data->'mapping') v where jsonb_typeof(v.value) <> 'string') then raise exception 'invalid_mapping'; end if;
  for r in select value from jsonb_array_elements(p_data->'csv'->'rows') loop
    if jsonb_typeof(r) <> 'array' then raise exception 'invalid_csv'; end if;
    if jsonb_array_length(r) <> jsonb_array_length(p_data->'csv'->'headers')
      or exists (select 1 from jsonb_array_elements(r) v where jsonb_typeof(v) <> 'string') then raise exception 'invalid_csv'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into existing from public.voice_campaigns where id = cid for update;
  if found then
    if existing.owner_id <> uid then raise exception 'not_authorized'; end if;
    if p_expected_updated_at is null or existing.updated_at <> p_expected_updated_at then raise exception 'edit_conflict'; end if;
  end if;
  if p_state = 'editing' then
    update public.voice_campaigns set state = 'saved', updated_at = clock_timestamp() where owner_id = uid and state = 'editing' and id <> cid;
  end if;
  insert into public.voice_campaigns(id, owner_id, state, data, updated_at) values (cid, uid, p_state, p_data - 'updatedAt', clock_timestamp())
    on conflict (id) do update set state = excluded.state, data = excluded.data, updated_at = excluded.updated_at
      where public.voice_campaigns.owner_id = uid and public.voice_campaigns.updated_at = p_expected_updated_at
    returning * into saved;
  if saved.id is null then raise exception 'edit_conflict'; end if;
  return saved;
end $$;
revoke all on function public.save_voice_campaign(jsonb, text, timestamptz) from public, anon;
grant execute on function public.save_voice_campaign(jsonb, text, timestamptz) to authenticated;

create table if not exists public.voice_call_requests (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  destination text not null,
  agent_id text not null,
  metadata jsonb not null default '{}',
  call_id text,
  status text not null default 'submitting',
  response jsonb,
  created_at timestamptz not null default now()
);
create index if not exists voice_call_owner_time on public.voice_call_requests(owner_id, created_at desc);
alter table public.voice_call_requests enable row level security;
revoke all on public.voice_call_requests from anon, authenticated;
grant select on public.voice_call_requests to authenticated;
grant update(call_id, status, response) on public.voice_call_requests to authenticated;
create policy voice_call_owner_read on public.voice_call_requests for select to authenticated using ((select auth.uid()) = owner_id);
create policy voice_call_owner_update on public.voice_call_requests for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create or replace function public.reserve_voice_call(p_id uuid, p_destination text, p_agent_id text, p_metadata jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_id is null or p_destination !~ '^\+?[0-9]{8,15}$' or length(p_agent_id) not between 1 and 100
    or jsonb_typeof(p_metadata) <> 'object' or octet_length(p_metadata::text) > 20000 then raise exception 'invalid_call'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 1));
  if (select count(*) from public.voice_call_requests where owner_id = uid and created_at > now() - interval '1 minute') >= 5 then raise exception 'rate_limit'; end if;
  insert into public.voice_call_requests(id, owner_id, destination, agent_id, metadata) values (p_id, uid, p_destination, p_agent_id, p_metadata);
end $$;
revoke all on function public.reserve_voice_call(uuid, text, text, jsonb) from public, anon;
grant execute on function public.reserve_voice_call(uuid, text, text, jsonb) to authenticated;
commit;
