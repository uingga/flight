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

CREATE OR REPLACE FUNCTION public.tikit_writer_queue(p_action text,p_input jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  r tikit_writer_private.deliveries%ROWTYPE;
  new_claim uuid;
  request_body text;
  response_value jsonb;
BEGIN
  -- All state transitions and capacity checks share a transaction-scoped lock.
  -- No TTL, automatic reclaim, deletion, or retry of ambiguous claimed jobs.
  PERFORM pg_catalog.pg_advisory_xact_lock(74152,190915);
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
      IF r.body IS DISTINCT FROM request_body THEN RAISE EXCEPTION 'request identity collision'; END IF;
      RETURN jsonb_build_object('state',r.state,'response',r.response);
    END IF;
    IF (SELECT count(*) FROM tikit_writer_private.deliveries)>=1000
      OR (SELECT coalesce(sum(octet_length(body)+coalesce(octet_length(response::text),0)),0) FROM tikit_writer_private.deliveries)+octet_length(request_body)>268435456
      THEN RAISE EXCEPTION 'queue retention capacity'; END IF;
    INSERT INTO tikit_writer_private.deliveries(role,id,body) VALUES(p_input->>'role',p_input->>'id',request_body);
    RETURN jsonb_build_object('state','pending');
  ELSIF p_action = 'claim' THEN
    SELECT * INTO r FROM tikit_writer_private.deliveries WHERE state='pending' ORDER BY created_at,role,id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    new_claim := pg_catalog.gen_random_uuid();
    UPDATE tikit_writer_private.deliveries SET state='claimed',claim=new_claim WHERE role=r.role AND id=r.id;
    RETURN jsonb_build_object('role',r.role,'id',r.id,'body',r.body,'claim',new_claim);
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
    IF (SELECT coalesce(sum(octet_length(body)+coalesce(octet_length(response::text),0)),0) FROM tikit_writer_private.deliveries)+octet_length(response_value::text)>268435456
      THEN RAISE EXCEPTION 'queue retention capacity'; END IF;
    UPDATE tikit_writer_private.deliveries SET state='done',response=response_value WHERE role=r.role AND id=r.id;
    RETURN 'true'::jsonb;
  END IF;
  RAISE EXCEPTION 'queue action refused';
END;
$$;
REVOKE ALL ON FUNCTION public.tikit_writer_queue(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.tikit_writer_queue(text,jsonb) TO service_role;
COMMIT;
