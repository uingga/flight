-- Accept Lotte Tour reports without changing existing reports, policies or privileges.
begin;
alter table public.flight_reports drop constraint flight_reports_source_check;
alter table public.flight_reports add constraint flight_reports_source_check
    check (source in ('ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip', 'lottetour'));
alter table public.flight_report_hides drop constraint flight_report_hides_source_check;
alter table public.flight_report_hides add constraint flight_report_hides_source_check
    check (source in ('ybtour', 'hanatour', 'modetour', 'onlinetour', 'ttang', 'myrealtrip', 'lottetour'));
commit;
