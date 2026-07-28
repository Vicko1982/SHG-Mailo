CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.mention_email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE,
  recipient_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  task_key TEXT NOT NULL,
  task_title TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  comment_text TEXT NOT NULL,
  task_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retrying', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mention_email_queue_due_idx
  ON public.mention_email_queue (status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS mention_email_queue_sent_idx
  ON public.mention_email_queue (sent_at)
  WHERE status = 'sent';

ALTER TABLE public.mention_email_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mention_email_queue FROM anon, authenticated;
GRANT ALL ON public.mention_email_queue TO service_role;

CREATE OR REPLACE FUNCTION public.claim_mention_email_jobs(
  maximum_per_hour INTEGER DEFAULT 300,
  maximum_batch_size INTEGER DEFAULT 50
)
RETURNS SETOF public.mention_email_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reserved_count INTEGER;
  available_count INTEGER;
BEGIN
  -- A transaction-level lock prevents two workers from reserving the same
  -- hourly capacity at the same time.
  PERFORM pg_advisory_xact_lock(hashtext('shg-mention-email-hourly-limit'));

  SELECT count(*)::INTEGER
    INTO reserved_count
  FROM public.mention_email_queue
  WHERE
    (status = 'sent' AND sent_at >= now() - interval '1 hour')
    OR
    (status = 'processing' AND last_attempt_at >= now() - interval '10 minutes');

  available_count := GREATEST(
    0,
    LEAST(maximum_batch_size, maximum_per_hour - reserved_count)
  );

  IF available_count = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.mention_email_queue
    WHERE
      (
        status IN ('pending', 'retrying')
        AND next_attempt_at <= now()
      )
      OR
      (
        status = 'processing'
        AND last_attempt_at < now() - interval '10 minutes'
      )
    ORDER BY next_attempt_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT available_count
  )
  UPDATE public.mention_email_queue AS queue
  SET
    status = 'processing',
    attempt_count = queue.attempt_count + 1,
    last_attempt_at = now(),
    updated_at = now()
  FROM candidates
  WHERE queue.id = candidates.id
  RETURNING queue.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_mention_email_jobs(INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mention_email_jobs(INTEGER, INTEGER)
  TO service_role;

-- The processor is deliberately safe to wake without credentials: it can
-- only deliver already validated server-side queue rows. Enqueueing still
-- requires an authenticated, active application user.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-mention-email-queue') THEN
    PERFORM cron.unschedule('process-mention-email-queue');
  END IF;
END $$;

SELECT cron.schedule(
  'process-mention-email-queue',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ewjalucwaeotamodlajs.supabase.co/functions/v1/send-mention-email',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{"processQueue":true}'::jsonb,
      timeout_milliseconds := 50000
    );
  $$
);
