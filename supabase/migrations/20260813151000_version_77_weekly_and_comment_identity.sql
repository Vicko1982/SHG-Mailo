-- MAILO Version 77: enforce Weekly Task and Comment identity rules at the
-- database boundary. UI controls are convenience; these rules are authority.

CREATE OR REPLACE FUNCTION public.enforce_weekly_task_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_name text;
  old_assignments jsonb := COALESCE(OLD.legacy_data->'weeklyAssignments', '{}'::jsonb);
  new_assignments jsonb := COALESCE(NEW.legacy_data->'weeklyAssignments', '{}'::jsonb);
  old_others jsonb;
  new_others jsonb;
BEGIN
  IF actor_id IS NULL OR old_assignments = new_assignments THEN
    RETURN NEW;
  END IF;

  IF public.is_main_admin(actor_id)
    OR public.is_victor_stavropoulos(actor_id) THEN
    RETURN NEW;
  END IF;

  -- Completion removes the Task from every Weekly list automatically.
  IF NEW.status = 'done' AND new_assignments = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  SELECT profile.full_name
  INTO actor_name
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

  -- A normal user may add a Task to their own Weekly list exactly once, but
  -- cannot remove or rewrite that assignment manually afterward.
  IF old_assignments ? actor_name
    OR NOT (new_assignments ? actor_name) THEN
    RAISE EXCEPTION 'Only a Main Admin can remove or edit a Weekly Task assignment';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_weekly_task_permissions_before_update
  ON public.tasks;
CREATE TRIGGER enforce_weekly_task_permissions_before_update
BEFORE UPDATE OF legacy_data, status ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_weekly_task_permissions();

CREATE OR REPLACE FUNCTION public.enforce_task_comment_author_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.author_id := auth.uid();
  ELSE
    NEW.author_id := OLD.author_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_task_comment_author_identity_before_write
  ON public.task_comments;
CREATE TRIGGER enforce_task_comment_author_identity_before_write
BEFORE INSERT OR UPDATE ON public.task_comments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_task_comment_author_identity();

DROP POLICY IF EXISTS "Task comments insertable by task accessors"
  ON public.task_comments;
CREATE POLICY "Task comments insertable by task accessors"
ON public.task_comments FOR INSERT
TO authenticated
WITH CHECK (
  author_id = auth.uid()
  AND public.user_can_access_task(auth.uid(), task_id)
);

