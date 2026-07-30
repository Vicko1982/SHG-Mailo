CREATE TABLE IF NOT EXISTS public.voice_device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL DEFAULT 'iPhone',
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '180 days',
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_device_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_device_tokens FROM anon, authenticated;
GRANT ALL ON public.voice_device_tokens TO service_role;

CREATE INDEX IF NOT EXISTS voice_device_tokens_user_idx
  ON public.voice_device_tokens (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.voice_shortcut_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_token_id UUID NOT NULL REFERENCES public.voice_device_tokens(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_shortcut_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_shortcut_requests FROM anon, authenticated;
GRANT ALL ON public.voice_shortcut_requests TO service_role;

CREATE INDEX IF NOT EXISTS voice_shortcut_requests_rate_idx
  ON public.voice_shortcut_requests (device_token_id, created_at DESC);
