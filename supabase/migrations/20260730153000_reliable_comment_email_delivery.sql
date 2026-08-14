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
    'comment:' || NEW.id::TEXT || ':' || recipient.id::TEXT,
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
        CASE WHEN mention_match.is_mentioned THEN 'Mention' END,
        CASE WHEN task.assignee_id = recipient.id THEN 'Assignee' END,
        CASE WHEN task.supervisor_id = recipient.id THEN 'Supervisor' END
      ], NULL))
    )
  FROM public.tasks task
  JOIN public.profiles recipient
    ON recipient.email IS NOT NULL
    AND recipient.is_active IS DISTINCT FROM FALSE
  CROSS JOIN LATERAL (
    SELECT
      lower(NEW.content) LIKE '%@' || lower(recipient.full_name) || '%'
      OR (
        lower(NEW.content) ~ (
          '(^|[[:space:]])@'
          || regexp_replace(
            lower(split_part(recipient.full_name, ' ', 1)),
            '([][(){}.*+?^$|\\-])',
            '\\\1',
            'g'
          )
          || '([[:space:][:punct:]]|$)'
        )
        AND (
          SELECT count(*)
          FROM public.profiles same_first_name
          WHERE same_first_name.is_active IS DISTINCT FROM FALSE
            AND lower(split_part(same_first_name.full_name, ' ', 1))
              = lower(split_part(recipient.full_name, ' ', 1))
        ) = 1
      ) AS is_mentioned
  ) mention_match
  LEFT JOIN public.profiles author ON author.id = NEW.author_id
  WHERE task.id = NEW.task_id
    AND (
      task.assignee_id = recipient.id
      OR task.supervisor_id = recipient.id
      OR mention_match.is_mentioned
    )
    AND recipient.id IS DISTINCT FROM NEW.author_id
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Recover the recent PRO-488 human comment that exposed the broken delivery
-- path. The shared queue dedupe key makes this safe to run once.
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
  'comment:' || comment.id::TEXT || ':' || recipient.id::TEXT,
  'comment',
  recipient.id,
  recipient.email,
  recipient.full_name,
  comment.author_id,
  COALESCE(author.full_name, 'User'),
  task.id,
  task.task_key,
  task.title,
  comment.id::TEXT,
  comment.content,
  'https://mailo.shd.global/?task=' || task.task_key,
  jsonb_build_object('roles', jsonb_build_array('Mention'))
FROM public.task_comments comment
JOIN public.tasks task ON task.id = comment.task_id
JOIN public.profiles recipient
  ON lower(comment.content) LIKE '%@' || lower(recipient.full_name) || '%'
LEFT JOIN public.profiles author ON author.id = comment.author_id
WHERE task.task_key = 'PRO-488'
  AND COALESCE((comment.legacy_data->>'system')::BOOLEAN, FALSE) = FALSE
  AND COALESCE(comment.legacy_data->>'automationType', '') = ''
  AND recipient.email IS NOT NULL
  AND recipient.is_active IS DISTINCT FROM FALSE
  AND recipient.id IS DISTINCT FROM comment.author_id
  AND comment.created_at >= now() - interval '24 hours'
ON CONFLICT (dedupe_key) DO NOTHING;
