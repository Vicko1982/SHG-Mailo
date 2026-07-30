DROP POLICY IF EXISTS "Task comments deletable by author or main admin"
  ON public.task_comments;
DROP POLICY IF EXISTS "Task comments deletable by author or administrators"
  ON public.task_comments;
DROP POLICY IF EXISTS "Task comments deletable by main admin"
  ON public.task_comments;

CREATE POLICY "Task comments deletable by main admin"
ON public.task_comments FOR DELETE
TO authenticated
USING (public.is_main_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.enqueue_human_comment_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE((NEW.legacy_data->>'system')::BOOLEAN, FALSE)
    OR COALESCE(NEW.legacy_data->>'automationType', '') <> '' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.mention_email_queue (
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
    'human-comment:' || NEW.id::TEXT || ':' || recipient.id::TEXT,
    'comment',
    recipient.id,
    recipient.email,
    recipient.full_name,
    NEW.author_id,
    COALESCE(author.full_name, 'User'),
    task.id,
    task.task_key,
    task.title,
    NEW.id::TEXT,
    NEW.content,
    'https://mailo.shd.global/?task=' || task.task_key,
    jsonb_build_object(
      'roles',
      to_jsonb(array_remove(ARRAY[
        CASE
          WHEN lower(NEW.content) LIKE '%@' || lower(recipient.full_name) || '%'
          THEN 'Mention'
        END,
        CASE WHEN task.assignee_id = recipient.id THEN 'Assignee' END,
        CASE WHEN task.supervisor_id = recipient.id THEN 'Supervisor' END
      ], NULL))
    )
  FROM public.tasks task
  JOIN public.profiles recipient
    ON (
      task.assignee_id = recipient.id
      OR task.supervisor_id = recipient.id
      OR lower(NEW.content) LIKE '%@' || lower(recipient.full_name) || '%'
    )
  LEFT JOIN public.profiles author ON author.id = NEW.author_id
  WHERE task.id = NEW.task_id
    AND recipient.email IS NOT NULL
    AND recipient.is_active IS DISTINCT FROM FALSE
    AND recipient.id IS DISTINCT FROM NEW.author_id
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enqueue_human_comment_notifications_trigger
  ON public.task_comments;
CREATE TRIGGER enqueue_human_comment_notifications_trigger
AFTER INSERT ON public.task_comments
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_human_comment_notifications();
