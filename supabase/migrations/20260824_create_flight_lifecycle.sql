-- Flight lifecycle tracking: current state + change events + source crawl runs.
-- Internal only. GitHub Actions writes with the service-role key.

create table if not exists public.flight_crawl_runs (
    run_key text primary key,
    observed_at timestamptz not null,
    source text not null,
    status text not null check (status in ('success', 'preserved', 'skipped', 'warning')),
    scraped_count integer,
    observed_count integer not null default 0,
    visible_count integer not null default 0,
    alerts jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists flight_crawl_runs_source_time_idx
    on public.flight_crawl_runs (source, observed_at desc);

create table if not exists public.flight_offer_current (
    offer_key text primary key,
    itinerary_key text not null,
    identity_version smallint not null default 1,
    source text not null,
    source_product_ref text,
    source_flight_id text not null,
    departure_city text not null,
    departure_airport text,
    arrival_city text not null,
    arrival_airport text,
    departure_date date,
    return_date date,
    outbound_time text,
    outbound_arrival_time text,
    return_time text,
    return_arrival_time text,
    airline text,
    flight_number text,
    return_flight_number text,
    listed_price integer not null check (listed_price > 0),
    effective_price integer not null check (effective_price > 0),
    available_seats integer,
    seat_count_kind text not null default 'unknown'
        check (seat_count_kind in ('exact', 'at_least', 'unknown')),
    region text,
    booking_url text,
    is_visible boolean not null default true,
    status text not null default 'active'
        check (status in ('active', 'missing_once', 'paused_estimated', 'ended_estimated')),
    missing_streak integer not null default 0,
    missing_since timestamptz,
    first_seen_at timestamptz not null,
    last_seen_at timestamptz not null,
    last_changed_at timestamptz not null,
    last_run_key text,
    price_checked_at timestamptz,
    comparison_price integer,
    comparison_checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists flight_offer_current_source_status_idx
    on public.flight_offer_current (source, status, last_seen_at desc);
create index if not exists flight_offer_current_itinerary_idx
    on public.flight_offer_current (itinerary_key, last_seen_at desc);
create index if not exists flight_offer_current_route_date_idx
    on public.flight_offer_current (departure_airport, arrival_airport, departure_date);

create table if not exists public.flight_offer_events (
    event_id bigint generated always as identity primary key,
    offer_key text not null,
    itinerary_key text not null,
    source text not null,
    event_type text not null check (event_type in (
        'first_seen',
        'price_changed',
        'seats_changed',
        'visibility_changed',
        'comparison_changed',
        'schedule_changed',
        'missing',
        'paused_estimated',
        'reappeared',
        'ended_estimated'
    )),
    observed_at timestamptz not null,
    run_key text,
    previous_price integer,
    current_price integer,
    previous_seats integer,
    current_seats integer,
    previous_visible boolean,
    current_visible boolean,
    previous_comparison_price integer,
    current_comparison_price integer,
    details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (offer_key, event_type, run_key)
);

create index if not exists flight_offer_events_offer_time_idx
    on public.flight_offer_events (offer_key, observed_at desc);
create index if not exists flight_offer_events_type_time_idx
    on public.flight_offer_events (event_type, observed_at desc);
create index if not exists flight_offer_events_itinerary_time_idx
    on public.flight_offer_events (itinerary_key, observed_at desc);

alter table public.flight_crawl_runs enable row level security;
alter table public.flight_offer_current enable row level security;
alter table public.flight_offer_events enable row level security;

revoke all on table public.flight_crawl_runs from anon, authenticated;
revoke all on table public.flight_offer_current from anon, authenticated;
revoke all on table public.flight_offer_events from anon, authenticated;
revoke all on sequence public.flight_offer_events_event_id_seq from anon, authenticated;

grant select, insert, update on table
    public.flight_crawl_runs,
    public.flight_offer_current,
    public.flight_offer_events
to service_role;

grant usage, select on sequence public.flight_offer_events_event_id_seq to service_role;

comment on table public.flight_crawl_runs is
    'Per-source crawl health used to avoid mistaking collection failures for sold-out offers.';
comment on table public.flight_offer_current is
    'Latest state of each stable travel-agency offer candidate.';
comment on table public.flight_offer_events is
    'Append-only price, seat, visibility, disappearance, and reappearance events.';
