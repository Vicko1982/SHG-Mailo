-- Version 50: one shared Personal workspace and no per-user space creation.

DROP TRIGGER IF EXISTS ensure_personal_space_after_profile_insert ON public.profiles;

INSERT INTO public.spaces (key, name, type, owner_id)
VALUES ('PER', 'Personal', 'shared', NULL)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name, type = 'shared', owner_id = NULL;

DO $$
DECLARE
  central_id uuid;
  internal_id uuid;
  victor_id uuid;
BEGIN
  SELECT id INTO central_id FROM public.spaces WHERE key = 'PER';
  SELECT id INTO internal_id FROM public.spaces
  WHERE lower(name) = 'internal & miscellaneous' OR key = 'IMI'
  ORDER BY CASE WHEN key = 'IMI' THEN 0 ELSE 1 END LIMIT 1;
  SELECT id INTO victor_id FROM public.profiles
  WHERE lower(email) = 'victor@shd.global' OR lower(full_name) = 'victor stavropoulos'
  LIMIT 1;

  -- Preserve all existing tasks. Personal tasks (except Victor's temporary
  -- space) move to the central Personal workspace.
  UPDATE public.tasks task
  SET space_id = central_id,
      disable_main_admin_reminders = TRUE
  FROM public.spaces space
  WHERE task.space_id = space.id
    AND space.type = 'personal'
    AND space.owner_id IS DISTINCT FROM victor_id;

  -- AK DS FF VS is retired; its tasks remain available in Internal & Misc.
  IF internal_id IS NOT NULL THEN
    UPDATE public.tasks task
    SET space_id = internal_id
    FROM public.spaces space
    WHERE task.space_id = space.id
      AND (regexp_replace(upper(space.key), '[^A-Z0-9]', '', 'g') = 'AKDSFFVS'
           OR regexp_replace(upper(space.name), '[^A-Z0-9]', '', 'g') = 'AKDSFFVS');
  END IF;

  DELETE FROM public.spaces
  WHERE type = 'personal' AND owner_id IS DISTINCT FROM victor_id;
  DELETE FROM public.spaces
  WHERE regexp_replace(upper(key), '[^A-Z0-9]', '', 'g') = 'AKDSFFVS'
     OR regexp_replace(upper(name), '[^A-Z0-9]', '', 'g') = 'AKDSFFVS';
END $$;

CREATE OR REPLACE FUNCTION public.user_can_access_space(
  _user_id uuid,
  _space_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_main_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.spaces space
      WHERE space.id = _space_id
        AND space.key <> 'PER'
        AND (
          (space.type = 'personal' AND space.owner_id = _user_id)
          OR (space.type = 'shared' AND public.has_role(_user_id, 'admin'))
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.space_members member
      WHERE member.space_id = _space_id AND member.user_id = _user_id
    );
$$;

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
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks task
    JOIN public.spaces space ON space.id = task.space_id
    WHERE task.id = _task_id
      AND (
        public.is_main_admin(_user_id)
        OR task.assignee_id = _user_id
        OR task.supervisor_id = _user_id
        OR task.created_by_id = _user_id
        OR public.user_is_mentioned_in_task(_user_id, task.id)
        OR (space.key <> 'PER' AND task.approver_id = _user_id)
        OR (space.key <> 'PER' AND public.user_can_access_space(_user_id, task.space_id))
        OR (space.key <> 'PER' AND space.type = 'shared' AND public.has_role(_user_id, 'admin'))
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_space(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_task(uuid, uuid) TO authenticated;
