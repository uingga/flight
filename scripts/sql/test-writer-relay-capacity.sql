-- Synthetic local cluster only; never execute against production.
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'tikit_writer_fixture_%' THEN RAISE EXCEPTION 'not a fixture database'; END IF;
END $$;
-- Historical payload exceeds the previous global 256 MiB limit.
INSERT INTO tikit_writer_private.deliveries(role,id,body,state,claim,response)
SELECT 'daily', 'history-' || lpad(n::text,16,'0'), repeat('x',1048576), 'done',
       gen_random_uuid(), '{"status":200,"body":"{}"}'::jsonb
FROM generate_series(1,270) n;
SET LOCAL ROLE service_role;
DO $$ DECLARE c jsonb; r jsonb; complete_input jsonb; before_bytes bigint;
BEGIN
  SELECT sum(octet_length(body)) INTO before_bytes FROM tikit_writer_private.deliveries WHERE state='done';
  r := public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('c',40),'body','{"action":"commit"}'));
  IF r->>'state'<>'pending' THEN RAISE EXCEPTION 'historical bytes blocked admission'; END IF;
  c := public.tikit_writer_queue('claim');
  complete_input := c || jsonb_build_object('response',jsonb_build_object('status',200,'body','{}'));
  PERFORM public.tikit_writer_queue('complete',complete_input);
  PERFORM public.tikit_writer_queue('complete',complete_input);
  r := public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('c',40),'body','{"action":"commit"}'));
  IF r->>'state'<>'done' THEN RAISE EXCEPTION 'receipt replay lost'; END IF;
  BEGIN
    PERFORM public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('c',40),'body','{"changed":true}'));
    RAISE EXCEPTION 'collision accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'request identity collision' THEN RAISE; END IF; END;
  IF (SELECT sum(octet_length(body)) FROM tikit_writer_private.deliveries WHERE id LIKE 'history-%') <> before_bytes THEN RAISE EXCEPTION 'history changed'; END IF;
END $$;
RESET ROLE;
-- Active bytes still have exactly the same 256 MiB cap.
INSERT INTO tikit_writer_private.deliveries(role,id,body,state,claim)
SELECT 'daily','active-' || lpad(n::text,16,'0'),repeat('y',1048576),'claimed',gen_random_uuid()
FROM generate_series(1,256) n;
SET LOCAL ROLE service_role;
DO $$ DECLARE c jsonb;
BEGIN
  BEGIN
    PERFORM public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('d',40),'body','{}'));
    RAISE EXCEPTION 'active byte limit bypassed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'queue outstanding capacity' THEN RAISE; END IF; END;
  IF public.tikit_writer_queue('claim') IS NOT NULL THEN RAISE EXCEPTION 'uncertain work reclaimed'; END IF;
  SELECT jsonb_build_object('role',role,'id',id,'claim',claim,'response',jsonb_build_object('status',409,'body','{}')) INTO c FROM tikit_writer_private.deliveries WHERE id='active-0000000000000001';
  PERFORM public.tikit_writer_queue('complete',c);
  PERFORM public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('d',40),'body','{}'));
END $$;
ROLLBACK;
BEGIN;
INSERT INTO tikit_writer_private.deliveries(role,id,body,state)
SELECT 'daily','count-' || lpad(n::text,16,'0'),'{}','pending' FROM generate_series(1,1000) n;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('e',40),'body','{}'));
    RAISE EXCEPTION 'active row limit bypassed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'queue outstanding capacity' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
