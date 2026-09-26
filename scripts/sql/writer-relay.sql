-- Proposed migration only. Never run automatically from application startup.
BEGIN;
CREATE SCHEMA IF NOT EXISTS tikit_writer_private;
REVOKE ALL ON SCHEMA tikit_writer_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA tikit_writer_private TO service_role;
CREATE TABLE IF NOT EXISTS tikit_writer_private.deliveries (
  role text NOT NULL,
  id text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','done')),
  claim uuid,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(role,id)
);
ALTER TABLE tikit_writer_private.deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tikit_writer_private.deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON tikit_writer_private.deliveries TO service_role;
ALTER TABLE tikit_writer_private.deliveries ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE tikit_writer_private.deliveries ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
-- Legacy completion time is unknown: retain for a full seven days from migration.
UPDATE tikit_writer_private.deliveries SET completed_at=clock_timestamp() WHERE state='done' AND completed_at IS NULL;
-- Two-phase rollout: admission repair is immediate, destructive retention stays
-- disabled until all producers carry a date and the delivery agent heartbeats.
CREATE TABLE IF NOT EXISTS tikit_writer_private.retention_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO tikit_writer_private.retention_policy(singleton) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE tikit_writer_private.retention_policy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tikit_writer_private.retention_policy FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON tikit_writer_private.retention_policy TO service_role;

