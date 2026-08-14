-- MAILO Version 79: per-user Task Chat read state and durable Last Checked.

CREATE TABLE IF NOT EXISTS public.task_chat_reads (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

ALTER TABLE public.task_chat_reads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_chat_reads TO authenticated;
GRANT ALL ON public.task_chat_reads TO service_role;

DROP POLICY IF EXISTS "Users manage own Task Chat read state" ON public.task_chat_reads;
CREATE POLICY "Users manage own Task Chat read state"
ON public.task_chat_reads FOR ALL
TO authenticated
USING (
  user_id = auth.uid()
  AND public.user_can_access_task(auth.uid(), task_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND public.user_can_access_task(auth.uid(), task_id)
);

DROP TRIGGER IF EXISTS mailo_maintenance_write_lock ON public.task_chat_reads;
CREATE TRIGGER mailo_maintenance_write_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.task_chat_reads
FOR EACH ROW EXECUTE FUNCTION public.reject_mailo_writes_during_maintenance();

DROP POLICY IF EXISTS "Main Admin manages own task checks" ON public.task_last_checks;
DROP POLICY IF EXISTS "Task checks managed by accessible Main Admin" ON public.task_last_checks;
CREATE POLICY "Task checks managed by accessible Main Admin"
ON public.task_last_checks FOR ALL
TO authenticated
USING (
  main_admin_id = auth.uid()
  AND public.is_main_admin(auth.uid())
  AND public.user_can_access_task(auth.uid(), task_id)
)
WITH CHECK (
  main_admin_id = auth.uid()
  AND public.is_main_admin(auth.uid())
  AND public.user_can_access_task(auth.uid(), task_id)
);

ALTER TABLE public.app_settings
  ALTER COLUMN minimum_client_version SET DEFAULT 79;
