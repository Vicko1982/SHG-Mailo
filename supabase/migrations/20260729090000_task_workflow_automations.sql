CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

ALTER TABLE public.mention_email_queue
  DROP CONSTRAINT IF EXISTS mention_email_queue_notification_type_check;
ALTER TABLE public.mention_email_queue
  ADD CONSTRAINT mention_email_queue_notification_type_check
  CHECK (notification_type IN ('mention', 'comment', 'task_created'));

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS target_start_date DATE,
  ADD COLUMN IF NOT EXISTS unblocking_date DATE,
  ADD COLUMN IF NOT EXISTS disable_main_admin_reminders BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_human_activity_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_status_changed_at TIMESTAMPTZ;

UPDATE public.tasks
SET
  -- Existing tasks begin a fresh reminder cycle when automation is enabled.
  last_human_activity_at = COALESCE(last_human_activity_at, now()),
  last_status_changed_at = COALESCE(last_status_changed_at, now())
WHERE last_human_activity_at IS NULL OR last_status_changed_at IS NULL;

ALTER TABLE public.tasks
  ALTER COLUMN last_human_activity_at SET DEFAULT now(),
  ALTER COLUMN last_human_activity_at SET NOT NULL,
  ALTER COLUMN last_status_changed_at SET DEFAULT now(),
  ALTER COLUMN last_status_changed_at SET NOT NULL;

UPDATE public.tasks task
SET approver_id = profile.id
FROM public.profiles profile
WHERE task.approver_id IS NULL
  AND lower(profile.full_name) = lower('Alexandros K');

ALTER TABLE public.tasks ALTER COLUMN approver_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS public.task_automation_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  rule_key TEXT NOT NULL,
  activity_anchor TIMESTAMPTZ NOT NULL,
  comment_id UUID REFERENCES public.task_comments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, rule_key, activity_anchor)
);

ALTER TABLE public.task_automation_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_automation_deliveries FROM anon, authenticated;
GRANT ALL ON public.task_automation_deliveries TO service_role;

CREATE INDEX IF NOT EXISTS task_automation_deliveries_lookup_idx
  ON public.task_automation_deliveries (task_id, rule_key, activity_anchor);

CREATE OR REPLACE FUNCTION public.enforce_task_approver_and_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_approver UUID;
BEGIN
  SELECT id INTO default_approver
  FROM public.profiles
  WHERE lower(full_name) = lower('Alexandros K')
  LIMIT 1;

  NEW.approver_id := COALESCE(NEW.approver_id, default_approver);
  IF NEW.approver_id IS NULL THEN
    RAISE EXCEPTION 'Every task must have exactly one Approver';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.approver_id IS DISTINCT FROM OLD.approver_id
      AND auth.uid() IS NOT NULL
      AND NOT public.is_main_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only the Main Admin can change the Approver';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_changed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_task_approver_and_activity_trigger ON public.tasks;
CREATE TRIGGER enforce_task_approver_and_activity_trigger
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.enforce_task_approver_and_activity();

CREATE OR REPLACE FUNCTION public.track_human_task_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE((NEW.legacy_data ->> 'system')::BOOLEAN, FALSE) = FALSE
    AND COALESCE(NEW.legacy_data ->> 'automationType', '') = '' THEN
    UPDATE public.tasks
    SET last_human_activity_at = NEW.created_at
    WHERE id = NEW.task_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS track_human_task_comment_trigger ON public.task_comments;
CREATE TRIGGER track_human_task_comment_trigger
AFTER INSERT ON public.task_comments
FOR EACH ROW EXECUTE FUNCTION public.track_human_task_comment();