CREATE OR REPLACE FUNCTION public.tikit_writer_queue(p_action text,p_input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  r tikit_writer_private.deliveries%ROWTYPE;
  new_claim uuid;
  request_body text;
  response_value jsonb;
  issued_at timestamptz;
  retention_enabled boolean;
BEGIN
  -- Existing receipts are immutable requests with monotonic result states. Read
  -- them without the global admission lock: polling must not starve heartbeat,
  -- completion or other producers. A stale pending snapshot is safe to poll again.
  -- The locked path below rechecks a missing row before creating any new work.
  IF p_action = 'submit' THEN
    IF NOT (p_input->>'role' = ANY(ARRAY['daily','myrealtrip','onlinetour','source-fallback','manual','report','link-health','today-pick','admin','deploy']))
      OR coalesce(p_input->>'id','') !~ '^[a-zA-Z0-9-]{16,80}$'
      OR jsonb_typeof(p_input->'body') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid queue request';
    END IF;
    request_body := p_input->>'body';
    IF octet_length(request_body)>25165824 THEN RAISE EXCEPTION 'queue payload limit'; END IF;
    SELECT * INTO r FROM tikit_writer_private.deliveries WHERE role=p_input->>'role' AND id=p_input->>'id';
    IF FOUND THEN
      -- Clients freeze wire bytes. Do not parse multi-MiB JSON twice per poll.
      -- Keep semantic compatibility for legacy date-only/envelope differences.
      IF r.body IS DISTINCT FROM request_body THEN
        IF (r.body::jsonb - 'relayIssuedAt') IS DISTINCT FROM (request_body::jsonb - 'relayIssuedAt') THEN RAISE EXCEPTION 'request identity collision'; END IF;
      END IF;
      RETURN jsonb_build_object('state',r.state,'response',r.response);
    END IF;
  END IF;
  -- All state transitions and capacity checks still share one transaction lock.
  -- Never reclaim or replay a claimed job. Expiry is terminal, not a retry.
  PERFORM pg_catalog.pg_advisory_xact_lock(74152,190915);
  SELECT enabled INTO retention_enabled FROM tikit_writer_private.retention_policy WHERE singleton;
  IF p_action = 'submit' THEN
    IF NOT (p_input->>'role' = ANY(ARRAY['daily','myrealtrip','onlinetour','source-fallback','manual','report','link-health','today-pick','admin','deploy']))
      OR coalesce(p_input->>'id','') !~ '^[a-zA-Z0-9-]{16,80}$'
      OR jsonb_typeof(p_input->'body') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid queue request';
    END IF;
    request_body := p_input->>'body';
    IF octet_length(request_body)>25165824 THEN RAISE EXCEPTION 'queue payload limit'; END IF;
    SELECT * INTO r FROM tikit_writer_private.deliveries WHERE role=p_input->>'role' AND id=p_input->>'id' FOR UPDATE;
    IF FOUND THEN
      IF r.body IS DISTINCT FROM request_body THEN
        IF (r.body::jsonb - 'relayIssuedAt') IS DISTINCT FROM (request_body::jsonb - 'relayIssuedAt') THEN RAISE EXCEPTION 'request identity collision'; END IF;
      END IF;
      RETURN jsonb_build_object('state',r.state,'response',r.response);
    END IF;
    -- After a receipt is purged, its original dated request cannot become new work.
    issued_at := (request_body::jsonb->>'relayIssuedAt')::timestamptz;
    IF (retention_enabled AND issued_at IS NULL) OR issued_at < clock_timestamp()-interval '24 hours'
      OR issued_at > clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'queue request expired'; END IF;
    -- Admission is bounded by outstanding work, not immutable completion history.
    -- Keep all done bodies/responses for exact idempotent replay and audit.
    IF (SELECT count(*) FROM tikit_writer_private.deliveries WHERE state <> 'done')>=1000
      OR (SELECT coalesce(sum(octet_length(body)+coalesce(octet_length(response::text),0)),0) FROM tikit_writer_private.deliveries WHERE state <> 'done')+octet_length(request_body)>268435456
      THEN RAISE EXCEPTION 'queue outstanding capacity'; END IF;
    INSERT INTO tikit_writer_private.deliveries(role,id,body) VALUES(p_input->>'role',p_input->>'id',request_body);
    RETURN jsonb_build_object('state','pending');
  ELSIF p_action = 'claim' THEN
    UPDATE tikit_writer_private.deliveries SET state='done',completed_at=clock_timestamp(),
      response='{"status":409,"body":"{\"code\":\"PUBLICATION_EXPIRED\"}"}'::jsonb
      WHERE retention_enabled AND state='pending'
        AND coalesce((body::jsonb->>'relayIssuedAt')::timestamptz,created_at) < clock_timestamp()-interval '24 hours';
    SELECT * INTO r FROM tikit_writer_private.deliveries WHERE state='pending' ORDER BY created_at,role,id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    new_claim := pg_catalog.gen_random_uuid();
    UPDATE tikit_writer_private.deliveries SET state='claimed',claim=new_claim,heartbeat_at=clock_timestamp() WHERE role=r.role AND id=r.id;
    RETURN jsonb_build_object('role',r.role,'id',r.id,'body',r.body,'claim',new_claim);
  ELSIF p_action = 'heartbeat' THEN
    UPDATE tikit_writer_private.deliveries SET heartbeat_at=clock_timestamp()
      WHERE role=p_input->>'role' AND id=p_input->>'id' AND state='claimed' AND claim::text=p_input->>'claim';
    RETURN to_jsonb(FOUND);
  ELSIF p_action = 'complete' THEN
    response_value := p_input->'response';
    IF jsonb_typeof(response_value) IS DISTINCT FROM 'object'
      OR coalesce(response_value->>'status','') NOT IN ('200','409')
      OR jsonb_typeof(response_value->'body') IS DISTINCT FROM 'string'
      OR octet_length(response_value->>'body')>25165824 THEN RAISE EXCEPTION 'invalid response'; END IF;
    SELECT * INTO r FROM tikit_writer_private.deliveries WHERE role=p_input->>'role' AND id=p_input->>'id' FOR UPDATE;
    IF NOT FOUND OR r.claim IS NULL OR r.claim::text IS DISTINCT FROM p_input->>'claim' THEN RAISE EXCEPTION 'claim mismatch'; END IF;
    IF r.state='done' THEN
      IF r.response IS DISTINCT FROM response_value THEN RAISE EXCEPTION 'response mismatch'; END IF;
      RETURN 'true'::jsonb;
    END IF;
    IF r.state<>'claimed' THEN RAISE EXCEPTION 'invalid queue state'; END IF;
    -- Completion releases outstanding capacity; refusing it when full strands
    -- an already processed claim. The per-response size guard above remains.
    UPDATE tikit_writer_private.deliveries SET state='done',response=response_value,completed_at=clock_timestamp() WHERE role=r.role AND id=r.id;
    RETURN 'true'::jsonb;
  END IF;
  RAISE EXCEPTION 'queue action refused';
END;
$$;
REVOKE ALL ON FUNCTION public.tikit_writer_queue(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tikit_writer_queue(text,jsonb) TO service_role;

-- Run by the database owner's hourly cron, not by browser or application roles.
-- Existing roles receive no new DELETE privilege or broader RPC access.
CREATE OR REPLACE FUNCTION tikit_writer_private.cleanup_deliveries()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE expired_count integer; deleted_count integer; superseded_count integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(74152,190915);
  IF NOT coalesce((SELECT enabled FROM tikit_writer_private.retention_policy WHERE singleton),false) THEN
    RETURN jsonb_build_object('disabled',true,'expired',0,'superseded',0,'deleted',0);
  END IF;
  UPDATE tikit_writer_private.deliveries older SET state='done',completed_at=clock_timestamp(),
    response='{"status":409,"body":"{\"code\":\"PUBLICATION_SUPERSEDED\"}"}'::jsonb
    WHERE older.state='pending' AND older.role IN ('daily','myrealtrip')
      AND older.body::jsonb->>'action'='commit'
      AND jsonb_typeof(older.body::jsonb->'entries')='array'
      AND jsonb_array_length(CASE WHEN jsonb_typeof(older.body::jsonb->'entries')='array' THEN older.body::jsonb->'entries' ELSE '[]'::jsonb END)>0 AND EXISTS (
      SELECT 1 FROM tikit_writer_private.deliveries newer WHERE newer.role=older.role AND newer.state='done'
        AND newer.response->>'status'='200' AND newer.body::jsonb->>'action'='commit'
        AND jsonb_typeof(newer.body::jsonb->'entries')='array'
        AND newer.created_at>older.created_at
        AND (SELECT array_agg(e->>0 ORDER BY e->>0) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(older.body::jsonb->'entries')='array' THEN older.body::jsonb->'entries' ELSE '[]'::jsonb END) e)
          = (SELECT array_agg(e->>0 ORDER BY e->>0) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(newer.body::jsonb->'entries')='array' THEN newer.body::jsonb->'entries' ELSE '[]'::jsonb END) e));
  GET DIAGNOSTICS superseded_count=ROW_COUNT;
  UPDATE tikit_writer_private.deliveries SET state='done',completed_at=clock_timestamp(),
    response=jsonb_build_object('status',409,'body',jsonb_build_object('code',
      CASE WHEN state='claimed' THEN 'PUBLICATION_EXPIRED_UNKNOWN' ELSE 'PUBLICATION_EXPIRED' END)::text)
    WHERE (state='pending' AND coalesce((body::jsonb->>'relayIssuedAt')::timestamptz,created_at)<clock_timestamp()-interval '24 hours')
       OR (state='claimed' AND coalesce(heartbeat_at,created_at)<clock_timestamp()-interval '24 hours');
  GET DIAGNOSTICS expired_count=ROW_COUNT;
  DELETE FROM tikit_writer_private.deliveries WHERE state='done' AND completed_at<clock_timestamp()-interval '7 days';
  GET DIAGNOSTICS deleted_count=ROW_COUNT;
  RETURN jsonb_build_object('expired',expired_count,'superseded',superseded_count,'deleted',deleted_count);
END;
$$;
REVOKE ALL ON FUNCTION tikit_writer_private.cleanup_deliveries() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
