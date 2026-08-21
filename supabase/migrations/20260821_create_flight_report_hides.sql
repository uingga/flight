-- 서로 다른 이용자의 신고가 모이면 추가 크롤 없이 항공권을 잠시 숨긴다.
-- 캐시 원본은 건드리지 않아 관리자가 즉시 되돌릴 수 있다.

alter table public.flight_reports
    add column if not exists network_hash varchar(64),
    add column if not exists device_hash varchar(64);

create index if not exists flight_reports_flight_recent_idx
    on public.flight_reports (flight_id, created_at desc);

create index if not exists flight_reports_network_recent_idx
    on public.flight_reports (network_hash, created_at desc);

create table if not exists public.flight_report_hides (
    flight_id text primary key,
    source text not null check (source in ('ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip')),
    latest_report_id bigint not null references public.flight_reports(id),
    status text not null default 'active'
        check (status in ('active', 'manual', 'released', 'expired', 'resolved')),
    report_count integer not null check (report_count >= 3),
    price_changed_count integer not null default 0 check (price_changed_count >= 0),
    unavailable_count integer not null default 0 check (unavailable_count >= 0),
    hidden_at timestamptz not null default now(),
    expires_at timestamptz,
    released_at timestamptz,
    release_reason text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists flight_report_hides_active_idx
    on public.flight_report_hides (status, expires_at);

create index if not exists flight_report_hides_source_day_idx
    on public.flight_report_hides (source, hidden_at desc);

alter table public.flight_report_hides enable row level security;
revoke all on table public.flight_report_hides from anon, authenticated;

alter table public.flight_report_events
    drop constraint if exists flight_report_events_type_check;

alter table public.flight_report_events
    add constraint flight_report_events_type_check check (event_type in (
        'reported',
        'processing_started',
        'retry_scheduled',
        'confirmed',
        'price_updated',
        'flight_removed',
        'check_failed',
        'auto_hidden',
        'auto_released',
        'manual_hidden',
        'manual_released'
    ));

create or replace function public.record_flight_report_hide_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    next_event_type text;
begin
    if tg_op = 'INSERT' then
        next_event_type := 'auto_hidden';
    elsif old.status is not distinct from new.status then
        return new;
    else
        next_event_type := case new.status
            when 'active' then 'auto_hidden'
            when 'manual' then 'manual_hidden'
            when 'released' then 'manual_released'
            when 'expired' then 'auto_released'
            when 'resolved' then 'auto_released'
            else null
        end;
    end if;

    if next_event_type is not null then
        insert into public.flight_report_events (
            report_id,
            flight_id,
            source,
            event_type,
            details
        ) values (
            new.latest_report_id,
            new.flight_id,
            new.source,
            next_event_type,
            jsonb_strip_nulls(jsonb_build_object(
                'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
                'status', new.status,
                'report_count', new.report_count,
                'price_changed_count', new.price_changed_count,
                'unavailable_count', new.unavailable_count,
                'hidden_at', new.hidden_at,
                'expires_at', new.expires_at,
                'release_reason', new.release_reason
            ))
        );
    end if;

    return new;
end;
$$;

drop trigger if exists flight_report_hide_event_trigger on public.flight_report_hides;
create trigger flight_report_hide_event_trigger
after insert or update of status on public.flight_report_hides
for each row execute function public.record_flight_report_hide_event();

revoke all on function public.record_flight_report_hide_event() from public, anon, authenticated;

comment on table public.flight_report_hides is
    '서로 다른 익명 이용자 신고 3건으로 잠시 숨긴 항공권과 관리자 처리 상태.';
