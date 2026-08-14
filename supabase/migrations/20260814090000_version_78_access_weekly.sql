-- MAILO Version 78: explicit Task access rules for View As/Weekly Tasks and
-- a single, readable RLS boundary for Task creation and updates.

CREATE OR REPLACE FUNCTION public.profile_can_access_task_v78(
  _user_id uuid,
  _task_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks task
    JOIN public.spaces space ON space.id = task.space_id
    WHERE task.id = _task_id
      AND EXISTS (
        SELECT 1 FROM public.profiles profile
        WHERE profile.id = _user_id
          AND profile.is_active IS DISTINCT FROM false
      )
      AND CASE
        WHEN space.key = 'PER' THEN
          task.created_by_id = _user_id
          OR public.is_victor_stavropoulos(_user_id)
        WHEN space.type = 'personal' THEN
          space.owner_id = _user_id
          OR public.is_victor_stavropoulos(_user_id)
        ELSE
          public.is_main_admin(_user_id)
          OR public.has_role(_user_id, 'admin')
          OR task.assignee_id = _user_id
          OR task.supervisor_id = _user_id
          OR task.approver_id = _user_id
          OR task.created_by_id = _user_id
          OR public.user_can_access_space(_user_id, task.space_id)
          OR public.user_is_mentioned_in_task(_user_id, task.id)
      END
  );
$$;

GRANT EXECUTE ON FUNCTION public.profile_can_access_task_v78(uuid, uuid)
TO authenticated;

CREATE OR REPLACE FUNCTION public.user_can_access_task(
  _user_id uuid,
  _task_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    auth.role() = 'service_role'
    OR _user_id = auth.uid()
  ) AND public.profile_can_access_task_v78(_user_id, _task_id);
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_task(uuid, uuid)
TO authenticated;

DROP POLICY IF EXISTS "Tasks insertable by authenticated users" ON public.tasks;
CREATE POLICY "Tasks insertable by authenticated users"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    created_by_id = auth.uid()
    OR public.is_victor_stavropoulos(auth.uid())
    OR (
      public.is_main_admin(auth.uid())
      AND EXISTS (
        SELECT 1
        FROM public.spaces space
        WHERE space.id = space_id
          AND space.type = 'shared'
          AND space.key <> 'PER'
      )
      AND EXISTS (
        SELECT 1
        FROM public.profiles creator
        WHERE creator.id = created_by_id
          AND creator.is_active IS DISTINCT FROM false
      )
    )
  )
);

DROP POLICY IF EXISTS "Tasks updatable by those with task access" ON public.tasks;
CREATE POLICY "Tasks updatable by those with task access"
ON public.tasks FOR UPDATE
TO authenticated
USING (public.user_can_access_task(auth.uid(), id))
WITH CHECK (
  public.is_victor_stavropoulos(auth.uid())
  OR public.is_main_admin(auth.uid())
  OR public.profile_can_access_task_v78(auth.uid(), id)
);

-- Validate every newly added Weekly recipient against the actual Task access
-- model. A Main Admin may choose any active profile, but cannot accidentally
-- expose a Task through Weekly Tasks.
CREATE OR REPLACE FUNCTION public.enforce_weekly_task_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_name text;
  recipient_name text;
  recipient_id uuid;
  old_assignments jsonb := COALESCE(OLD.legacy_data->'weeklyAssignments', '{}'::jsonb);
  new_assignments jsonb := COALESCE(NEW.legacy_data->'weeklyAssignments', '{}'::jsonb);
  old_others jsonb;
  new_others jsonb;
BEGIN
  IF actor_id IS NULL OR old_assignments = new_assignments THEN
    RETURN NEW;
  END IF;

  -- A completed Task may leave all Weekly lists in the same write.
  IF NEW.status = 'done' AND new_assignments = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  FOR recipient_name IN SELECT jsonb_object_keys(new_assignments)
  LOOP
    IF old_assignments ? recipient_name THEN
      CONTINUE;
    END IF;
    SELECT profile.id INTO recipient_id
    FROM public.profiles profile
    WHERE lower(profile.full_name) = lower(recipient_name)
      AND profile.is_active IS DISTINCT FROM false
    LIMIT 1;
    IF recipient_id IS NULL THEN
      RAISE EXCEPTION 'The selected Weekly Tasks user is inactive or missing';
    END IF;
    IF NOT public.profile_can_access_task_v78(recipient_id, NEW.id) THEN
      RAISE EXCEPTION 'The selected user does not have access to this Task';
    END IF;
  END LOOP;

  IF public.is_main_admin(actor_id)
    OR public.is_victor_stavropoulos(actor_id) THEN
    RETURN NEW;
  END IF;

  SELECT profile.full_name INTO actor_name
  FROM public.profiles profile
  WHERE profile.id = actor_id
    AND profile.is_active IS DISTINCT FROM false;

  IF actor_name IS NULL THEN
    RAISE EXCEPTION 'The Weekly Task user is inactive or missing';
  END IF;

  old_others := old_assignments - actor_name;
  new_others := new_assignments - actor_name;
  IF old_others IS DISTINCT FROM new_others THEN
    RAISE EXCEPTION 'Only a Main Admin can change another user''s Weekly Tasks';
  END IF;
  IF old_assignments ? actor_name OR NOT (new_assignments ? actor_name) THEN
    RAISE EXCEPTION 'Only a Main Admin can remove or edit a Weekly Task assignment';
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.app_settings
  ALTER COLUMN minimum_client_version SET DEFAULT 78;

