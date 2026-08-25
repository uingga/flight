-- 가격·조건형 특가 웹 푸시 구독과 발송 이력을 서버 전용으로 보관한다.
-- 브라우저는 Next.js API만 호출하며 이 테이블과 RPC에는 직접 접근하지 않는다.

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null,
  endpoint_hash text not null,
  subscription jsonb not null,
  departure_city text not null,
  arrival_city text not null,
  departure_date_from date,
  departure_date_to date,
  max_price integer not null check (max_price between 10000 and 10000000),
  request_hash text not null,
  active boolean not null default true,
  last_notified_price integer,
  last_notified_flight_id text,
  notified_flight_ids jsonb not null default '[]'::jsonb,
  last_sent_at timestamptz,
  last_test_at timestamptz,
  delivery_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_alerts_subscription_object
    check (jsonb_typeof(subscription) = 'object'),
  constraint price_alerts_notified_ids_array
    check (jsonb_typeof(notified_flight_ids) = 'array'),
  constraint price_alerts_date_range
    check (departure_date_from is null or departure_date_to is null or departure_date_from <= departure_date_to)
);

-- 이미 운영에서 수동 생성된 테이블도 이 파일 하나로 현재 API가 요구하는
-- 전체 스키마가 되도록 빠진 열을 재실행 가능하게 보강한다.
alter table public.price_alerts
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists alert_key text,
  add column if not exists endpoint_hash text,
  add column if not exists subscription jsonb,
  add column if not exists departure_city text,
  add column if not exists arrival_city text,
  add column if not exists departure_date_from date,
  add column if not exists departure_date_to date,
  add column if not exists max_price integer,
  add column if not exists request_hash text,
  add column if not exists active boolean default true,
  add column if not exists last_notified_price integer,
  add column if not exists last_notified_flight_id text,
  add column if not exists notified_flight_ids jsonb default '[]'::jsonb,
  add column if not exists last_sent_at timestamptz,
  add column if not exists last_test_at timestamptz,
  add column if not exists delivery_claimed_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- 초기 수동 테이블에서 JSON으로 만든 경우 JSONB로 무손실 승격한다.
-- 그 밖의 임의 형식은 조용히 덮지 않고 적용 전에 바로 알 수 있게 중단한다.
do $$
declare
  subscription_type text;
  notified_ids_type text;
begin
  select data_type into subscription_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'price_alerts' and column_name = 'subscription';
  select data_type into notified_ids_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'price_alerts' and column_name = 'notified_flight_ids';

  if subscription_type = 'json' then
    alter table public.price_alerts
      alter column subscription type jsonb using subscription::jsonb;
  elsif subscription_type <> 'jsonb' then
    raise exception 'price_alerts.subscription 형식이 json/jsonb가 아닙니다: %', subscription_type;
  end if;

  if notified_ids_type = 'json' then
    alter table public.price_alerts
      alter column notified_flight_ids type jsonb using notified_flight_ids::jsonb;
  elsif notified_ids_type <> 'jsonb' then
    raise exception 'price_alerts.notified_flight_ids 형식이 json/jsonb가 아닙니다: %', notified_ids_type;
  end if;
end
$$;

-- 기존 행은 보존하되, 필수값이 없던 수동 스키마도 인덱스와 API가 정상 작동할
-- 수 있도록 결정적인 값으로 한 번만 백필한다. 구독 자체가 없던 행은 발송하지 않는다.
update public.price_alerts
   set alert_key = coalesce(nullif(alert_key, ''), id::text),
       endpoint_hash = coalesce(
         nullif(endpoint_hash, ''),
         md5(coalesce(subscription ->> 'endpoint', id::text))
           || md5('tikitikit:' || coalesce(subscription ->> 'endpoint', id::text))
       ),
       subscription = case
         when jsonb_typeof(subscription) = 'object' then subscription
         else '{}'::jsonb
       end,
       departure_city = coalesce(nullif(departure_city, ''), '전체'),
       arrival_city = coalesce(nullif(arrival_city, ''), '전체'),
       departure_date_from = case
         when departure_date_from is not null
          and departure_date_to is not null
          and departure_date_from > departure_date_to then null
         else departure_date_from
       end,
       departure_date_to = case
         when departure_date_from is not null
          and departure_date_to is not null
          and departure_date_from > departure_date_to then null
         else departure_date_to
       end,
       max_price = greatest(10000, least(10000000, coalesce(max_price, 200000))),
       request_hash = coalesce(
         nullif(request_hash, ''),
         md5(coalesce(alert_key, id::text)) || md5('request:' || coalesce(alert_key, id::text))
       ),
       active = case
         when jsonb_typeof(subscription) is distinct from 'object'
           or nullif(subscription ->> 'endpoint', '') is null then false
         else coalesce(active, true)
       end,
       notified_flight_ids = case
         when jsonb_typeof(notified_flight_ids) = 'array' then notified_flight_ids
         else '[]'::jsonb
       end,
       created_at = coalesce(created_at, now()),
       updated_at = coalesce(updated_at, created_at, now())
 where nullif(alert_key, '') is null
    or nullif(endpoint_hash, '') is null
    or jsonb_typeof(subscription) is distinct from 'object'
    or nullif(departure_city, '') is null
    or nullif(arrival_city, '') is null
    or max_price is null
    or max_price not between 10000 and 10000000
    or nullif(request_hash, '') is null
    or active is null
    or jsonb_typeof(notified_flight_ids) is distinct from 'array'
    or created_at is null
    or updated_at is null
    or (
      departure_date_from is not null
      and departure_date_to is not null
      and departure_date_from > departure_date_to
    );

