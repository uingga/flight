-- 선택적 보관 정리 작업. 핵심 인증·문의 RPC와 분리해 pg_cron 권한이나
-- 확장 상태가 달라도 로그인 배포 자체가 롤백되지 않게 한다.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'tikitikit-rate-limit-cleanup') then
    perform cron.schedule(
      'tikitikit-rate-limit-cleanup',
      '30 18 * * *',
      $cleanup$
        delete from public.tikitikit_rate_limit_buckets
        where updated_at < now() - interval '2 days';
      $cleanup$
    );
  end if;
exception
  when undefined_table or undefined_function or invalid_schema_name or insufficient_privilege then
    raise notice 'tikitikit-rate-limit-cleanup 예약 생략: pg_cron을 사용할 수 없습니다.';
end
$$;
