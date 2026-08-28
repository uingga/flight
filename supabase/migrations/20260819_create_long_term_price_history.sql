-- Long-term price history for internal analysis and editorial decisions.
-- Public clients must not read or write these tables. GitHub Actions uses the
-- service-role key, which bypasses RLS.

create table if not exists public.flight_price_daily (
    snapshot_date date not null,
    flight_key text not null,
    flight_id text not null,
    source text not null,
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
    listed_price integer not null check (listed_price > 0),
    effective_price integer not null check (effective_price > 0),
    available_seats integer,
    region text,
    first_seen date,
    price_checked_at timestamptz,
    cache_observed_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (snapshot_date, flight_key)
);

create index if not exists flight_price_daily_route_date_idx
    on public.flight_price_daily (departure_airport, arrival_airport, snapshot_date desc);
create index if not exists flight_price_daily_source_date_idx
    on public.flight_price_daily (source, snapshot_date desc);
create index if not exists flight_price_daily_travel_date_idx
    on public.flight_price_daily (departure_date, return_date);

create table if not exists public.route_price_daily (
    snapshot_date date not null,
    route_key text not null,
    source text not null,
    departure_city text not null,
    departure_airport text,
    arrival_city text not null,
    arrival_airport text,
    min_listed_price integer not null check (min_listed_price > 0),
    avg_listed_price integer not null check (avg_listed_price > 0),
    min_effective_price integer not null check (min_effective_price > 0),
    avg_effective_price integer not null check (avg_effective_price > 0),
    flight_count integer not null check (flight_count > 0),
    cache_observed_at timestamptz not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (snapshot_date, route_key, source)
);

create index if not exists route_price_daily_route_date_idx
    on public.route_price_daily (route_key, snapshot_date desc);
create index if not exists route_price_daily_source_date_idx
    on public.route_price_daily (source, snapshot_date desc);

alter table public.flight_price_daily enable row level security;
alter table public.route_price_daily enable row level security;

revoke all on table public.flight_price_daily from anon, authenticated;
revoke all on table public.route_price_daily from anon, authenticated;

grant select, insert, update on table
    public.flight_price_daily,
    public.route_price_daily
to service_role;

comment on table public.flight_price_daily is
    'Daily flight-level price observations. Internal service-role access only.';
comment on table public.route_price_daily is
    'Daily route and source aggregates derived from flight_price_daily.';
