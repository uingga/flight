-- The initial price-history migration revoked browser roles but omitted the
-- table-level privileges that PostgREST still requires for service_role.
-- RLS bypass alone does not grant SELECT/INSERT/UPDATE on a table.

grant select, insert, update on table
    public.flight_price_daily,
    public.route_price_daily
to service_role;
