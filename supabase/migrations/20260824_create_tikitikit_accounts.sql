-- 티키티킷 자체 이메일 일회용 코드 로그인과 개인 기능 저장소.
-- 브라우저는 이 표에 직접 접근하지 않고, Vercel 서버 API만 service role로 접근한다.

create extension if not exists pgcrypto;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.tikitikit_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  email_normalized text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz not null default now(),
  constraint tikitikit_users_email_length check (char_length(email) between 5 and 254)
);

create table if not exists public.tikitikit_auth_codes (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  request_hash text not null,
  code_hash text not null,
  attempt_count integer not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tikitikit_auth_codes_attempts check (attempt_count between 0 and 10)
);

create index if not exists tikitikit_auth_codes_email_created_idx
  on public.tikitikit_auth_codes (email_hash, created_at desc);
create index if not exists tikitikit_auth_codes_request_created_idx
  on public.tikitikit_auth_codes (request_hash, created_at desc);

create table if not exists public.tikitikit_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.tikitikit_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists tikitikit_auth_sessions_user_idx
  on public.tikitikit_auth_sessions (user_id, expires_at desc);
create index if not exists tikitikit_auth_sessions_expiry_idx
  on public.tikitikit_auth_sessions (expires_at);

create table if not exists public.tikitikit_user_favorites (
  user_id uuid not null references public.tikitikit_users(id) on delete cascade,
  flight_id text not null,
  flight_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, flight_id)
);

create table if not exists public.tikitikit_user_recent_flights (
  user_id uuid not null references public.tikitikit_users(id) on delete cascade,
  flight_id text not null,
  flight_snapshot jsonb not null,
  viewed_at timestamptz not null default now(),
  primary key (user_id, flight_id)
);

create index if not exists tikitikit_user_recent_viewed_idx
  on public.tikitikit_user_recent_flights (user_id, viewed_at desc);

create table if not exists public.tikitikit_user_saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.tikitikit_users(id) on delete cascade,
  name text not null,
  filters jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tikitikit_user_saved_search_name_length check (char_length(name) between 1 and 40)
);

create index if not exists tikitikit_user_saved_searches_user_idx
  on public.tikitikit_user_saved_searches (user_id, updated_at desc);

alter table public.tikitikit_users enable row level security;
alter table public.tikitikit_auth_codes enable row level security;
alter table public.tikitikit_auth_sessions enable row level security;
alter table public.tikitikit_user_favorites enable row level security;
alter table public.tikitikit_user_recent_flights enable row level security;
alter table public.tikitikit_user_saved_searches enable row level security;

revoke all on table public.tikitikit_users from anon, authenticated;
revoke all on table public.tikitikit_auth_codes from anon, authenticated;
revoke all on table public.tikitikit_auth_sessions from anon, authenticated;
revoke all on table public.tikitikit_user_favorites from anon, authenticated;
revoke all on table public.tikitikit_user_recent_flights from anon, authenticated;
revoke all on table public.tikitikit_user_saved_searches from anon, authenticated;

comment on table public.tikitikit_users is '티키티킷 로그인 사용자. 서버 API 전용.';
comment on table public.tikitikit_auth_codes is '10분 만료 이메일 로그인 코드의 해시와 발급 제한 정보.';
comment on table public.tikitikit_auth_sessions is '30일 만료 로그인 세션. 원문 토큰은 저장하지 않음.';
comment on table public.tikitikit_user_favorites is '사용자가 찜한 항공권과 당시 표시 정보.';
comment on table public.tikitikit_user_recent_flights is '로그인 사용자가 최근 상세 열람한 항공권 최대 30건.';
comment on table public.tikitikit_user_saved_searches is '로그인 사용자가 저장한 필터 조건 최대 10건.';

-- API 요청 때도 정리하지만, 로그인 요청이 없는 날에도 보유 기간을 넘기지 않도록
-- 매일 03:15 KST(18:15 UTC)에 만료된 인증 흔적과 세션을 지운다.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'tikitikit-auth-cleanup') then
    perform cron.schedule(
      'tikitikit-auth-cleanup',
      '15 18 * * *',
      $cleanup$
        delete from public.tikitikit_auth_codes where expires_at < now() - interval '24 hours';
        delete from public.tikitikit_auth_sessions where expires_at < now();
      $cleanup$
    );
  end if;
end
$$;
