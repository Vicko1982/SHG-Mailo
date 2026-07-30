CREATE TABLE IF NOT EXISTS public.voice_realtime_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  usage JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_realtime_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_realtime_usage FROM anon, authenticated;
GRANT ALL ON public.voice_realtime_usage TO service_role;

CREATE INDEX IF NOT EXISTS voice_realtime_usage_created_idx
  ON public.voice_realtime_usage (created_at DESC);