-- 기존 id 형식은 운영 테이블이 이미 사용하던 serial/uuid 방식을 보존한다.
-- 값을 임의 변환하지 않고, 발송 대상을 하나로 지칭할 수 없는 상태만 명확히 막는다.
do $$
begin
  if exists (select 1 from public.price_alerts where id is null) then
    raise exception 'price_alerts.id에 NULL이 있습니다. 운영 id 형식을 확인해 먼저 복구하세요.';
  end if;
  if exists (
    select 1 from public.price_alerts group by id having count(*) > 1
  ) then
    raise exception 'price_alerts.id가 중복되어 있습니다. 중복 행을 정리한 뒤 다시 실행하세요.';
  end if;
  if exists (
    select 1 from public.price_alerts group by alert_key having count(*) > 1
  ) then
    raise exception 'price_alerts.alert_key가 중복되어 있습니다. 같은 알림을 병합한 뒤 다시 실행하세요.';
  end if;
end
$$;

alter table public.price_alerts
  alter column id set not null,
  alter column alert_key set not null,
  alter column endpoint_hash set not null,
  alter column subscription set not null,
  alter column departure_city set not null,
  alter column arrival_city set not null,
  alter column max_price set not null,
  alter column request_hash set not null,
  alter column active set default true,
  alter column active set not null,
  alter column notified_flight_ids set default '[]'::jsonb,
  alter column notified_flight_ids set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

-- 기존 수동 테이블에도 신규 생성 테이블과 같은 데이터 제약을 붙인다.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.price_alerts'::regclass
       and conname = 'price_alerts_subscription_object'
  ) then
    alter table public.price_alerts
      add constraint price_alerts_subscription_object
      check (jsonb_typeof(subscription) = 'object');
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.price_alerts'::regclass
       and conname = 'price_alerts_notified_ids_array'
  ) then
    alter table public.price_alerts
      add constraint price_alerts_notified_ids_array
      check (jsonb_typeof(notified_flight_ids) = 'array');
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.price_alerts'::regclass
       and conname = 'price_alerts_date_range'
  ) then
    alter table public.price_alerts
      add constraint price_alerts_date_range
      check (departure_date_from is null or departure_date_to is null or departure_date_from <= departure_date_to);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.price_alerts'::regclass
       and conname = 'price_alerts_max_price_range'
  ) then
    alter table public.price_alerts
      add constraint price_alerts_max_price_range
      check (max_price between 10000 and 10000000);
  end if;
end
$$;

create unique index if not exists price_alerts_id_uidx
  on public.price_alerts (id);

create unique index if not exists price_alerts_alert_key_uidx
  on public.price_alerts (alert_key);

create index if not exists price_alerts_active_updated_idx
  on public.price_alerts (active, updated_at desc);

create index if not exists price_alerts_endpoint_active_idx
  on public.price_alerts (endpoint_hash, active, last_sent_at desc);

create index if not exists price_alerts_request_created_idx
  on public.price_alerts (request_hash, created_at desc);

create index if not exists price_alerts_delivery_claim_idx
  on public.price_alerts (delivery_claimed_at)
  where active = true and delivery_claimed_at is not null;

alter table public.price_alerts enable row level security;
revoke all on table public.price_alerts from anon, authenticated;
grant select, insert, update, delete on table public.price_alerts to service_role;

-- 여러 크롤 작업이 겹쳐도 한 브라우저(endpoint)에는 KST 하루 한 번만 발송한다.
-- 잠금은 15분 뒤 자동으로 효력을 잃어 중단된 작업이 다음 회차를 영구 차단하지 않는다.
create or replace function public.claim_price_alert_delivery(p_alert_id text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_endpoint text;
  korea_day_start timestamptz;
begin
  select coalesce(nullif(endpoint_hash, ''), subscription ->> 'endpoint')
    into target_endpoint
    from public.price_alerts
   where id::text = p_alert_id
     and active = true
   for update;

  if target_endpoint is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_endpoint, 0));
  korea_day_start := date_trunc('day', timezone('Asia/Seoul', now())) at time zone 'Asia/Seoul';

  if exists (
    select 1
      from public.price_alerts
     where active = true
       and coalesce(nullif(endpoint_hash, ''), subscription ->> 'endpoint') = target_endpoint
       and (
         last_sent_at >= korea_day_start
         or delivery_claimed_at >= now() - interval '15 minutes'
       )
  ) then
    return false;
  end if;

  update public.price_alerts
     set delivery_claimed_at = now(),
         updated_at = now()
   where id::text = p_alert_id
     and active = true;

  return found;
end;
$$;

revoke all on function public.claim_price_alert_delivery(text) from public, anon, authenticated;
grant execute on function public.claim_price_alert_delivery(text) to service_role;

comment on table public.price_alerts is
  '노선형 가격 알림과 조건형 특가 알림의 웹 푸시 구독·중복 방지·발송 이력. 서버 전용.';
comment on function public.claim_price_alert_delivery(text) is
  '같은 푸시 endpoint의 KST 일일 중복 발송을 원자적으로 막는 15분 발송 잠금.';

notify pgrst, 'reload schema';
