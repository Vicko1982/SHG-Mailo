CREATE TABLE IF NOT EXISTS public.voice_task_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  confirmation_summary TEXT NOT NULL,
  confirmation_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
  confirmed_at TIMESTAMPTZ,
  created_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.voice_task_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_task_drafts FROM anon, authenticated;
GRANT ALL ON public.voice_task_drafts TO service_role;

CREATE INDEX IF NOT EXISTS voice_task_drafts_expiry_idx
  ON public.voice_task_drafts (expires_at)
  WHERE confirmed_at IS NULL;

CREATE OR REPLACE FUNCTION public.confirm_voice_task_draft(
  selected_draft_id UUID,
  selected_token_hash TEXT
)
RETURNS TABLE(task_id UUID, task_key TEXT, task_title TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  draft_record public.voice_task_drafts;
  creator_profile public.profiles;
  selected_space public.spaces;
  selected_approver public.profiles;
  selected_assignee public.profiles;
  selected_supervisor public.profiles;
  generated_task_id UUID;
  generated_task_key TEXT;
  generated_comment_id UUID;
  generated_number INTEGER;
  changed_at TIMESTAMPTZ := now();
  is_mini BOOLEAN;
  selected_status TEXT;
  selected_jira_status TEXT;
  selected_issue_type TEXT;
  selected_due_date DATE;
  system_comment TEXT;
  clean_description TEXT;
  recipient RECORD;
BEGIN
  SELECT *
  INTO draft_record
  FROM public.voice_task_drafts
  WHERE id = selected_draft_id
  FOR UPDATE;

  IF draft_record.id IS NULL THEN
    RAISE EXCEPTION 'Voice Task draft not found';
  END IF;
  IF draft_record.confirmation_token_hash <> selected_token_hash THEN
    RAISE EXCEPTION 'Invalid confirmation token';
  END IF;
  IF draft_record.expires_at <= now() THEN
    RAISE EXCEPTION 'This confirmation has expired. Prepare the Task again.';
  END IF;
  IF draft_record.confirmed_at IS NOT NULL THEN
    IF draft_record.created_task_id IS NULL THEN
      RAISE EXCEPTION 'This confirmation is already being processed';
    END IF;
    RETURN QUERY
      SELECT task.id, task.task_key, task.title
      FROM public.tasks task
      WHERE task.id = draft_record.created_task_id;
    RETURN;
  END IF;

  SELECT * INTO creator_profile
  FROM public.profiles
  WHERE id = draft_record.created_by_id
    AND is_active IS DISTINCT FROM false;
  IF creator_profile.id IS NULL THEN
    RAISE EXCEPTION 'The configured Voice Task creator is inactive or missing';
  END IF;

  SELECT * INTO selected_space
  FROM public.spaces
  WHERE id = (draft_record.payload ->> 'spaceId')::UUID;
  IF selected_space.id IS NULL THEN
    RAISE EXCEPTION 'The selected Space no longer exists';
  END IF;

  SELECT profile.* INTO selected_approver
  FROM public.app_settings settings
  JOIN public.profiles profile ON profile.id = settings.current_approver_id
  WHERE settings.id = true
    AND profile.is_active IS DISTINCT FROM false;
  IF selected_approver.id IS NULL THEN
    RAISE EXCEPTION 'A single active Approver is required';
  END IF;

  IF NULLIF(draft_record.payload ->> 'assigneeId', '') IS NOT NULL THEN
    SELECT * INTO selected_assignee
    FROM public.profiles
    WHERE id = (draft_record.payload ->> 'assigneeId')::UUID
      AND is_active IS DISTINCT FROM false;
  END IF;
  IF NULLIF(draft_record.payload ->> 'supervisorId', '') IS NOT NULL THEN
    SELECT * INTO selected_supervisor
    FROM public.profiles
    WHERE id = (draft_record.payload ->> 'supervisorId')::UUID
      AND is_active IS DISTINCT FROM false;
  END IF;

  is_mini := COALESCE((draft_record.payload ->> 'isMiniTask')::BOOLEAN, false);
  IF is_mini AND selected_assignee.id IS NULL THEN
    RAISE EXCEPTION 'An Assignee is required for every Mini Task';
  END IF;

  selected_status := CASE WHEN is_mini THEN 'progress' ELSE 'backlog' END;
  selected_jira_status := CASE WHEN is_mini THEN 'In Progress' ELSE 'Backlog' END;
  selected_issue_type := CASE WHEN is_mini THEN 'Mini Task' ELSE 'Task' END;
  selected_due_date := NULLIF(draft_record.payload ->> 'dueDate', '')::DATE;
  clean_description := NULLIF(trim(draft_record.payload ->> 'description'), '');

  PERFORM pg_advisory_xact_lock(hashtext('voice-task-key:' || selected_space.id::TEXT));
  SELECT COALESCE(
    max((regexp_match(task.task_key, '-([0-9]+)$'))[1]::INTEGER),
    0
  ) + 1
  INTO generated_number
  FROM public.tasks task
  WHERE task.space_id = selected_space.id
    AND task.task_key ~ ('^' || regexp_replace(selected_space.key, '([\\W])', '\\\1', 'g') || '-[0-9]+$');
  generated_task_key := selected_space.key || '-' || generated_number;

  INSERT INTO public.tasks (
    task_key, title, space_id, status, jira_status, priority,
    assignee_id, supervisor_id, approver_id, description, issue_type,
    created_at, updated_at, due_date, labels, created_by_id, audit,
    is_mini_task, last_human_activity_at, last_status_changed_at, legacy_data
  ) VALUES (
    generated_task_key,
    draft_record.payload ->> 'title',
    selected_space.id,
    selected_status,
    selected_jira_status,
    COALESCE(NULLIF(draft_record.payload ->> 'priority', ''), 'Medium'),
    selected_assignee.id,
    selected_supervisor.id,
    selected_approver.id,
    COALESCE(clean_description, 'No description has been added.'),
    selected_issue_type,
    changed_at,
    changed_at,
    selected_due_date,
    ARRAY(
      SELECT jsonb_array_elements_text(COALESCE(draft_record.payload -> 'labels', '[]'::JSONB))
    ),
    creator_profile.id,
    jsonb_build_array(
      selected_issue_type || ' created by voice command from ChatGPT by '
      || creator_profile.full_name
    ),
    is_mini,
    changed_at,
    changed_at,
    jsonb_build_object(
      'id', generated_task_key,
      'title', draft_record.payload ->> 'title',
      'project', selected_space.key,
      'creator', creator_profile.full_name,
      'status', selected_status,
      'jiraStatus', selected_jira_status,
      'priority', COALESCE(NULLIF(draft_record.payload ->> 'priority', ''), 'Medium'),
      'labels', COALESCE(draft_record.payload -> 'labels', '[]'::JSONB),
      'dueDate', selected_due_date,
      'assignee', COALESCE(selected_assignee.full_name, 'Unassigned'),
      'supervisor', COALESCE(selected_supervisor.full_name, 'Unassigned'),
      'approver', selected_approver.full_name,
      'description', COALESCE(clean_description, 'No description has been added.'),
      'created', changed_at,
      'updated', changed_at,
      'lastHumanActivityAt', changed_at,
      'lastStatusChangedAt', changed_at,
      'comments', '[]'::JSONB,
      'audit', jsonb_build_array(
        selected_issue_type || ' created by voice command from ChatGPT by '
        || creator_profile.full_name
      ),
      'isMiniTask', is_mini,
      'issueType', selected_issue_type,
      'reminderProfile', CASE WHEN is_mini THEN 'mini' ELSE NULL END
    )
  )
  RETURNING id INTO generated_task_id;

  system_comment := '@' || selected_approver.full_name
    || ' New ' || CASE WHEN is_mini THEN 'Mini Task' ELSE 'task' END
    || ' created in ' || selected_jira_status || '. Approver review required.';

  INSERT INTO public.task_comments (
    task_id, author_id, content, created_at, updated_at, legacy_data
  ) VALUES (
    generated_task_id,
    creator_profile.id,
    system_comment,
    changed_at,
    changed_at,
    jsonb_build_object(
      'id', 'voice-task-created-' || generated_task_id::TEXT,
      'author', creator_profile.full_name,
      'role', 'Main Admin',
      'text', system_comment,
      'images', '[]'::JSONB,
      'createdAt', changed_at,
      'system', true,
      'automationType', 'task-created'
    )
  )
  RETURNING id INTO generated_comment_id;

  INSERT INTO public.activity_log (
    user_id, action, task_id, task_title, metadata, created_at, legacy_data
  ) VALUES (
    creator_profile.id,
    'voice_task_created',
    generated_task_id,
    draft_record.payload ->> 'title',
    jsonb_build_object(
      'task_key', generated_task_key,
      'source', 'chatgpt_voice',
      'is_mini_task', is_mini
    ),
    changed_at,
    jsonb_build_object(
      'id', 'voice-task-activity-' || generated_task_id::TEXT,
      'at', changed_at,
      'user', creator_profile.full_name,
      'action', 'Created by voice command from ChatGPT',
      'taskId', generated_task_key,
      'taskTitle', draft_record.payload ->> 'title'
    )
  );

  FOR recipient IN
    SELECT
      profile.id,
      profile.email,
      profile.full_name,
      array_agg(DISTINCT roles.role_name) AS role_names
    FROM (
      SELECT selected_assignee.id AS profile_id, 'Assignee'::TEXT AS role_name
      WHERE selected_assignee.id IS NOT NULL
      UNION ALL
      SELECT selected_supervisor.id, 'Supervisor'::TEXT
      WHERE selected_supervisor.id IS NOT NULL
      UNION ALL
      SELECT selected_approver.id, 'Approver'::TEXT
    ) roles
    JOIN public.profiles profile ON profile.id = roles.profile_id
    WHERE profile.email IS NOT NULL
      AND profile.is_active IS DISTINCT FROM false
      AND profile.id IS DISTINCT FROM creator_profile.id
    GROUP BY profile.id, profile.email, profile.full_name
  LOOP
    INSERT INTO public.mention_email_queue (
      dedupe_key, notification_type, recipient_profile_id, recipient_email,
      recipient_name, author_id, author_name, task_id, task_key, task_title,
      comment_id, comment_text, task_url, recipient_context
    ) VALUES (
      'voice-task-created:' || generated_task_id::TEXT || ':' || recipient.id::TEXT,
      'task_created',
      recipient.id,
      recipient.email,
      recipient.full_name,
      creator_profile.id,
      creator_profile.full_name,
      generated_task_id,
      generated_task_key,
      draft_record.payload ->> 'title',
      'voice-task-created:' || generated_task_id::TEXT,
      'A new task was created.',
      'https://mailo.shd.global/?task=' || generated_task_key,
      jsonb_build_object('roles', recipient.role_names)
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;

  UPDATE public.voice_task_drafts
  SET confirmed_at = changed_at, created_task_id = generated_task_id
  WHERE id = draft_record.id;

  RETURN QUERY
    SELECT generated_task_id, generated_task_key, draft_record.payload ->> 'title';
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_voice_task_draft(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_voice_task_draft(UUID, TEXT)
  TO service_role;
