-- Synthetic local cluster only. All fixture changes roll back.
BEGIN;
DO $$ BEGIN
  IF current_database() NOT LIKE 'tikit_writer_fixture_%' THEN RAISE EXCEPTION 'not a fixture database'; END IF;
  IF (tikit_writer_private.cleanup_deliveries()->>'disabled')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'retention enabled during migration';
  END IF;
END $$;
UPDATE tikit_writer_private.retention_policy SET enabled=true;
SET LOCAL ROLE service_role;
DO $$ DECLARE stamp timestamptz; c jsonb; result jsonb; body text;
BEGIN
  FOREACH stamp IN ARRAY ARRAY[NULL::timestamptz,clock_timestamp()-interval '25 hours',clock_timestamp()+interval '10 minutes'] LOOP
    BEGIN
      PERFORM public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('a',40),
        'body',jsonb_build_object('action','commit','relayIssuedAt',stamp)::text));
      RAISE EXCEPTION 'invalid issue date accepted';
    EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'queue request expired' THEN RAISE; END IF; END;
  END LOOP;
  body:=jsonb_build_object('action','commit','relayIssuedAt',clock_timestamp())::text;
  result:=public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('a',40),'body',body));
  IF result->>'state'<>'pending' THEN RAISE EXCEPTION 'fresh request rejected'; END IF;
  c:=public.tikit_writer_queue('claim');
  IF public.tikit_writer_queue('heartbeat',c) IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'heartbeat rejected'; END IF;
  IF public.tikit_writer_queue('heartbeat',c||jsonb_build_object('claim',gen_random_uuid())) IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'foreign heartbeat accepted'; END IF;
  PERFORM public.tikit_writer_queue('complete',c||jsonb_build_object('response',jsonb_build_object('status',200,'body','{}')));
  -- Re-invocation with the same identity cannot extend completion lifetime.
  result:=public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('a',40),'body',
    jsonb_build_object('action','commit','relayIssuedAt',clock_timestamp()+interval '1 second')::text));
  IF result->>'state'<>'done' THEN RAISE EXCEPTION 'dated retry lost receipt'; END IF;
  BEGIN
    PERFORM tikit_writer_private.cleanup_deliveries();
    RAISE EXCEPTION 'application role can delete receipts';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE tikit_writer_private.retention_policy SET enabled=false;
    RAISE EXCEPTION 'application role can disable policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Completion age, not original enqueue time, determines the seven-day window.
INSERT INTO tikit_writer_private.deliveries(role,id,body,state,created_at,completed_at,heartbeat_at,claim,response) VALUES
 ('manual','old-done-00000001','{}','done',now()-interval '10 days',now()-interval '8 days',NULL,NULL,'{"status":200,"body":"{}"}'),
 ('manual','fresh-done-000001','{}','done',now()-interval '10 days',now()-interval '6 days',NULL,NULL,'{"status":200,"body":"{}"}'),
 ('manual','old-pending-00001','{}','pending',now()-interval '25 hours',NULL,NULL,NULL,NULL),
 ('manual','fresh-pending-001','{}','pending',now()-interval '1 hour',NULL,NULL,NULL,NULL),
 ('manual','old-unknown-00001','{}','claimed',now()-interval '3 days',NULL,now()-interval '25 hours',gen_random_uuid(),NULL),
 ('manual','active-claim-0001','{}','claimed',now()-interval '3 days',NULL,now(),gen_random_uuid(),NULL);
DO $$ DECLARE r jsonb;
BEGIN
  r:=tikit_writer_private.cleanup_deliveries();
  IF r->>'deleted'<>'1' OR r->>'expired'<>'2' THEN RAISE EXCEPTION 'wrong cleanup counts: %',r; END IF;
  IF EXISTS(SELECT 1 FROM tikit_writer_private.deliveries WHERE id='old-done-00000001') THEN RAISE EXCEPTION 'old done retained'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tikit_writer_private.deliveries WHERE id='fresh-done-000001') THEN RAISE EXCEPTION 'fresh receipt removed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tikit_writer_private.deliveries WHERE id='active-claim-0001' AND state='claimed') THEN RAISE EXCEPTION 'active work changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tikit_writer_private.deliveries WHERE id='fresh-pending-001' AND state='pending') THEN RAISE EXCEPTION 'fresh pending changed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tikit_writer_private.deliveries WHERE id='old-unknown-00001' AND state='done' AND response->>'body' LIKE '%EXPIRED_UNKNOWN%') THEN RAISE EXCEPTION 'unknown expiry not terminal'; END IF;
  IF (tikit_writer_private.cleanup_deliveries()->>'deleted')<>'0' THEN RAISE EXCEPTION 'cleanup not idempotent'; END IF;
END $$;
-- Even a newly queued request expires at its original issue date plus 24h.
INSERT INTO tikit_writer_private.deliveries(role,id,body,state) VALUES
 ('manual','stale-issued-0001',jsonb_build_object('relayIssuedAt',now()-interval '25 hours')::text,'pending');
SELECT tikit_writer_private.cleanup_deliveries();
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM tikit_writer_private.deliveries WHERE id='stale-issued-0001' AND state<>'done') THEN RAISE EXCEPTION 'issue date lifetime extended'; END IF;
END $$;
-- Only a completed commit covering the same files supersedes a pending batch.
INSERT INTO tikit_writer_private.deliveries(role,id,body,state,created_at,completed_at,response) VALUES
 ('daily','superseded-000001','{"action":"commit","entries":[["data/a.json",{}]]}','pending',now()-interval '2 hours',NULL,NULL),
 ('daily','different-000001','{"action":"commit","entries":[["data/b.json",{}]]}','pending',now()-interval '2 hours',NULL,NULL),
 ('daily','read-inputs-00001','{"action":"readInputs"}','pending',now()-interval '2 hours',NULL,NULL),
 ('daily','invalid-entries1','{"action":"commit","entries":{}}','pending',now()-interval '2 hours',NULL,NULL),
 ('daily','new-publish-0001','{"action":"commit","entries":[["data/a.json",{}]]}','done',now()-interval '1 hour',now(),'{"status":200,"body":"{}"}'),
 ('myrealtrip','other-role-00001','{"action":"commit","entries":[["data/a.json",{}]]}','pending',now()-interval '2 hours',NULL,NULL);
DO $$ DECLARE r jsonb;
BEGIN
  r:=tikit_writer_private.cleanup_deliveries();
  IF r->>'superseded'<>'1' THEN RAISE EXCEPTION 'wrong superseded count: %',r; END IF;
  IF EXISTS(SELECT 1 FROM tikit_writer_private.deliveries WHERE id IN ('different-000001','read-inputs-00001','invalid-entries1','other-role-00001') AND state<>'pending') THEN RAISE EXCEPTION 'unrelated request superseded'; END IF;
END $$;
-- A purged receipt does not permit replay of the original dated packet.
UPDATE tikit_writer_private.deliveries SET completed_at=now()-interval '8 days',
  body=jsonb_build_object('action','commit','relayIssuedAt',now()-interval '8 days')::text WHERE id=repeat('a',40);
SELECT tikit_writer_private.cleanup_deliveries();
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM public.tikit_writer_queue('submit',jsonb_build_object('role','daily','id',repeat('a',40),'body',
      jsonb_build_object('action','commit','relayIssuedAt',now()-interval '8 days')::text));
    RAISE EXCEPTION 'expired packet replayed after purge';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'queue request expired' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
