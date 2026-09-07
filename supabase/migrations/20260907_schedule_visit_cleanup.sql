-- Required before enabling collection. Deliberately fail if pg_cron is unavailable.
-- Run hourly; records expire after 90 days with at most one hour of cleanup lag.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'tikitikit-visit-cleanup') then
    perform cron.schedule('tikitikit-visit-cleanup','25 * * * *','select public.tikitikit_cleanup_visits();');
  end if;
end;
$$;