CREATE OR REPLACE FUNCTION public.enqueue_automation_mentions(
  target_task public.tasks,
  generated_comment_id UUID,
  generated_comment_text TEXT,
  mentioned_profile_ids UUID[],
  main_admin_id UUID,
  main_admin_name TEXT,
  automation_rule TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.mention_email_queue (
    dedupe_key, notification_type, recipient_profile_id, recipient_email,
    recipient_name, author_id, author_name, task_id, task_key, task_title,
    comment_id, comment_text, task_url
  )
  SELECT
    'automation:' || automation_rule || ':' || generated_comment_id::TEXT || ':' || profile.id::TEXT,
    'mention', profile.id, profile.email, profile.full_name, main_admin_id,
    main_admin_name, target_task.id, target_task.task_key, target_task.title,
    generated_comment_id::TEXT, generated_comment_text,
    'https://mailo.shd.global/?task=' || target_task.task_key
  FROM public.profiles profile
  WHERE profile.id = ANY(mentioned_profile_ids)
    AND profile.email IS NOT NULL
    AND profile.is_active IS DISTINCT FROM FALSE
    AND profile.id IS DISTINCT FROM main_admin_id
  ON CONFLICT (dedupe_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_main_admin_automation_comment(
  target_task public.tasks,
  automation_rule TEXT,
  anchor_value TIMESTAMPTZ,
  message_text TEXT,
  mentioned_profile_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  main_admin_id UUID;
  main_admin_name TEXT;
  generated_comment_id UUID;
BEGIN
  SELECT profile.id, profile.full_name
  INTO main_admin_id, main_admin_name
  FROM public.profiles profile
  JOIN public.user_roles role ON role.user_id = profile.id
  WHERE role.role = 'main_admin'
  LIMIT 1;

  IF main_admin_id IS NULL THEN RETURN FALSE; END IF;

  INSERT INTO public.task_automation_deliveries (task_id, rule_key, activity_anchor)
  VALUES (target_task.id, automation_rule, anchor_value)
  ON CONFLICT DO NOTHING
  RETURNING id INTO generated_comment_id;
  IF generated_comment_id IS NULL THEN RETURN FALSE; END IF;

  INSERT INTO public.task_comments (
    task_id, author_id, content, created_at, updated_at, legacy_data
  ) VALUES (
    target_task.id, main_admin_id, message_text, now(), now(),
    jsonb_build_object(
      'id', 'main-admin-reminder-' || generated_comment_id::TEXT,
      'author', main_admin_name,
      'role', 'Main Admin',
      'createdAt', now(),
      'automationType', automation_rule,
      'images', '[]'::JSONB
    )
  )
  RETURNING id INTO generated_comment_id;

  UPDATE public.task_automation_deliveries
  SET comment_id = generated_comment_id
  WHERE task_id = target_task.id
    AND rule_key = automation_rule
    AND task_automation_deliveries.activity_anchor = anchor_value;

  PERFORM public.enqueue_automation_mentions(
    target_task, generated_comment_id, message_text,
    array_remove(mentioned_profile_ids, NULL),
    main_admin_id, main_admin_name, automation_rule
  );
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_task_automations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_record public.tasks;
  anchor_time TIMESTAMPTZ;
  processed INTEGER := 0;
  message_text TEXT;
  rule_key TEXT;
  mentioned_ids UUID[];
  reminder_hours INTEGER;
  approver_name TEXT;
  assignee_name TEXT;
  supervisor_name TEXT;
BEGIN
  FOR task_record IN
    SELECT * FROM public.tasks
    WHERE status NOT IN ('done', 'cancelled')
      AND disable_main_admin_reminders = FALSE
  LOOP
    anchor_time := GREATEST(
      task_record.created_at,
      task_record.last_human_activity_at,
      task_record.last_status_changed_at
    );
    SELECT full_name INTO approver_name FROM public.profiles WHERE id = task_record.approver_id;
    SELECT full_name INTO assignee_name FROM public.profiles WHERE id = task_record.assignee_id;
    SELECT full_name INTO supervisor_name FROM public.profiles WHERE id = task_record.supervisor_id;

    rule_key := NULL;
    message_text := NULL;
    mentioned_ids := ARRAY[]::UUID[];

    IF task_record.is_mini_task THEN
      FOREACH reminder_hours IN ARRAY ARRAY[1, 3, 24] LOOP
        IF now() >= anchor_time + make_interval(hours => reminder_hours) THEN
          rule_key := 'mini_inactive_' || reminder_hours || 'h';
          message_text := 'Έχουμε κάποιο update εδώ'
            || CASE WHEN assignee_name IS NOT NULL THEN ' @' || assignee_name ELSE '' END || '?';
          mentioned_ids := ARRAY[task_record.assignee_id];
          IF public.create_main_admin_automation_comment(
            task_record, rule_key, anchor_time, message_text, mentioned_ids
          ) THEN processed := processed + 1; END IF;
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    IF task_record.status = 'backlog' AND now() >= anchor_time + interval '24 hours' THEN
      rule_key := 'backlog_inactive_24h';
      message_text := 'Έχουμε κάποιο update εδώ'
        || CASE WHEN approver_name IS NOT NULL THEN ' @' || approver_name ELSE '' END || '?';
      mentioned_ids := ARRAY[task_record.approver_id];
    ELSIF task_record.status = 'todo'
      AND (
        (task_record.target_start_date IS NULL AND now() >= anchor_time + interval '24 hours')
        OR task_record.target_start_date < current_date
      ) THEN
      rule_key := CASE WHEN task_record.target_start_date IS NULL
        THEN 'todo_missing_target_start_24h'
        ELSE 'todo_target_start_overdue:' || task_record.target_start_date::TEXT END;
      message_text := 'Έχουμε κάποιο update εδώ'
        || CASE WHEN supervisor_name IS NOT NULL THEN ' @' || supervisor_name ELSE '' END
        || CASE WHEN assignee_name IS NOT NULL THEN ' @' || assignee_name ELSE '' END || '?';
      mentioned_ids := ARRAY[task_record.supervisor_id, task_record.assignee_id];
    ELSIF task_record.status = 'pause' AND now() >= anchor_time + interval '24 hours' THEN
      rule_key := 'paused_inactive_24h';
      message_text := 'Έχουμε κάποιο update εδώ'
        || CASE WHEN supervisor_name IS NOT NULL THEN ' @' || supervisor_name ELSE '' END
        || CASE WHEN assignee_name IS NOT NULL THEN ' @' || assignee_name ELSE '' END
        || CASE WHEN approver_name IS NOT NULL THEN ' @' || approver_name ELSE '' END || '?';
      mentioned_ids := ARRAY[task_record.supervisor_id, task_record.assignee_id, task_record.approver_id];
    ELSIF task_record.status = 'blocked'
      AND task_record.unblocking_date IS NULL
      AND now() >= anchor_time + interval '24 hours' THEN
      rule_key := 'blocked_missing_unblocking_24h';
      message_text := 'Έχουμε κάποιο update εδώ'
        || CASE WHEN supervisor_name IS NOT NULL THEN ' @' || supervisor_name ELSE '' END
        || CASE WHEN assignee_name IS NOT NULL THEN ' @' || assignee_name ELSE '' END
        || CASE WHEN approver_name IS NOT NULL THEN ' @' || approver_name ELSE '' END || '?';
      mentioned_ids := ARRAY[task_record.supervisor_id, task_record.assignee_id, task_record.approver_id];
    ELSIF task_record.status = 'blocked'
      AND task_record.unblocking_date IS NOT NULL
      AND task_record.unblocking_date <= current_date THEN
      rule_key := 'unblocking_date:' || task_record.unblocking_date::TEXT;
      message_text := CASE WHEN approver_name IS NOT NULL THEN '@' || approver_name || ' ' ELSE '' END
        || 'πρέπει να ξεμπλοκάρει το Task';
      mentioned_ids := ARRAY[task_record.approver_id];
    ELSIF task_record.status = 'review' AND now() >= anchor_time + interval '24 hours' THEN
      rule_key := 'review_inactive_24h';
      message_text := 'Έχουμε κάποιο update εδώ'
        || CASE WHEN approver_name IS NOT NULL THEN ' @' || approver_name ELSE '' END || '?';
      mentioned_ids := ARRAY[task_record.approver_id];
    END IF;

    IF rule_key IS NOT NULL AND public.create_main_admin_automation_comment(
      task_record, rule_key, anchor_time, message_text, mentioned_ids
    ) THEN processed := processed + 1; END IF;
  END LOOP;
  RETURN processed;
END;
$$;

REVOKE ALL ON FUNCTION public.process_task_automations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_task_automations() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-task-automations') THEN
    PERFORM cron.unschedule('process-task-automations');
  END IF;
END $$;

SELECT cron.schedule(
  'process-task-automations',
  '*/10 * * * *',
  $$SELECT public.process_task_automations();$$
);
