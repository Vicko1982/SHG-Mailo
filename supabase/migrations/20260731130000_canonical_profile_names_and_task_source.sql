-- Keep every client and automation on the same canonical user identity.
ALTER TABLE public.profiles DISABLE TRIGGER protect_profile_name_before_update;
UPDATE public.profiles
SET full_name = 'Smart Homes Assistant'
WHERE lower(email) = lower('info+assistant@shd.global')
   OR lower(full_name) = lower('SH Assistant');
ALTER TABLE public.profiles ENABLE TRIGGER protect_profile_name_before_update;

-- Remove stale display-name copies from task legacy payloads. Relational
-- assignee/supervisor/approver ids remain the only authoritative assignment data.
UPDATE public.tasks
SET legacy_data = (COALESCE(legacy_data, '{}'::jsonb)
  - 'assignee' - 'supervisor' - 'approver')
WHERE COALESCE(legacy_data, '{}'::jsonb) ?| ARRAY['assignee', 'supervisor', 'approver'];

-- Automation comments always resolve the current profile names from the
-- relational ids at execution time. Recreate the routine to make that rule
-- explicit and to avoid duplicate mentions when one person has several roles.
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
    SELECT full_name INTO approver_name FROM public.profiles WHERE id = task_record.approver_id AND is_active IS DISTINCT FROM FALSE;
    SELECT full_name INTO assignee_name FROM public.profiles WHERE id = task_record.assignee_id AND is_active IS DISTINCT FROM FALSE;
    SELECT full_name INTO supervisor_name FROM public.profiles WHERE id = task_record.supervisor_id AND is_active IS DISTINCT FROM FALSE;

    rule_key := NULL;
    message_text := NULL;
    mentioned_ids := ARRAY[]::UUID[];

    IF task_record.is_mini_task THEN
      FOREACH reminder_hours IN ARRAY ARRAY[1, 3, 24] LOOP
        IF now() >= anchor_time + make_interval(hours => reminder_hours) THEN
          rule_key := 'mini_inactive_' || reminder_hours || 'h';
          message_text := 'Έχουμε κάποιο update εδώ'
            || CASE WHEN assignee_name IS NOT NULL THEN ' @' || assignee_name ELSE '' END || '?';
          mentioned_ids := ARRAY(SELECT DISTINCT id FROM unnest(ARRAY[task_record.assignee_id]) id WHERE id IS NOT NULL);
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
      AND ((task_record.target_start_date IS NULL AND now() >= anchor_time + interval '24 hours')
        OR task_record.target_start_date < current_date) THEN
      rule_key := CASE WHEN task_record.target_start_date IS NULL
        THEN 'todo_missing_target_start_24h'
        ELSE 'todo_target_start_overdue:' || task_record.target_start_date::TEXT END;
      message_text := 'Έχουμε κάποιο update εδώ'
        || CASE WHEN supervisor_name IS NOT NULL THEN ' @' || supervisor_name ELSE '' END
        || CASE WHEN assignee_name IS NOT NULL AND task_record.assignee_id IS DISTINCT FROM task_record.supervisor_id
          THEN ' @' || assignee_name ELSE '' END || '?';
      mentioned_ids := ARRAY(SELECT DISTINCT id FROM unnest(ARRAY[task_record.supervisor_id, task_record.assignee_id]) id WHERE id IS NOT NULL);
    ELSIF task_record.status = 'pause' AND now() >= anchor_time + interval '24 hours' THEN
      rule_key := 'paused_inactive_24h';
      message_text := 'Έχουμε κάποιο update εδώ'
        || CASE WHEN supervisor_name IS NOT NULL THEN ' @' || supervisor_name ELSE '' END
        || CASE WHEN assignee_name IS NOT NULL AND task_record.assignee_id IS DISTINCT FROM task_record.supervisor_id THEN ' @' || assignee_name ELSE '' END
        || CASE WHEN approver_name IS NOT NULL AND array_position(ARRAY[task_record.supervisor_id, task_record.assignee_id], task_record.approver_id) IS NULL THEN ' @' || approver_name ELSE '' END || '?';
      mentioned_ids := ARRAY(SELECT DISTINCT id FROM unnest(ARRAY[task_record.supervisor_id, task_record.assignee_id, task_record.approver_id]) id WHERE id IS NOT NULL);
    ELSIF task_record.status = 'blocked' AND task_record.unblocking_date IS NULL
      AND now() >= anchor_time + interval '24 hours' THEN
      rule_key := 'blocked_missing_unblocking_24h';
      message_text := 'Έχουμε κάποιο update εδώ'
        || CASE WHEN supervisor_name IS NOT NULL THEN ' @' || supervisor_name ELSE '' END
        || CASE WHEN assignee_name IS NOT NULL AND task_record.assignee_id IS DISTINCT FROM task_record.supervisor_id THEN ' @' || assignee_name ELSE '' END
        || CASE WHEN approver_name IS NOT NULL AND array_position(ARRAY[task_record.supervisor_id, task_record.assignee_id], task_record.approver_id) IS NULL THEN ' @' || approver_name ELSE '' END || '?';
      mentioned_ids := ARRAY(SELECT DISTINCT id FROM unnest(ARRAY[task_record.supervisor_id, task_record.assignee_id, task_record.approver_id]) id WHERE id IS NOT NULL);
    ELSIF task_record.status = 'blocked' AND task_record.unblocking_date IS NOT NULL
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
      task_record, rule_key, anchor_time, message_text,
      ARRAY(SELECT DISTINCT id FROM unnest(mentioned_ids) id WHERE id IS NOT NULL)
    ) THEN processed := processed + 1; END IF;
  END LOOP;
  RETURN processed;
END;
$$;

REVOKE ALL ON FUNCTION public.process_task_automations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_task_automations() TO service_role;
