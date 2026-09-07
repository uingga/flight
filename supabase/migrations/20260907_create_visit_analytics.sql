-- Shadow analytics: one immutable attribution bucket per visit. No accounts/URLs/IPs in this ledger.
begin;
create table if not exists public.tikitikit_visits (
  id uuid primary key,
  visitor_key text not null check (visitor_key ~ '^[a-f0-9]{64}$'),
  started_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  channel text not null check (channel in ('direct','search','social','ai','referral','campaign','unknown')),
  detail_seen boolean not null default false,
  booking_seen boolean not null default false
);
create index if not exists tikitikit_visits_started_idx on public.tikitikit_visits (started_at);
create index if not exists tikitikit_visits_visitor_idx on public.tikitikit_visits (visitor_key, started_at);
alter table public.tikitikit_visits enable row level security;
revoke all on public.tikitikit_visits from public, anon, authenticated;

-- Short-lived abuse counter, separate from visitor records. Key is a daily HMAC of connection IP.
create table if not exists public.tikitikit_visit_rate_limits (
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  minute timestamptz not null,
  requests integer not null check (requests between 1 and 120),
  primary key (key_hash, minute)
);
alter table public.tikitikit_visit_rate_limits enable row level security;
revoke all on public.tikitikit_visit_rate_limits from public, anon, authenticated;

create or replace function public.tikitikit_record_visit(
  p_id uuid, p_visitor_key text, p_started_at timestamptz, p_channel text, p_action text, p_rate_key text
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := clock_timestamp();
  v_allowed boolean;
  v_written uuid;
begin
  if p_id is null or p_visitor_key is null or p_visitor_key !~ '^[a-f0-9]{64}$'
     or p_rate_key is null or p_rate_key !~ '^[a-f0-9]{64}$'
     or p_channel is null or p_channel not in ('direct','search','social','ai','referral','campaign','unknown')
     or p_action is null or p_action not in ('visit','detail','booking')
     or p_started_at is null or p_started_at > v_now + interval '10 seconds'
     or p_started_at < v_now - interval '24 hours 2 minutes'
     or (p_started_at at time zone 'Asia/Seoul')::date not in (
       (v_now at time zone 'Asia/Seoul')::date, ((v_now - interval '2 minutes') at time zone 'Asia/Seoul')::date
     ) then return 'invalid'; end if;

  insert into public.tikitikit_visit_rate_limits as counter values (p_rate_key, date_trunc('minute',v_now), 1)
  on conflict (key_hash, minute) do update set requests = counter.requests + 1
    where counter.requests < 120 returning true into v_allowed;
  if not coalesce(v_allowed,false) then return 'limited'; end if;

  -- The uniqueness constraint and OR update make refreshes, retries and out-of-order actions idempotent.
  insert into public.tikitikit_visits as visit (id,visitor_key,started_at,channel,detail_seen,booking_seen)
  values (p_id,p_visitor_key,p_started_at,p_channel,p_action = 'detail',p_action = 'booking')
  on conflict (id) do update set
    detail_seen = visit.detail_seen or excluded.detail_seen,
    booking_seen = visit.booking_seen or excluded.booking_seen
  where visit.visitor_key = excluded.visitor_key and visit.started_at = excluded.started_at
  returning id into v_written;
  if v_written is null then return 'conflict'; end if;
  return 'recorded';
end;
$$;

create or replace function public.tikitikit_visit_report(p_day date)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with visits as materialized (
    select * from public.tikitikit_visits
    where started_at >= (p_day::timestamp at time zone 'Asia/Seoul')
      and started_at < ((p_day + 1)::timestamp at time zone 'Asia/Seoul')
      and started_at >= now() - interval '90 days'
  ), totals as (
    select count(*) as sessions, count(distinct visitor_key) as users,
      count(*) filter (where detail_seen) as detail_sessions,
      count(distinct visitor_key) filter (where detail_seen) as detail_users,
      count(*) filter (where booking_seen) as booking_sessions,
      count(distinct visitor_key) filter (where booking_seen) as booking_users
    from visits
  ), channels as (
    select channel, count(*) as sessions, count(distinct visitor_key) as users from visits group by channel
  )
  select jsonb_build_object(
    'day',p_day,'generatedAt',now(),
    'firstRecordedAt',(select min(recorded_at) from public.tikitikit_visits),
    'users',t.users,'sessions',t.sessions,'detailUsers',t.detail_users,'detailSessions',t.detail_sessions,
    'bookingUsers',t.booking_users,'bookingSessions',t.booking_sessions,
    'channels',coalesce((select jsonb_agg(jsonb_build_object('channel',channel,'sessions',sessions,'users',users)
      order by sessions desc,channel) from channels),'[]'::jsonb),
    'reconciled',t.sessions = coalesce((select sum(sessions) from channels),0)
  ) from totals t;
$$;

create or replace function public.tikitikit_cleanup_visits()
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.tikitikit_visits where started_at < now() - interval '90 days';
  delete from public.tikitikit_visit_rate_limits where minute < now() - interval '1 day';
$$;
revoke all on function public.tikitikit_record_visit(uuid,text,timestamptz,text,text,text) from public, anon, authenticated;
revoke all on function public.tikitikit_visit_report(date) from public, anon, authenticated;
revoke all on function public.tikitikit_cleanup_visits() from public, anon, authenticated;
grant execute on function public.tikitikit_record_visit(uuid,text,timestamptz,text,text,text) to service_role;
grant execute on function public.tikitikit_visit_report(date) to service_role;
grant execute on function public.tikitikit_cleanup_visits() to service_role;
commit;
notify pgrst, 'reload schema';
