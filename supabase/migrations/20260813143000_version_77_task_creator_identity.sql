-- MAILO Version 77: keep Task creation bound to the authenticated account,
-- while allowing a database-verified Main Admin to create a shared Task via
-- View As. Every on-behalf-of creation/change is recorded in the Task audit.

CREATE OR REPLACE FUNCTION public.enforce_task_creator_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_name text;
  creator_name text;
  current_space_key text;
  current_space_type text;
  actor_may_represent_others boolean := FALSE;
  creator_changed boolean := FALSE;
  audit_message text;
BEGIN
  -- Service-role migrations/imports do not have an authenticated browser
  -- identity and retain their explicitly supplied ownership information.
  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT profile.full_name
  INTO actor_name
  FROM public.profiles profile
  WHERE profile.id = actor_id
    AND profile.is_active IS DISTINCT FROM FALSE;

  IF actor_name IS NULL THEN
    RAISE EXCEPTION 'The authenticated Task creator is inactive or missing';
  END IF;

  SELECT space.key, space.type
  INTO current_space_key, current_space_type
  FROM public.spaces space
  WHERE space.id = NEW.space_id;

  -- The Version 76 Personal owner trigger is stricter and remains the only
  -- authority for central/per-user Personal Tasks.
  IF current_space_key = 'PER' OR current_space_type = 'personal' THEN
    RETURN NEW;
  END IF;

  actor_may_represent_others := public.is_main_admin(actor_id)
    OR public.is_victor_stavropoulos(actor_id);

  IF TG_OP = 'INSERT' THEN
    NEW.created_by_id := COALESCE(NEW.created_by_id, actor_id);
    creator_changed := NEW.created_by_id IS DISTINCT FROM actor_id;
  ELSE
    creator_changed := NEW.created_by_id IS DISTINCT FROM OLD.created_by_id;
  END IF;

  IF creator_changed AND NOT actor_may_represent_others THEN
    RAISE EXCEPTION 'Only a Main Admin can create or reassign a Task for another user';
  END IF;

  -- Some imported historical shared Tasks legitimately predate creator UUIDs.
  -- An ordinary edit may preserve that NULL, but it may not introduce it.
  IF TG_OP = 'UPDATE'
    AND NOT creator_changed
    AND NEW.created_by_id IS NULL THEN
    NEW.legacy_data := COALESCE(NEW.legacy_data, '{}'::jsonb)
      || jsonb_build_object(
        'creator', COALESCE(
          NULLIF(NEW.legacy_data->>'creator', ''),
          NULLIF(OLD.legacy_data->>'creator', ''),
          'Unknown'
        )
      );
    RETURN NEW;
  END IF;

  SELECT profile.full_name
  INTO creator_name
  FROM public.profiles profile
  WHERE profile.id = NEW.created_by_id
    AND profile.is_active IS DISTINCT FROM FALSE;

  IF creator_name IS NULL THEN
    RAISE EXCEPTION 'The selected Task creator is inactive or missing';
  END IF;

  -- Creator is display metadata as well as an access relationship. Keep the
  -- JSON value canonical instead of trusting an arbitrary browser string.
  NEW.legacy_data := COALESCE(NEW.legacy_data, '{}'::jsonb)
    || jsonb_build_object('creator', creator_name);

  IF TG_OP = 'INSERT' AND NEW.created_by_id IS DISTINCT FROM actor_id THEN
    audit_message := format(
      'Task created for %s by %s via View As',
      creator_name,
      actor_name
    );
  ELSIF TG_OP = 'UPDATE' AND creator_changed THEN
    audit_message := format(
      'Creator changed from %s to %s by %s (Main Admin)',
      COALESCE((SELECT full_name FROM public.profiles WHERE id = OLD.created_by_id), 'Unknown'),
      creator_name,
      actor_name
    );
  END IF;

  IF audit_message IS NOT NULL THEN
    NEW.audit := COALESCE(NEW.audit, '[]'::jsonb)
      || jsonb_build_array(audit_message);
    NEW.legacy_data := NEW.legacy_data
      || jsonb_build_object(
        'creatorActor', actor_name,
        'creatorActorId', actor_id,
        'creatorRecordedAt', now()
      );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_task_creator_identity_before_write
  ON public.tasks;
CREATE TRIGGER validate_task_creator_identity_before_write
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_task_creator_identity();

-- A Main Admin may use the explicit View As feature for a shared Task. The
-- trigger above validates the target profile and writes the real actor to the
-- audit. Personal Tasks remain excluded and are still owned only under the
-- Version 76 Personal privacy rules.
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
          AND space.key <> 'PER'
          AND space.type = 'shared'
      )
    )
  )
);
