-- Disposable local database only. Run through test-writer-relay-postgres.mjs.
BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE r jsonb; claimed jsonb; finished jsonb;
BEGIN
  IF current_database() NOT LIKE 'tikit_writer_fixture_%' THEN RAISE EXCEPTION 'not a fixture database'; END IF;
  r:=public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('a',40),'body','{"action":"commit"}'));
  IF r->>'state'<>'pending' THEN RAISE EXCEPTION 'submit failed'; END IF;
  claimed:=public.tikit_writer_queue('claim');
  IF claimed->>'id'<>repeat('a',40) OR claimed->>'claim' IS NULL THEN RAISE EXCEPTION 'claim failed'; END IF;
  IF public.tikit_writer_queue('claim') IS NOT NULL THEN RAISE EXCEPTION 'duplicate claim'; END IF;
  r:=public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('a',40),'body','{"action":"commit"}'));
  IF r->>'state'<>'claimed' THEN RAISE EXCEPTION 'claim was reset'; END IF;
  finished:=claimed||jsonb_build_object('response',jsonb_build_object('status',200,'body','{}'));
  PERFORM public.tikit_writer_queue('complete',finished);
  PERFORM public.tikit_writer_queue('complete',finished);
  r:=public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('a',40),'body','{"action":"commit"}'));
  IF r->>'state'<>'done' THEN RAISE EXCEPTION 'completion lost'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.tikit_writer_queue('claim');
    RAISE EXCEPTION 'anonymous execution was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.tikit_writer_queue('claim');
    RAISE EXCEPTION 'authenticated execution was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;
