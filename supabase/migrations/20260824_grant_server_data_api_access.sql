-- 브라우저 역할(anon/authenticated)은 계속 차단하고, Vercel 서버가 사용하는
-- service_role에만 실제 API 동작에 필요한 DML 권한을 명시한다.

grant select, insert, update, delete on table
  public.tikitikit_users,
  public.tikitikit_auth_codes,
  public.tikitikit_auth_sessions,
  public.tikitikit_user_favorites,
  public.tikitikit_user_recent_flights,
  public.tikitikit_user_saved_searches
to service_role;

grant select, insert, update, delete on table
  public.flight_reports,
  public.flight_report_hides,
  public.flight_report_events
to service_role;

grant usage, select on sequence
  public.flight_reports_id_seq,
  public.flight_report_events_id_seq
to service_role;
