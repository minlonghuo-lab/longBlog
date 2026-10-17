-- Private schema: these objects are never exposed as public PostgREST resources.
CREATE SCHEMA IF NOT EXISTS terminal_chat;
REVOKE ALL ON SCHEMA terminal_chat FROM PUBLIC;

CREATE TABLE IF NOT EXISTS terminal_chat.sessions (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  purge_after timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS terminal_chat_sessions_expiry ON terminal_chat.sessions (purge_after);
CREATE TABLE IF NOT EXISTS terminal_chat.messages (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence BETWEEN 1 AND 200),
  data jsonb NOT NULL,
  purge_after timestamptz NOT NULL,
  UNIQUE (session_id, sequence)
);
CREATE INDEX IF NOT EXISTS terminal_chat_messages_expiry ON terminal_chat.messages (purge_after);
ALTER TABLE terminal_chat.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminal_chat.messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA terminal_chat FROM PUBLIC;

CREATE OR REPLACE FUNCTION terminal_chat.take_rate(p_id text, p_limit integer, p_expires bigint)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE accepted text;
BEGIN
  INSERT INTO terminal_chat.sessions (id, data, purge_after)
  VALUES (p_id, '{"kind":"rate","count":1}'::jsonb, to_timestamp(p_expires / 1000.0))
  ON CONFLICT (id) DO UPDATE
  SET data = jsonb_set(terminal_chat.sessions.data, '{count}', to_jsonb((terminal_chat.sessions.data->>'count')::integer + 1))
  WHERE (terminal_chat.sessions.data->>'count')::integer < p_limit
  RETURNING id INTO accepted;
  IF accepted IS NULL THEN RAISE EXCEPTION 'TC429'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION terminal_chat.take_rate(text, integer, bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION terminal_chat.append_message(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  sid text := p->>'sessionId';
  sender text := p->>'sender';
  stamp bigint := (p->>'timestamp')::bigint;
  session_doc jsonb;
  message_doc jsonb;
  seq integer;
  expires bigint;
  lock_id text;
  minute_key text := 'rate_send_' || (p->>'ipHash') || '_' || (stamp / 60000)::text;
  hour_key text := 'rate_create_' || (p->>'ipHash') || '_' || (stamp / 3600000)::text;
BEGIN
  IF sid !~ '^[a-f0-9]{32}$' OR p->>'documentId' !~ '^[a-f0-9]{64}$'
     OR p->>'messageId' !~ '^[a-f0-9]{32}$' OR sender NOT IN ('user','author')
     OR coalesce(p->>'text','') = '' OR length(p->>'text') > 500 THEN RAISE EXCEPTION 'TC400'; END IF;
  -- A consistent lock order covers first-session creation, shared IP counters and sequence allocation.
  FOR lock_id IN SELECT DISTINCT value FROM unnest(ARRAY[sid, minute_key, hour_key]) AS keys(value) ORDER BY value LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('terminal_chat:' || lock_id, 0));
  END LOOP;
  SELECT data INTO session_doc FROM terminal_chat.sessions WHERE id = sid;
  IF session_doc IS NOT NULL AND (session_doc->>'kind' <> 'session'
      OR (sender = 'user' AND session_doc->>'visitorKeyHash' <> p->>'visitorKeyHash')) THEN RAISE EXCEPTION 'TC403'; END IF;
  IF session_doc IS NOT NULL AND (session_doc->>'expiresAt')::bigint <= stamp THEN RAISE EXCEPTION 'TC410'; END IF;
  IF session_doc IS NULL AND sender = 'author' THEN RAISE EXCEPTION 'TC404'; END IF;
  SELECT data INTO message_doc FROM terminal_chat.messages WHERE id = p->>'documentId';
  IF message_doc IS NOT NULL THEN
    IF message_doc->>'text' <> p->>'text' THEN RAISE EXCEPTION 'TC409'; END IF;
    RETURN jsonb_build_object('message', message_doc, 'created', false, 'expiresAt', (session_doc->>'expiresAt')::bigint);
  END IF;
  IF sender = 'user' THEN
    PERFORM terminal_chat.take_rate(minute_key, 20, stamp + 172800000);
    IF session_doc IS NULL THEN
      PERFORM terminal_chat.take_rate(hour_key, 5, stamp + 172800000);
      session_doc := jsonb_build_object('kind','session','visitorKeyHash',p->>'visitorKeyHash',
        'createdAt',stamp,'expiresAt',stamp+604800000,'sequence',0,'lastUserMessageAt',0);
    END IF;
    IF stamp - (session_doc->>'lastUserMessageAt')::bigint < 2000 THEN RAISE EXCEPTION 'TC429'; END IF;
    session_doc := jsonb_set(session_doc, '{lastUserMessageAt}', to_jsonb(stamp));
  END IF;
  seq := (session_doc->>'sequence')::integer + 1;
  IF seq > 200 THEN RAISE EXCEPTION 'TC429'; END IF;
  expires := (session_doc->>'expiresAt')::bigint;
  session_doc := jsonb_set(session_doc, '{sequence}', to_jsonb(seq));
  message_doc := jsonb_build_object('sessionId',sid,'clientId',p->>'messageId','sender',sender,
    'text',p->>'text','createdAt',stamp,'sequence',seq,'notification',CASE WHEN sender='user' THEN 'pending' ELSE 'none' END);
  INSERT INTO terminal_chat.sessions (id,data,purge_after) VALUES (sid,session_doc,to_timestamp(expires/1000.0))
    ON CONFLICT (id) DO UPDATE SET data=excluded.data, purge_after=excluded.purge_after;
  INSERT INTO terminal_chat.messages (id,session_id,sequence,data,purge_after)
    VALUES (p->>'documentId',sid,seq,message_doc,to_timestamp(expires/1000.0));
  RETURN jsonb_build_object('message',message_doc,'created',true,'expiresAt',expires);
EXCEPTION WHEN raise_exception THEN
  -- The exception block rolls back all writes, including rate counters, before returning.
  RETURN jsonb_build_object('errorCode',SQLERRM);
END;
$$;
REVOKE ALL ON FUNCTION terminal_chat.append_message(jsonb) FROM PUBLIC;
