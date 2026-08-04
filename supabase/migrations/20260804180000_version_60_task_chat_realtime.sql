-- MAILO Version 60: publish Task Chat changes to authenticated Realtime clients.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE public.task_comments REPLICA IDENTITY FULL;
