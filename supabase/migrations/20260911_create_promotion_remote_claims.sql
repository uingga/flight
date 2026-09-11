-- Apply after 20260911_create_promotion_daily.sql. Existing history/save RPCs unchanged.
create table public.promotion_remote_claims (
  day date not null references public.promotion_daily_runs(day),
  source text not null check (source in ('threads','ga4')),
  run_id uuid not null references public.promotion_daily_runs(id),
  started_at timestamptz not null default now(),
  primary key(day, source)
);
alter table public.promotion_remote_claims enable row level security;
revoke all on public.promotion_remote_claims from public, anon, authenticated;
grant select, insert on public.promotion_remote_claims to service_role;
create function public.promotion_claim_remote_source(p_day date, p_id uuid, p_source text) returns boolean
language plpgsql security invoker set search_path = public as $$
declare r promotion_daily_runs; inserted integer;
begin
  if p_day is null or p_day <> (now() at time zone 'Asia/Seoul')::date
    or coalesce(p_source,'') not in ('threads','ga4') then return false; end if;
  select * into r from promotion_daily_runs where day = p_day for update;
  if r.id is distinct from p_id or r.status <> 'running' or r.lease_until <= now() + interval '240 seconds' then return false; end if;
  if exists(select 1 from promotion_daily_sources where day = p_day and source = p_source) then return false; end if;
  if p_source = 'ga4' and not exists(select 1 from promotion_daily_sources where day = p_day and source = 'threads') then return false; end if;
  insert into promotion_remote_claims(day,source,run_id) values(p_day,p_source,p_id) on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 1;
end $$;
revoke all on function public.promotion_claim_remote_source(date,uuid,text) from public, anon, authenticated;
grant execute on function public.promotion_claim_remote_source(date,uuid,text) to service_role;
