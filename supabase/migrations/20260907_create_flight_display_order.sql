-- Prepare only. Apply to production separately after preview approval.
create table if not exists public.flight_display_order (
    id text primary key check (id = 'main'),
    revision bigint not null default 0 check (revision >= 0),
    placements jsonb not null default '[]'::jsonb
        check (jsonb_typeof(placements) = 'array' and jsonb_array_length(placements) <= 30),
    updated_at timestamptz
);
insert into public.flight_display_order (id) values ('main') on conflict do nothing;
alter table public.flight_display_order enable row level security;
revoke all on public.flight_display_order from public, anon, authenticated;
grant select, update on public.flight_display_order to service_role;

-- Compare-and-swap prevents two open admin tabs from silently overwriting each other.
create or replace function public.save_flight_display_order(expected_revision bigint, new_placements jsonb)
returns setof public.flight_display_order
language sql
security invoker
set search_path = public
as $$
    update public.flight_display_order
    set placements = new_placements, revision = revision + 1, updated_at = now()
    where id = 'main' and revision = expected_revision
    returning *;
$$;
revoke all on function public.save_flight_display_order(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_flight_display_order(bigint, jsonb) to service_role;
