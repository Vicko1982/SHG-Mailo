-- MAILO Version 81: create Tasks through one database-authorized entry point.
-- The browser previously sent a direct INSERT which could be rejected by a
-- stale or overlapping RLS policy even when the authenticated Victor/Main
-- Admin profile was valid. This function validates the real caller, delegates
-- Personal ownership to the existing triggers and returns the canonical row.

CREATE OR REPLACE FUNCTION public.create_mailo_task_v81(_payload jsonb)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  requested_creator_id uuid;
  selected_creator_id uuid;
  selected_space_id uuid;
  selected_space_key text;
  selected_space_type text;
  actor_is_main_admin boolean := false;
  created_task public.tasks%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'An authenticated MAILO account is required to create a Task';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = actor_id
      AND profile.is_active IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'The authenticated MAILO profile is inactive or missing';
  END IF;

  BEGIN
    selected_space_id := NULLIF(_payload->>'space_id', '')::uuid;
    requested_creator_id := NULLIF(_payload->>'created_by_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'The Task contains an invalid Space or Creator identifier';
  END;

  SELECT space.key, space.type
  INTO selected_space_key, selected_space_type
  FROM public.spaces space
  WHERE space.id = selected_space_id;

  IF selected_space_key IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'The selected Space does not exist';
  END IF;

  actor_is_main_admin := public.is_main_admin(actor_id)
    OR public.is_victor_stavropoulos(actor_id);

  -- Personal-space triggers remain the final authority and lock all Task roles
  -- to the owner. For a shared Task, only a verified Main Admin may represent
  -- another active profile through View As.
  IF selected_space_key = 'PER' OR selected_space_type = 'personal' THEN
    selected_creator_id := CASE
      WHEN public.is_victor_stavropoulos(actor_id)
        THEN COALESCE(requested_creator_id, actor_id)
      ELSE actor_id
    END;
  ELSIF requested_creator_id IS NULL OR requested_creator_id = actor_id THEN
    selected_creator_id := actor_id;
  ELSIF actor_is_main_admin AND EXISTS (
    SELECT 1
    FROM public.profiles profile
    WHERE profile.id = requested_creator_id
      AND profile.is_active IS DISTINCT FROM false
  ) THEN
    selected_creator_id := requested_creator_id;
  ELSE
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Only a Main Admin can create a shared Task for another user';
  END IF;

  INSERT INTO public.tasks (
    task_key,
    title,
    space_id,
    status,
    jira_status,
    priority,
    assignee_id,
    supervisor_id,
    approver_id,
    description,
    issue_type,
    due_date,
    target_start_date,
    unblocking_date,
    disable_main_admin_reminders,
    last_human_activity_at,
    last_status_changed_at,
    labels,
    cancellation_reason,
    created_by_id,
    audit,
    is_mini_task,
    manual_order,
    created_at,
    updated_at,
    legacy_data
  ) VALUES (
    NULLIF(_payload->>'task_key', ''),
    COALESCE(NULLIF(_payload->>'title', ''), NULLIF(_payload->>'task_key', '')),
    selected_space_id,
    COALESCE(NULLIF(_payload->>'status', ''), 'backlog'),
    NULLIF(_payload->>'jira_status', ''),
    NULLIF(_payload->>'priority', ''),
    NULLIF(_payload->>'assignee_id', '')::uuid,
    NULLIF(_payload->>'supervisor_id', '')::uuid,
    NULLIF(_payload->>'approver_id', '')::uuid,
    NULLIF(_payload->>'description', ''),
    COALESCE(NULLIF(_payload->>'issue_type', ''), 'Task'),
    NULLIF(_payload->>'due_date', '')::date,
    NULLIF(_payload->>'target_start_date', '')::date,
    NULLIF(_payload->>'unblocking_date', '')::date,
    COALESCE((_payload->>'disable_main_admin_reminders')::boolean, false),
    COALESCE(NULLIF(_payload->>'last_human_activity_at', '')::timestamptz, now()),
    COALESCE(NULLIF(_payload->>'last_status_changed_at', '')::timestamptz, now()),
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(_payload->'labels', '[]'::jsonb))),
      '{}'::text[]
    ),
    NULLIF(_payload->>'cancellation_reason', ''),
    selected_creator_id,
    CASE
      WHEN jsonb_typeof(_payload->'audit') = 'array' THEN _payload->'audit'
      ELSE '[]'::jsonb
    END,
    COALESCE((_payload->>'is_mini_task')::boolean, false),
    NULLIF(_payload->>'manual_order', '')::bigint,
    COALESCE(NULLIF(_payload->>'created_at', '')::timestamptz, now()),
    COALESCE(NULLIF(_payload->>'updated_at', '')::timestamptz, now()),
    CASE
      WHEN jsonb_typeof(_payload->'legacy_data') = 'object' THEN _payload->'legacy_data'
      ELSE '{}'::jsonb
    END
  )
  RETURNING * INTO created_task;

  RETURN NEXT created_task;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.create_mailo_task_v81(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_mailo_task_v81(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_mailo_task_v81(jsonb) TO service_role;

ALTER TABLE public.app_settings
  ALTER COLUMN minimum_client_version SET DEFAULT 81;
