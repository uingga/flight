-- 로그인 인증번호 검증과 문의 메일 발송의 서버 측 속도 제한.
-- 브라우저 역할은 직접 접근할 수 없고 Vercel service role만 RPC를 호출한다.

create table if not exists public.tikitikit_rate_limit_buckets (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (scope, key_hash, window_start),
  constraint tikitikit_rate_limit_scope_length check (char_length(scope) between 1 and 64),
  constraint tikitikit_rate_limit_key_hash check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint tikitikit_rate_limit_count check (request_count between 1 and 100000)
);

create index if not exists tikitikit_rate_limit_updated_idx
  on public.tikitikit_rate_limit_buckets (updated_at);

alter table public.tikitikit_rate_limit_buckets enable row level security;
revoke all on table public.tikitikit_rate_limit_buckets from public, anon, authenticated;

create or replace function public.tikitikit_take_rate_limit(
  p_scope text,
  p_key_hash text,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_allowed boolean;
begin
  if p_scope not in (
    'auth_verify_ip_15m',
    'auth_verify_ip_day',
    'auth_verify_request_15m',
    'contact_ip_hour',
    'contact_ip_day',
    'contact_global_day'
  ) then
    raise exception 'unsupported rate-limit scope';
  end if;
  if p_key_hash !~ '^[a-f0-9]{64}$'
     or p_window_seconds < 60 or p_window_seconds > 86400
     or p_limit < 1 or p_limit > 1000 then
    raise exception 'invalid rate-limit arguments';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.tikitikit_rate_limit_buckets as bucket (
    scope, key_hash, window_start, request_count, updated_at
  ) values (
    p_scope, p_key_hash, v_window_start, 1, clock_timestamp()
  )
  on conflict (scope, key_hash, window_start) do update
    set request_count = bucket.request_count + 1,
        updated_at = clock_timestamp()
    where bucket.request_count < p_limit
  returning true into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

create or replace function public.tikitikit_verify_auth_code(
  p_code_id uuid,
  p_email_hash text,
  p_expected_code_hash text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.tikitikit_auth_codes%rowtype;
begin
  select * into v_code
  from public.tikitikit_auth_codes
  where id = p_code_id and email_hash = p_email_hash
  for update;

  if not found
     or v_code.used_at is not null
     or v_code.expires_at <= clock_timestamp()
     or v_code.attempt_count >= 5 then
    return 'expired';
  end if;

  if v_code.code_hash <> p_expected_code_hash then
    update public.tikitikit_auth_codes
      set attempt_count = attempt_count + 1
      where id = p_code_id;
    return 'wrong';
  end if;

  update public.tikitikit_auth_codes
    set used_at = clock_timestamp()
    where id = p_code_id and used_at is null;
  return 'verified';
end;
$$;

revoke all on function public.tikitikit_take_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.tikitikit_verify_auth_code(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tikitikit_take_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.tikitikit_verify_auth_code(uuid, text, text) to service_role;

comment on table public.tikitikit_rate_limit_buckets is '서버 API의 원자적 고정 창 속도 제한 카운터.';
comment on function public.tikitikit_verify_auth_code(uuid, text, text) is '인증번호 실패 횟수 증가와 성공 사용 처리를 한 트랜잭션에서 수행.';

notify pgrst, 'reload schema';
