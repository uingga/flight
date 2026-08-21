-- 항공권 신고가 접수되고 자동 확인되는 모든 상태 변화를 덮어쓰지 않고 보관한다.

create table if not exists public.flight_report_events (
    id bigint generated always as identity primary key,
    report_id bigint not null references public.flight_reports(id),
    flight_id text not null,
    source text not null,
    event_type text not null check (event_type in (
        'reported',
        'processing_started',
        'retry_scheduled',
        'confirmed',
        'price_updated',
        'flight_removed',
        'check_failed'
    )),
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists flight_report_events_report_idx
    on public.flight_report_events (report_id, created_at);

create index if not exists flight_report_events_flight_idx
    on public.flight_report_events (flight_id, created_at desc);

alter table public.flight_report_events enable row level security;
revoke all on table public.flight_report_events from anon, authenticated;
revoke all on sequence public.flight_report_events_id_seq from anon, authenticated;

create or replace function public.record_flight_report_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    next_event_type text;
begin
    if tg_op = 'INSERT' then
        next_event_type := 'reported';
    elsif old.status is not distinct from new.status then
        return new;
    else
        next_event_type := case new.status
            when 'processing' then 'processing_started'
            when 'pending' then 'retry_scheduled'
            when 'confirmed' then 'confirmed'
            when 'updated' then 'price_updated'
            when 'removed' then 'flight_removed'
            when 'check_failed' then 'check_failed'
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
            new.id,
            new.flight_id,
            new.source,
            next_event_type,
            jsonb_strip_nulls(jsonb_build_object(
                'report_type', new.report_type,
                'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
                'status', new.status,
                'attempt_count', new.attempt_count,
                'displayed_price', new.displayed_price,
                'result', new.result
            ))
        );
    end if;

    return new;
end;
$$;

drop trigger if exists flight_report_event_trigger on public.flight_reports;
create trigger flight_report_event_trigger
after insert or update of status on public.flight_reports
for each row execute function public.record_flight_report_event();

revoke all on function public.record_flight_report_event() from public, anon, authenticated;

comment on table public.flight_report_events is
    '항공권 신고 접수·확인·가격 갱신·숨김·실패 상태의 추가 전용 감사 기록.';
