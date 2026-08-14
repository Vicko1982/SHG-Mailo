-- MAILO Version 75: notify the previous Assignee when an assignment is
-- removed or replaced. Current Assignee and Supervisor notifications remain
-- unchanged. A profile receives only one queue entry per task update, even
-- when it matches more than one recipient role.

CREATE OR REPLACE FUNCTION public.enqueue_task_change_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  change_message text;
  change_event_id text := gen_random_uuid()::text;
BEGIN
  IF ROW(
    NEW.status,
    NEW.assignee_id,
    NEW.supervisor_id,
    NEW.approver_id,
    NEW.title,
    NEW.description,
    NEW.priority,
    NEW.due_date
  ) IS NOT DISTINCT FROM ROW(
    OLD.status,
    OLD.assignee_id,
    OLD.supervisor_id,
    OLD.approver_id,
    OLD.title,
    OLD.description,
    OLD.priority,
    OLD.due_date
  ) THEN
    RETURN NEW;
  END IF;

  change_message := concat_ws(' · ',
    CASE WHEN NEW.status IS DISTINCT FROM OLD.status
      THEN 'Status: ' || OLD.status || ' → ' || NEW.status END,
    CASE WHEN NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
      THEN 'Assignee: '
        || COALESCE(
          (SELECT profile.full_name FROM public.profiles profile WHERE profile.id = OLD.assignee_id),
          'Unassigned'
        )
        || ' → '
        || COALESCE(
          (SELECT profile.full_name FROM public.profiles profile WHERE profile.id = NEW.assignee_id),
          'Unassigned'
        )
      END,
    CASE WHEN NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id
      THEN 'Supervisor changed' END,
    CASE WHEN NEW.approver_id IS DISTINCT FROM OLD.approver_id
      THEN 'Approver changed' END,
    CASE WHEN NEW.title IS DISTINCT FROM OLD.title
      THEN 'Title changed' END,
    CASE WHEN NEW.description IS DISTINCT FROM OLD.description
      THEN 'Description changed' END,
    CASE WHEN NEW.priority IS DISTINCT FROM OLD.priority
      THEN 'Priority changed' END,
    CASE WHEN NEW.due_date IS DISTINCT FROM OLD.due_date
      THEN 'Due date changed' END
  );

  INSERT INTO public.mention_email_queue(
    dedupe_key,
    notification_type,
    recipient_profile_id,
    recipient_email,
    recipient_name,
    author_id,
    author_name,
    task_id,
    task_key,
    task_title,
    comment_id,
    comment_text,
    task_url,
    recipient_context
  )
  SELECT
    'task-change:' || NEW.id || ':' || change_event_id || ':' || recipient.id,
    'task_change',
    recipient.id,
    recipient.email,
    recipient.full_name,
    auth.uid(),
    COALESCE(actor.full_name, 'Mailo user'),
    NEW.id,
    NEW.task_key,
    NEW.title,
    'task-change:' || NEW.id || ':' || change_event_id,
    change_message,
    'https://mailo.shd.global/?task=' || NEW.task_key,
    jsonb_build_object(
      'roles',
      to_jsonb(array_remove(ARRAY[
        CASE WHEN NEW.assignee_id = recipient.id THEN 'Assignee' END,
        CASE WHEN NEW.supervisor_id = recipient.id THEN 'Supervisor' END,
        CASE
          WHEN NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
            AND OLD.assignee_id = recipient.id
            AND NEW.assignee_id IS DISTINCT FROM recipient.id
          THEN 'Previous Assignee'
        END
      ], NULL))
    )
  FROM public.profiles recipient
  LEFT JOIN public.profiles actor ON actor.id = auth.uid()
  WHERE (
      recipient.id = NEW.assignee_id
      OR recipient.id = NEW.supervisor_id
      OR (
        NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
        AND recipient.id = OLD.assignee_id
      )
    )
    AND recipient.id IS DISTINCT FROM auth.uid()
    AND recipient.email IS NOT NULL
    AND recipient.is_active IS DISTINCT FROM false
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_task_change_notifications()
IS 'Version 75: email each current Assignee/Supervisor and the previous Assignee after assignment removal or replacement, once per recipient.';
