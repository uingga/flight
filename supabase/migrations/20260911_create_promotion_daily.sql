-- Additive, promotion-only storage. No flight/account tables touched.
create table public.promotion_daily_runs (
  day date primary key, id uuid not null unique, status text not null check (status in ('running','complete','incomplete')),
  started_at timestamptz not null default now(), finished_at timestamptz,
  lease_until timestamptz not null default (now() + interval '25 minutes')
);
create table public.promotion_daily_sources (
  day date not null references public.promotion_daily_runs(day), source text not null,
  payload jsonb not null, primary key(day, source)
);
create table public.promotion_daily_latest (source text primary key, payload jsonb not null);
create table public.promotion_daily_dispatches (
  day date primary key, claimed_at timestamptz not null default now(), status text not null default 'claimed'
    check (status in ('claimed','dispatched','failed'))
);
alter table public.promotion_daily_runs enable row level security;
alter table public.promotion_daily_sources enable row level security;
alter table public.promotion_daily_latest enable row level security;
alter table public.promotion_daily_dispatches enable row level security;
revoke all on public.promotion_daily_runs, public.promotion_daily_sources, public.promotion_daily_latest, public.promotion_daily_dispatches from public, anon, authenticated;
grant select, insert, update on public.promotion_daily_runs, public.promotion_daily_sources, public.promotion_daily_latest, public.promotion_daily_dispatches to service_role;

create function public.promotion_claim_run(p_day date, p_id uuid) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  -- One queue across date boundaries; database time owns the day and lease.
  perform pg_advisory_xact_lock(20260911, 900);
  if p_day <> (now() at time zone 'Asia/Seoul')::date then return false; end if;
  update promotion_daily_runs set status = 'incomplete', finished_at = now()
    where status = 'running' and lease_until <= now();
  if exists(select 1 from promotion_daily_runs where day = p_day or (status = 'running' and lease_until > now())) then return false; end if;
  insert into promotion_daily_runs(day, id, status) values(p_day, p_id, 'running');
  return true;
end $$;

create function public.promotion_save_source(p_day date, p_id uuid, p_source text, p_payload jsonb, p_latest jsonb) returns boolean
language plpgsql security invoker set search_path = public as $$
declare r promotion_daily_runs;
begin
  select * into r from promotion_daily_runs where day = p_day for update;
  if r.id is distinct from p_id or r.status <> 'running' or r.lease_until <= now() then return false; end if;
  if p_source not in ('threads','te31','ga4') or p_payload->>'source' is distinct from p_source
    or p_latest->>'source' is distinct from p_source
    or coalesce(p_payload->>'outcome','') not in ('success','partial','failed','unsupported')
    or jsonb_typeof(p_payload->'posts') is distinct from 'array'
    or jsonb_typeof(p_latest->'posts') is distinct from 'array' then return false; end if;
  if exists(select 1 from promotion_daily_sources where day = p_day and source = p_source) then return false; end if;
  insert into promotion_daily_sources values(p_day, p_source, p_payload);
  insert into promotion_daily_latest values(p_source, p_latest)
    on conflict(source) do update set payload = excluded.payload;
  return true;
end $$;

create function public.promotion_finish_run(p_day date, p_id uuid) returns text
language plpgsql security invoker set search_path = public as $$
declare r promotion_daily_runs; outcome text;
begin
  select * into r from promotion_daily_runs where day = p_day for update;
  if r.id is distinct from p_id or r.status <> 'running' or r.lease_until <= now() then return 'rejected'; end if;
  select case when count(*) = 3 and bool_and(payload->>'outcome' = 'success') then 'complete' else 'incomplete' end
    into outcome from promotion_daily_sources where day = p_day and source in ('threads','te31','ga4');
  update promotion_daily_runs set status = outcome, finished_at = now() where day = p_day;
  return outcome;
end $$;

create function public.promotion_claim_dispatch(p_day date) returns boolean
language plpgsql security invoker set search_path = public as $$
declare inserted integer;
begin
  if p_day <> (now() at time zone 'Asia/Seoul')::date or (now() at time zone 'Asia/Seoul')::time < time '09:00' then return false; end if;
  insert into promotion_daily_dispatches(day) values(p_day) on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;
revoke all on function public.promotion_claim_run(date,uuid), public.promotion_save_source(date,uuid,text,jsonb,jsonb),
  public.promotion_finish_run(date,uuid), public.promotion_claim_dispatch(date) from public, anon, authenticated;
grant execute on function public.promotion_claim_run(date,uuid), public.promotion_save_source(date,uuid,text,jsonb,jsonb),
  public.promotion_finish_run(date,uuid), public.promotion_claim_dispatch(date) to service_role;
