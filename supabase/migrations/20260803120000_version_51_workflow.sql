-- Mailo Version 51: nullable approvers, multiple Main Admins, durable workflow history,
-- and full change notification context.

DROP INDEX IF EXISTS public.user_roles_single_main_admin;

-- Victor is the permanent owner Main Admin. Other Main Admins may be added, but
-- this trigger prevents Victor from being removed or downgraded.
CREATE OR REPLACE FUNCTION public.protect_permanent_main_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE permanent_id uuid;
BEGIN
  SELECT id INTO permanent_id FROM public.profiles
  WHERE lower(email) = 'victor@shd.global' LIMIT 1;
  IF permanent_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' AND OLD.user_id = permanent_id AND OLD.role = 'main_admin' THEN
    RAISE EXCEPTION 'Victor Stavropoulos must always remain a Main Admin';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.user_id = permanent_id AND OLD.role = 'main_admin'
    AND NEW.role IS DISTINCT FROM 'main_admin'::public.app_role THEN
    RAISE EXCEPTION 'Victor Stavropoulos must always remain a Main Admin';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS protect_permanent_main_admin_trigger ON public.user_roles;
CREATE TRIGGER protect_permanent_main_admin_trigger
BEFORE UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.protect_permanent_main_admin();

-- Approver may be None, but only a Main Admin may change it.
ALTER TABLE public.tasks ALTER COLUMN approver_id DROP NOT NULL;
CREATE OR REPLACE FUNCTION public.enforce_task_approver_and_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.approver_id IS DISTINCT FROM OLD.approver_id
      AND auth.uid() IS NOT NULL
      AND NOT public.is_main_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only a Main Admin can change the Approver';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_changed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.task_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_by_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_status_events_task_time_idx
  ON public.task_status_events(task_id, changed_at DESC);
ALTER TABLE public.task_status_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.task_status_events TO authenticated;
GRANT ALL ON public.task_status_events TO service_role;
DROP POLICY IF EXISTS "Authenticated users read task status events" ON public.task_status_events;
CREATE POLICY "Authenticated users read task status events" ON public.task_status_events
FOR SELECT TO authenticated USING (public.user_can_access_task(auth.uid(), task_id));

CREATE OR REPLACE FUNCTION public.capture_task_status_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.task_status_events(task_id, from_status, to_status, assignee_id, changed_by_id, changed_at)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.assignee_id, auth.uid(), now());
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS capture_task_status_event_trigger ON public.tasks;
CREATE TRIGGER capture_task_status_event_trigger AFTER UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.capture_task_status_event();

CREATE TABLE IF NOT EXISTS public.task_last_checks (
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  main_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id, main_admin_id)
);
ALTER TABLE public.task_last_checks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.task_last_checks TO authenticated;
GRANT ALL ON public.task_last_checks TO service_role;
DROP POLICY IF EXISTS "Main Admin manages own task checks" ON public.task_last_checks;
CREATE POLICY "Main Admin manages own task checks" ON public.task_last_checks
FOR ALL TO authenticated USING (main_admin_id = auth.uid() AND public.is_main_admin(auth.uid()))
WITH CHECK (main_admin_id = auth.uid() AND public.is_main_admin(auth.uid()));

-- Queue an email containing the actual change message for Assignee and Supervisor.
ALTER TABLE public.mention_email_queue
  DROP CONSTRAINT IF EXISTS mention_email_queue_notification_type_check;
ALTER TABLE public.mention_email_queue
  ADD CONSTRAINT mention_email_queue_notification_type_check
  CHECK (notification_type IN ('mention', 'comment', 'task_created', 'task_change'));

CREATE OR REPLACE FUNCTION public.enqueue_task_change_notifications()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE change_message text;
BEGIN
  IF ROW(NEW.status,NEW.assignee_id,NEW.supervisor_id,NEW.approver_id,NEW.title,NEW.description,NEW.priority,NEW.due_date)
     IS NOT DISTINCT FROM
     ROW(OLD.status,OLD.assignee_id,OLD.supervisor_id,OLD.approver_id,OLD.title,OLD.description,OLD.priority,OLD.due_date) THEN
    RETURN NEW;
  END IF;
  change_message := concat_ws(' · ',
    CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN 'Status: '||OLD.status||' → '||NEW.status END,
    CASE WHEN NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN 'Assignee changed' END,
    CASE WHEN NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id THEN 'Supervisor changed' END,
    CASE WHEN NEW.approver_id IS DISTINCT FROM OLD.approver_id THEN 'Approver changed' END,
    CASE WHEN NEW.title IS DISTINCT FROM OLD.title THEN 'Title changed' END,
    CASE WHEN NEW.description IS DISTINCT FROM OLD.description THEN 'Description changed' END,
    CASE WHEN NEW.priority IS DISTINCT FROM OLD.priority THEN 'Priority changed' END,
    CASE WHEN NEW.due_date IS DISTINCT FROM OLD.due_date THEN 'Due date changed' END
  );
  INSERT INTO public.mention_email_queue(
    dedupe_key, notification_type, recipient_profile_id, recipient_email,
    recipient_name, author_id, author_name, task_id, task_key, task_title,
    comment_id, comment_text, task_url, recipient_context
  )
  SELECT 'task-change:'||NEW.id||':'||extract(epoch from now())::bigint||':'||p.id,
    'task_change', p.id, p.email, p.full_name, auth.uid(),
    COALESCE(actor.full_name,'Mailo user'), NEW.id, NEW.task_key, NEW.title,
    'task-change:'||NEW.id||':'||extract(epoch from now())::bigint,
    change_message, 'https://mailo.shd.global/?task='||NEW.task_key,
    jsonb_build_object('roles', to_jsonb(array_remove(ARRAY[
      CASE WHEN NEW.assignee_id=p.id THEN 'Assignee' END,
      CASE WHEN NEW.supervisor_id=p.id THEN 'Supervisor' END
    ],NULL)))
  FROM public.profiles p
  LEFT JOIN public.profiles actor ON actor.id=auth.uid()
  WHERE p.id IN (NEW.assignee_id,NEW.supervisor_id)
    AND p.id IS DISTINCT FROM auth.uid()
    AND p.email IS NOT NULL AND p.is_active IS DISTINCT FROM false
  ON CONFLICT(dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enqueue_task_change_notifications_trigger ON public.tasks;
CREATE TRIGGER enqueue_task_change_notifications_trigger
AFTER UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.enqueue_task_change_notifications();
