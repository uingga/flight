-- 항공권 정보 신고와 자동 재확인 결과를 보관한다.
-- 가격 장기 기록 테이블과 독립적이며 service-role 서버/자동화만 접근한다.

create table if not exists public.flight_reports (
    id bigint generated always as identity primary key,
    reporter_hash varchar(64) not null,
    dedupe_key varchar(64) not null unique,
    flight_id text not null,
    source text not null check (source in ('ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip')),
    report_type text not null check (report_type in ('price_changed', 'unavailable')),
    status text not null default 'pending'
        check (status in ('pending', 'processing', 'confirmed', 'updated', 'removed', 'check_failed')),
    attempt_count integer not null default 0 check (attempt_count between 0 and 10),
    report_count integer not null default 1 check (report_count >= 1),
    departure_city text not null,
    arrival_city text not null,
    -- 일부 여행사는 "2026.09.02(수)"처럼 요일까지 제공하므로 원문을 보존한다.
    departure_date text not null,
    arrival_date text not null,
    airline text,
    displayed_price integer not null check (displayed_price > 0),
    price_checked_at timestamptz,
    payload jsonb not null default '{}'::jsonb,
    result jsonb,
    created_at timestamptz not null default now(),
    last_reported_at timestamptz not null default now(),
    processing_started_at timestamptz,
    processed_at timestamptz
);

create index if not exists flight_reports_pending_idx
    on public.flight_reports (status, created_at);

create index if not exists flight_reports_reporter_flight_idx
    on public.flight_reports (reporter_hash, flight_id, last_reported_at desc);

alter table public.flight_reports enable row level security;
revoke all on table public.flight_reports from anon, authenticated;
revoke all on sequence public.flight_reports_id_seq from anon, authenticated;

comment on table public.flight_reports is
    '사용자가 신고한 항공권과 자동 재확인 결과. 공개 클라이언트 접근 금지.';
