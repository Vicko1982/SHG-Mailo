-- MAILO Version 76: enforce Personal Task privacy in the database and move
-- per-user stars out of shared Task metadata.

-- Victor's authority is bound to one immutable user UUID. Looking up the
-- owner by a mutable profile email would allow the authority to be moved to a
-- different account by renaming two profiles.
CREATE TABLE IF NOT EXISTS public.mailo_owner_lock (
  singleton boolean PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  user_id uuid UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  canonical_email text NOT NULL DEFAULT 'victor@shd.global'
    CHECK (lower(canonical_email) = 'victor@shd.global'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mailo_owner_lock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mailo_owner_lock FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mailo_owner_lock TO service_role;

DO $$
DECLARE
  canonical_count integer;
  locked_user_id uuid;
BEGIN
  SELECT count(*)
  INTO canonical_count
  FROM public.profiles
  WHERE lower(email) = 'victor@shd.global';

  IF canonical_count > 1 THEN
    RAISE EXCEPTION 'More than one profile uses the permanent MAILO owner email';
  END IF;

  SELECT id INTO locked_user_id
  FROM public.profiles
  WHERE lower(email) = 'victor@shd.global'
  LIMIT 1;

  IF locked_user_id IS NOT NULL THEN
    INSERT INTO public.mailo_owner_lock (singleton, user_id, canonical_email)
    VALUES (TRUE, locked_user_id, 'victor@shd.global')
    ON CONFLICT (singleton) DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.mailo_owner_lock owner_lock
    JOIN public.profiles profile ON profile.id = owner_lock.user_id
    WHERE owner_lock.singleton
      AND lower(profile.email) <> owner_lock.canonical_email
  ) THEN
    RAISE EXCEPTION 'The permanent MAILO owner lock does not match the canonical profile email';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_victor_stavropoulos(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mailo_owner_lock owner_lock
    WHERE owner_lock.singleton AND owner_lock.user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_victor_stavropoulos(uuid) TO authenticated;

-- The canonical email cannot be removed from Victor, assigned to another
-- profile/Auth account, or deleted. In a new empty installation the first
-- canonical profile safely claims the still-empty owner lock.
CREATE OR REPLACE FUNCTION public.protect_mailo_owner_profile_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  locked_user_id uuid;
BEGIN
  SELECT user_id INTO locked_user_id
  FROM public.mailo_owner_lock
  WHERE singleton;

  IF TG_OP = 'DELETE' THEN
    IF OLD.id = locked_user_id THEN
      RAISE EXCEPTION 'Victor Stavropoulos is the permanent MAILO owner';
    END IF;
    RETURN OLD;
  END IF;

  IF locked_user_id IS NOT NULL
    AND lower(COALESCE(NEW.email, '')) = 'victor@shd.global'
    AND NEW.id IS DISTINCT FROM locked_user_id THEN
    RAISE EXCEPTION 'The permanent MAILO owner email cannot be transferred';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.id = locked_user_id
    AND lower(COALESCE(NEW.email, '')) <> 'victor@shd.global' THEN
    RAISE EXCEPTION 'The permanent MAILO owner email cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_mailo_owner_profile_identity_before_write
  ON public.profiles;
CREATE TRIGGER protect_mailo_owner_profile_identity_before_write
BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_mailo_owner_profile_identity();

CREATE OR REPLACE FUNCTION public.register_mailo_owner_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF lower(COALESCE(NEW.email, '')) = 'victor@shd.global' THEN
    INSERT INTO public.mailo_owner_lock (singleton, user_id, canonical_email)
    VALUES (TRUE, NEW.id, 'victor@shd.global')
    ON CONFLICT (singleton) DO NOTHING;

    IF NOT public.is_victor_stavropoulos(NEW.id) THEN
      RAISE EXCEPTION 'The permanent MAILO owner email is already registered';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzzz_register_mailo_owner_profile_after_write
  ON public.profiles;
CREATE TRIGGER zzzz_register_mailo_owner_profile_after_write
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.register_mailo_owner_profile();

CREATE OR REPLACE FUNCTION public.protect_mailo_owner_auth_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  locked_user_id uuid;
BEGIN
  SELECT user_id INTO locked_user_id
  FROM public.mailo_owner_lock
  WHERE singleton;

  IF TG_OP = 'DELETE' THEN
    IF OLD.id = locked_user_id THEN
      RAISE EXCEPTION 'Victor Stavropoulos is the permanent MAILO owner';
    END IF;
    RETURN OLD;
  END IF;

  IF locked_user_id IS NOT NULL
    AND lower(COALESCE(NEW.email, '')) = 'victor@shd.global'
    AND NEW.id IS DISTINCT FROM locked_user_id THEN
    RAISE EXCEPTION 'The permanent MAILO owner email cannot be transferred';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.id = locked_user_id
    AND lower(COALESCE(NEW.email, '')) <> 'victor@shd.global' THEN
    RAISE EXCEPTION 'The permanent MAILO owner email cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_mailo_owner_auth_identity_before_write
  ON auth.users;
CREATE TRIGGER protect_mailo_owner_auth_identity_before_write
BEFORE INSERT OR UPDATE OR DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.protect_mailo_owner_auth_identity();

-- Replace the legacy email-based role guard with the immutable owner UUID and
-- disallow extra non-Main-Admin roles for that permanent account.
CREATE OR REPLACE FUNCTION public.protect_permanent_main_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.is_victor_stavropoulos(OLD.user_id)
      AND OLD.role = 'main_admin'::public.app_role THEN
      RAISE EXCEPTION 'Victor Stavropoulos must always remain a Main Admin';
    END IF;
    RETURN OLD;
  END IF;

  IF public.is_victor_stavropoulos(NEW.user_id)
    AND NEW.role IS DISTINCT FROM 'main_admin'::public.app_role THEN
    RAISE EXCEPTION 'Victor Stavropoulos must always remain a Main Admin';
  END IF;

  IF TG_OP = 'UPDATE'
    AND public.is_victor_stavropoulos(OLD.user_id)
    AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'The permanent MAILO owner role cannot be transferred';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_permanent_main_admin_trigger ON public.user_roles;
CREATE TRIGGER protect_permanent_main_admin_trigger
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.protect_permanent_main_admin();

-- Version 63 introduced Archive in the UI; Version 76 aligns the database
-- constraint so a legitimate Archive transition is not rejected.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS valid_status;
ALTER TABLE public.tasks
  ADD CONSTRAINT valid_status
  CHECK (status IN (
    'backlog', 'todo', 'progress', 'pause', 'blocked', 'review', 'done',
    'cancelled', 'archive'
  ));

-- No producer may enqueue email for a Personal Task. A BEFORE trigger on the
-- queue is deliberately centralised so comments, assignment changes, scheduled
-- jobs and future producers all obey the same privacy boundary.
CREATE OR REPLACE FUNCTION public.prevent_personal_task_email_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.task_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.tasks task
    JOIN public.spaces space ON space.id = task.space_id
    WHERE task.id = NEW.task_id
      AND (space.key = 'PER' OR space.type = 'personal')
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_personal_task_email_queue_before_write
  ON public.mention_email_queue;
CREATE TRIGGER prevent_personal_task_email_queue_before_write
BEFORE INSERT OR UPDATE OF task_id ON public.mention_email_queue
FOR EACH ROW
EXECUTE FUNCTION public.prevent_personal_task_email_queue();

-- This operation controls roles, permissions and all shared-space membership.
-- Even another Main Admin must not be able to call it directly.
CREATE OR REPLACE FUNCTION public.save_user_settings(
  admin_user_ids uuid[],
  selected_approver_id uuid,
  shared_space_access jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  space_key text;
  selected_space_id uuid;
BEGIN
  IF NOT public.is_victor_stavropoulos(auth.uid()) THEN
    RAISE EXCEPTION 'Only Victor Stavropoulos can save user settings';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = selected_approver_id AND is_active IS DISTINCT FROM FALSE
  ) THEN
    RAISE EXCEPTION 'A single active Approver is required';
  END IF;

  DELETE FROM public.user_roles WHERE role <> 'main_admin';
  INSERT INTO public.user_roles (user_id, role)
  SELECT profile.id,
    CASE
      WHEN profile.id = ANY(COALESCE(admin_user_ids, ARRAY[]::uuid[]))
        THEN 'admin'::public.app_role
      ELSE 'user'::public.app_role
    END
  FROM public.profiles profile
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles existing
    WHERE existing.user_id = profile.id AND existing.role = 'main_admin'
  );

  DELETE FROM public.space_members member
  USING public.spaces space
  WHERE member.space_id = space.id
    AND space.type = 'shared'
    AND space.key <> 'PER';

  FOR space_key IN SELECT jsonb_object_keys(COALESCE(shared_space_access, '{}'::jsonb))
  LOOP
    SELECT id INTO selected_space_id
    FROM public.spaces
    WHERE key = space_key
      AND type = 'shared'
      AND key <> 'PER'
    LIMIT 1;

    IF selected_space_id IS NOT NULL THEN
      INSERT INTO public.space_members (space_id, user_id)
      SELECT selected_space_id, value::uuid
      FROM jsonb_array_elements_text(shared_space_access -> space_key) value
      JOIN public.profiles ON profiles.id = value::uuid
      ON CONFLICT (space_id, user_id) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO public.app_settings (id, current_approver_id, updated_at, updated_by)
  VALUES (TRUE, selected_approver_id, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE SET
    current_approver_id = EXCLUDED.current_approver_id,
    updated_at = EXCLUDED.updated_at,
    updated_by = EXCLUDED.updated_by;

  -- Personal Approver IDs are immutable owner IDs and must not be replaced by
  -- the application-wide default Approver.
  UPDATE public.tasks task
  SET approver_id = selected_approver_id, updated_at = now()
  FROM public.spaces space
  WHERE task.space_id = space.id
    AND space.key <> 'PER'
    AND space.type <> 'personal'
    AND task.approver_id IS DISTINCT FROM selected_approver_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_user_settings(uuid[], uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_user_settings(uuid[], uuid, jsonb) TO authenticated;

-- Close direct-table bypasses around the Victor-only permission actions.
DROP POLICY IF EXISTS "Only main admin can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only Victor can manage roles" ON public.user_roles;
CREATE POLICY "Only Victor can manage roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.is_victor_stavropoulos(auth.uid()))
WITH CHECK (public.is_victor_stavropoulos(auth.uid()));

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Only Victor can update profiles" ON public.profiles;
CREATE POLICY "Only Victor can update profiles"
ON public.profiles FOR UPDATE
TO authenticated
USING (public.is_victor_stavropoulos(auth.uid()))
WITH CHECK (public.is_victor_stavropoulos(auth.uid()));

-- A central PER Task uses created_by_id as its immutable owner; a legacy
-- type='personal' Task uses spaces.owner_id. Refuse to migrate ambiguous data
-- rather than silently leaving a Personal Task outside the privacy lock.
DO $$
DECLARE
  unresolved_spaces text;
  unresolved_tasks text;
BEGIN
  SELECT string_agg(space.key, ', ' ORDER BY space.key)
  INTO unresolved_spaces
  FROM public.spaces space
  LEFT JOIN public.profiles owner_profile ON owner_profile.id = space.owner_id
  WHERE space.type = 'personal'
    AND (space.owner_id IS NULL OR owner_profile.id IS NULL);

  IF unresolved_spaces IS NOT NULL THEN
    RAISE EXCEPTION 'Personal spaces require a valid owner before Version 76: %', unresolved_spaces;
  END IF;

  WITH personal_tasks AS (
    SELECT
      task.task_key,
      CASE
        WHEN space.type = 'personal' THEN space.owner_id
        ELSE COALESCE(
          (
            SELECT profile.id
            FROM public.profiles profile
            WHERE lower(profile.full_name) = lower(task.legacy_data->>'personalOwner')
            ORDER BY profile.id
            LIMIT 1
          ),
          task.created_by_id,
          (
            SELECT profile.id
            FROM public.profiles profile
            WHERE lower(profile.full_name) = lower(task.legacy_data->>'creator')
            ORDER BY profile.id
            LIMIT 1
          ),
          task.assignee_id,
          task.supervisor_id,
          task.approver_id,
          (SELECT user_id FROM public.mailo_owner_lock WHERE singleton)
        )
      END AS owner_id
    FROM public.tasks task
    JOIN public.spaces space ON space.id = task.space_id
    WHERE space.key = 'PER' OR space.type = 'personal'
  )
  SELECT string_agg(personal_tasks.task_key, ', ' ORDER BY personal_tasks.task_key)
  INTO unresolved_tasks
  FROM personal_tasks
  LEFT JOIN public.profiles owner_profile ON owner_profile.id = personal_tasks.owner_id
  WHERE personal_tasks.owner_id IS NULL OR owner_profile.id IS NULL;

  IF unresolved_tasks IS NOT NULL THEN
    RAISE EXCEPTION 'Personal Tasks require a resolvable owner before Version 76: %', unresolved_tasks;
  END IF;
END;
$$;

WITH personal_tasks AS (
  SELECT
    task.id,
    CASE
      WHEN space.type = 'personal' THEN space.owner_id
      ELSE COALESCE(
        (
          SELECT profile.id
          FROM public.profiles profile
          WHERE lower(profile.full_name) = lower(task.legacy_data->>'personalOwner')
          ORDER BY profile.id
          LIMIT 1
        ),
        task.created_by_id,
        (
          SELECT profile.id
          FROM public.profiles profile
          WHERE lower(profile.full_name) = lower(task.legacy_data->>'creator')
          ORDER BY profile.id
          LIMIT 1
        ),
        task.assignee_id,
        task.supervisor_id,
        task.approver_id,
        (SELECT user_id FROM public.mailo_owner_lock WHERE singleton)
      )
    END AS owner_id
  FROM public.tasks task
  JOIN public.spaces space ON space.id = task.space_id
  WHERE space.key = 'PER' OR space.type = 'personal'
), owners AS (
  SELECT personal_tasks.id, personal_tasks.owner_id, profile.full_name
  FROM personal_tasks
  JOIN public.profiles profile ON profile.id = personal_tasks.owner_id
)
UPDATE public.tasks task
SET created_by_id = owners.owner_id,
    assignee_id = owners.owner_id,
    supervisor_id = owners.owner_id,
    approver_id = owners.owner_id,
    disable_main_admin_reminders = TRUE,
    legacy_data = COALESCE(task.legacy_data, '{}'::jsonb)
      || jsonb_build_object(
        'personalOwner', owners.full_name,
        'creator', owners.full_name,
        'assignee', owners.full_name,
        'supervisor', owners.full_name,
        'approver', owners.full_name,
        'personalAccessLocked', TRUE,
        'disableMainAdminReminders', TRUE
      )
FROM owners
WHERE task.id = owners.id;

-- Remove any legacy space-membership path into Personal spaces. Task access is
-- determined exclusively by the immutable owner above (plus Victor).
DELETE FROM public.space_members member
USING public.spaces space
WHERE member.space_id = space.id
  AND (space.key = 'PER' OR space.type = 'personal');

CREATE OR REPLACE FUNCTION public.enforce_personal_task_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_space_key text;
  current_space_type text;
  current_space_owner_id uuid;
  was_personal boolean := FALSE;
  owner_id uuid;
  owner_name text;
BEGIN
  SELECT space.key, space.type, space.owner_id
  INTO current_space_key, current_space_type, current_space_owner_id
  FROM public.spaces space
  WHERE space.id = NEW.space_id;

  IF TG_OP = 'UPDATE' THEN
    SELECT (space.key = 'PER' OR space.type = 'personal')
    INTO was_personal
    FROM public.spaces space
    WHERE space.id = OLD.space_id;
  END IF;

  IF current_space_key IS DISTINCT FROM 'PER'
    AND current_space_type IS DISTINCT FROM 'personal' THEN
    RETURN NEW;
  END IF;

  IF current_space_type = 'personal' THEN
    owner_id := current_space_owner_id;
  ELSIF TG_OP = 'UPDATE' AND COALESCE(was_personal, FALSE) THEN
    owner_id := OLD.created_by_id;
  ELSIF public.is_victor_stavropoulos(auth.uid()) THEN
    owner_id := COALESCE(NEW.created_by_id, auth.uid());
  ELSE
    owner_id := auth.uid();
  END IF;

  -- Service-role maintenance has no auth.uid(); retain the supplied owner for
  -- central PER in that case, but never allow any ownerless Personal Task.
  owner_id := COALESCE(owner_id, NEW.created_by_id);
  IF owner_id IS NULL AND TG_OP = 'UPDATE' THEN
    owner_id := OLD.created_by_id;
  END IF;
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'A Personal Task requires an owner';
  END IF;

  SELECT profile.full_name INTO owner_name
  FROM public.profiles profile
  WHERE profile.id = owner_id;

  IF owner_name IS NULL THEN
    RAISE EXCEPTION 'The Personal Task owner does not exist';
  END IF;

  NEW.created_by_id := owner_id;
  NEW.assignee_id := owner_id;
  NEW.supervisor_id := owner_id;
  NEW.approver_id := owner_id;
  NEW.disable_main_admin_reminders := TRUE;
  NEW.legacy_data := COALESCE(NEW.legacy_data, '{}'::jsonb)
    || jsonb_build_object(
      'personalOwner', owner_name,
      'creator', owner_name,
      'assignee', owner_name,
      'supervisor', owner_name,
      'approver', owner_name,
      'personalAccessLocked', TRUE,
      'disableMainAdminReminders', TRUE
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_personal_task_owner_before_write ON public.tasks;
CREATE TRIGGER enforce_personal_task_owner_before_write
BEFORE INSERT OR UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_personal_task_owner();

-- Retain the existing Approver protection, while permitting the mandatory
-- owner lock when a user moves an editable Task into their own Personal space.
CREATE OR REPLACE FUNCTION public.enforce_task_approver_and_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_owner_personal_transition boolean := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT (
      (space.key = 'PER' OR space.type = 'personal')
      AND NEW.created_by_id = auth.uid()
      AND NEW.approver_id = auth.uid()
    )
    INTO is_owner_personal_transition
    FROM public.spaces space
    WHERE space.id = NEW.space_id;

    IF NEW.approver_id IS DISTINCT FROM OLD.approver_id
      AND auth.uid() IS NOT NULL
      AND NOT public.is_main_admin(auth.uid())
      AND NOT COALESCE(is_owner_personal_transition, FALSE) THEN
      RAISE EXCEPTION 'Only a Main Admin can change the Approver';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_changed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Changing hierarchy is an edit to both the child and its future parent. Task
-- read access alone is not sufficient for a direct parent_id API update.
CREATE OR REPLACE FUNCTION public.enforce_task_parent_authorization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid := auth.uid();
  actor_is_manager boolean;
BEGIN
  IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id OR actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  actor_is_manager := public.is_victor_stavropoulos(actor_id)
    OR public.is_main_admin(actor_id)
    OR public.has_role(actor_id, 'admin');

  IF NOT actor_is_manager AND OLD.approver_id IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION 'Only an authorized Task editor can change its Parent Task';
  END IF;

  IF NEW.parent_id IS NOT NULL
    AND NOT actor_is_manager
    AND NOT EXISTS (
      SELECT 1 FROM public.tasks parent
      WHERE parent.id = NEW.parent_id AND parent.approver_id = actor_id
    )
  THEN
    RAISE EXCEPTION 'Editing the Parent Task is also required';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_task_parent_authorization_before_update
  ON public.tasks;
CREATE TRIGGER enforce_task_parent_authorization_before_update
BEFORE UPDATE OF parent_id ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_task_parent_authorization();

-- Personal Tasks are private to their actual owner and Victor. Role,
-- Approver and historical mention access applies only to non-Personal Tasks.
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
  ) AND EXISTS (
      SELECT 1
      FROM public.tasks task
      JOIN public.spaces space ON space.id = task.space_id
      WHERE task.id = _task_id
        AND CASE
          WHEN space.key = 'PER' THEN
            task.created_by_id = _user_id
            OR public.is_victor_stavropoulos(_user_id)
          WHEN space.type = 'personal' THEN
            space.owner_id = _user_id
            OR public.is_victor_stavropoulos(_user_id)
          ELSE
            public.is_main_admin(_user_id)
            OR task.assignee_id = _user_id
            OR task.supervisor_id = _user_id
            OR task.approver_id = _user_id
            OR task.created_by_id = _user_id
            OR public.user_can_access_space(_user_id, task.space_id)
            OR public.user_is_mentioned_in_task(_user_id, task.id)
            OR public.has_role(_user_id, 'admin')
        END
    );
$$;

GRANT EXECUTE ON FUNCTION public.user_can_access_task(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Spaces viewable by those with access" ON public.spaces;
CREATE POLICY "Spaces viewable by those with access"
ON public.spaces FOR SELECT
TO authenticated
USING (
  type = 'shared'
  OR owner_id = auth.uid()
  OR public.is_victor_stavropoulos(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.tasks task
    WHERE task.space_id = spaces.id
      AND public.user_can_access_task(auth.uid(), task.id)
  )
);

DROP POLICY IF EXISTS "Spaces manageable by main admin or personal owner" ON public.spaces;
DROP POLICY IF EXISTS "Spaces manageable by admins or personal owner" ON public.spaces;
DROP POLICY IF EXISTS "Spaces manageable by role and type" ON public.spaces;
DROP POLICY IF EXISTS "Spaces manageable under Personal privacy" ON public.spaces;
CREATE POLICY "Spaces manageable under Personal privacy"
ON public.spaces FOR ALL
TO authenticated
USING (
  public.is_victor_stavropoulos(auth.uid())
  OR (type = 'personal' AND owner_id = auth.uid())
  OR (
    type = 'shared'
    AND key <> 'PER'
    AND (
      public.is_main_admin(auth.uid())
      OR public.has_role(auth.uid(), 'admin')
    )
  )
)
WITH CHECK (
  public.is_victor_stavropoulos(auth.uid())
  OR (type = 'personal' AND owner_id = auth.uid())
  OR (
    type = 'shared'
    AND key <> 'PER'
    AND (
      public.is_main_admin(auth.uid())
      OR public.has_role(auth.uid(), 'admin')
    )
  )
);

-- Remove the legacy OR-policy which bypassed user_can_access_task for a Task's
-- creator. Shared creators remain covered by user_can_access_task; Personal
-- Tasks must use the stricter owner/Victor rule.
DROP POLICY IF EXISTS "Task creators can view own tasks" ON public.tasks;

DROP POLICY IF EXISTS "Tasks insertable by authenticated users" ON public.tasks;
CREATE POLICY "Tasks insertable by authenticated users"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    created_by_id = auth.uid()
    OR public.is_victor_stavropoulos(auth.uid())
  )
);

DROP POLICY IF EXISTS "Space members viewable by those with space access" ON public.space_members;
DROP POLICY IF EXISTS "Space members viewable by main admin or space member" ON public.space_members;
DROP POLICY IF EXISTS "Space members manageable by admins" ON public.space_members;
DROP POLICY IF EXISTS "Space members manageable for shared spaces" ON public.space_members;
CREATE POLICY "Space members viewable for shared spaces"
ON public.space_members FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.spaces space
    WHERE space.id = space_id
      AND space.key <> 'PER'
      AND space.type = 'shared'
      AND public.user_can_access_space(auth.uid(), space.id)
  )
);

CREATE POLICY "Space members manageable for shared spaces"
ON public.space_members FOR ALL
TO authenticated
USING (
  public.is_victor_stavropoulos(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.spaces space
    WHERE space.id = space_id AND space.key <> 'PER' AND space.type = 'shared'
  )
)
WITH CHECK (
  public.is_victor_stavropoulos(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.spaces space
    WHERE space.id = space_id AND space.key <> 'PER' AND space.type = 'shared'
  )
);

-- Do not leak Personal Task titles or history through auxiliary tables.
DROP POLICY IF EXISTS "Admins can view all activity log" ON public.activity_log;
DROP POLICY IF EXISTS "Activity log viewable by main admin or related task accessors" ON public.activity_log;
DROP POLICY IF EXISTS "Activity log viewable by task accessors" ON public.activity_log;
CREATE POLICY "Activity log viewable by task accessors"
ON public.activity_log FOR SELECT
TO authenticated
USING (
  (
    task_id IS NULL
    AND (
      COALESCE(task_title, '') = ''
      OR user_id = auth.uid()
      OR public.is_victor_stavropoulos(auth.uid())
    )
  )
  OR public.user_can_access_task(auth.uid(), task_id)
);

DROP POLICY IF EXISTS "Task status history viewable by task accessors" ON public.task_status_history;
CREATE POLICY "Task status history viewable by task accessors"
ON public.task_status_history FOR SELECT
TO authenticated
USING (public.user_can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "Main Admin manages own task checks" ON public.task_last_checks;
DROP POLICY IF EXISTS "Task checks managed by accessible Main Admin" ON public.task_last_checks;
CREATE POLICY "Task checks managed by accessible Main Admin"
ON public.task_last_checks FOR ALL
TO authenticated
USING (
  main_admin_id = auth.uid()
  AND public.is_main_admin(auth.uid())
  AND public.user_can_access_task(auth.uid(), task_id)
)
WITH CHECK (
  main_admin_id = auth.uid()
  AND public.is_main_admin(auth.uid())
  AND public.user_can_access_task(auth.uid(), task_id)
);

DROP POLICY IF EXISTS "Authenticated users read task status events" ON public.task_status_events;
DROP POLICY IF EXISTS "Task status events viewable by task accessors" ON public.task_status_events;
CREATE POLICY "Task status events viewable by task accessors"
ON public.task_status_events FOR SELECT
TO authenticated
USING (public.user_can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "Tasks deletable by authorized managers" ON public.tasks;
CREATE POLICY "Tasks deletable by authorized managers"
ON public.tasks FOR DELETE
TO authenticated
USING (
  public.is_victor_stavropoulos(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.spaces space
    WHERE space.id = space_id
      AND (
        (space.key = 'PER' AND created_by_id = auth.uid())
        OR (space.type = 'personal' AND space.owner_id = auth.uid())
        OR (
          space.key <> 'PER'
          AND space.type <> 'personal'
          AND (
            public.is_main_admin(auth.uid())
            OR approver_id = auth.uid()
            OR public.has_role(auth.uid(), 'admin')
          )
        )
      )
  )
);

-- Comment mutation must also satisfy Task access. This prevents an Admin from
-- changing a Personal comment by addressing its UUID directly.
DROP POLICY IF EXISTS "Task comments editable by author or administrators" ON public.task_comments;
DROP POLICY IF EXISTS "Task comments editable by author or main admin" ON public.task_comments;
DROP POLICY IF EXISTS "Task comments editable by author or Victor" ON public.task_comments;
CREATE POLICY "Task comments editable by author or Victor"
ON public.task_comments FOR UPDATE
TO authenticated
USING (
  public.user_can_access_task(auth.uid(), task_id)
  AND (author_id = auth.uid() OR public.is_victor_stavropoulos(auth.uid()))
)
WITH CHECK (
  public.user_can_access_task(auth.uid(), task_id)
  AND (author_id = auth.uid() OR public.is_victor_stavropoulos(auth.uid()))
);

DROP POLICY IF EXISTS "Task comments deletable by author or administrators" ON public.task_comments;
DROP POLICY IF EXISTS "Task comments deletable by author or main admin" ON public.task_comments;
DROP POLICY IF EXISTS "Task comments deletable by main admin" ON public.task_comments;
DROP POLICY IF EXISTS "Task comments deletable by authorized users" ON public.task_comments;
CREATE POLICY "Task comments deletable by authorized users"
ON public.task_comments FOR DELETE
TO authenticated
USING (
  public.user_can_access_task(auth.uid(), task_id)
  AND (
    author_id = auth.uid()
    OR public.is_victor_stavropoulos(auth.uid())
    OR public.is_main_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  )
);

-- Migrate already saved stars into each user's RLS-private preferences before
-- removing them from shared tasks.legacy_data.
INSERT INTO public.user_preferences (user_id, preferences)
SELECT
  profile.id,
  jsonb_build_object(
    'mailo_starred_tasks',
    jsonb_object_agg(task.id::text, star.value)
  )
FROM public.tasks task
CROSS JOIN LATERAL jsonb_each(
  CASE
    WHEN jsonb_typeof(task.legacy_data->'starredBy') = 'object'
      THEN task.legacy_data->'starredBy'
    ELSE '{}'::jsonb
  END
) star
JOIN public.profiles profile ON lower(profile.full_name) = lower(star.key)
WHERE jsonb_typeof(star.value) = 'boolean'
  AND star.value = 'true'::jsonb
GROUP BY profile.id
ON CONFLICT (user_id) DO UPDATE
SET preferences = jsonb_set(
      CASE
        WHEN jsonb_typeof(public.user_preferences.preferences) = 'object'
          THEN public.user_preferences.preferences
        ELSE '{}'::jsonb
      END,
      '{mailo_starred_tasks}',
      CASE
        WHEN jsonb_typeof(public.user_preferences.preferences->'mailo_starred_tasks') = 'object'
          THEN public.user_preferences.preferences->'mailo_starred_tasks'
        ELSE '{}'::jsonb
      END
        || COALESCE(EXCLUDED.preferences->'mailo_starred_tasks', '{}'::jsonb),
      TRUE
    ),
    updated_at = now();

UPDATE public.tasks
SET legacy_data = legacy_data - 'starredBy'
WHERE legacy_data ? 'starredBy';

-- Purge queued-but-unsent messages created before this migration. Sent mail
-- cannot be recalled, but no pending/retrying/processing/failed payload or
-- comment text remains eligible for delivery.
DELETE FROM public.mention_email_queue queue
USING public.tasks task, public.spaces space
WHERE queue.task_id = task.id
  AND task.space_id = space.id
  AND (space.key = 'PER' OR space.type = 'personal')
  AND queue.status <> 'sent';

-- When an existing shared Task is moved into Personal, immediately remove any
-- still-unsent queue entries that were created while it was shared.
CREATE OR REPLACE FUNCTION public.cleanup_personal_task_email_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.spaces space
    WHERE space.id = NEW.space_id
      AND (space.key = 'PER' OR space.type = 'personal')
  ) THEN
    DELETE FROM public.mention_email_queue
    WHERE task_id = NEW.id AND status <> 'sent';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zzzz_cleanup_personal_task_email_queue_after_write
  ON public.tasks;
CREATE TRIGGER zzzz_cleanup_personal_task_email_queue_after_write
AFTER INSERT OR UPDATE OF space_id ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_personal_task_email_queue();

CREATE OR REPLACE FUNCTION public.set_task_star(
  _task_id uuid,
  _starred boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  current_preferences jsonb;
  updated_preferences jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF NOT public.user_can_access_task(auth.uid(), _task_id) THEN
    RAISE EXCEPTION 'Task access is required';
  END IF;

  INSERT INTO public.user_preferences (user_id, preferences)
  VALUES (auth.uid(), '{}'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT CASE
    WHEN jsonb_typeof(preferences) = 'object' THEN preferences
    ELSE '{}'::jsonb
  END
  INTO current_preferences
  FROM public.user_preferences
  WHERE user_id = auth.uid()
  FOR UPDATE;

  current_preferences := jsonb_set(
    current_preferences,
    '{mailo_starred_tasks}',
    CASE
      WHEN jsonb_typeof(current_preferences->'mailo_starred_tasks') = 'object'
        THEN current_preferences->'mailo_starred_tasks'
      ELSE '{}'::jsonb
    END,
    TRUE
  );

  IF _starred THEN
    updated_preferences := jsonb_set(
      current_preferences,
      ARRAY['mailo_starred_tasks', _task_id::text],
      to_jsonb(now()::text),
      TRUE
    );
  ELSE
    updated_preferences := current_preferences
      #- ARRAY['mailo_starred_tasks', _task_id::text];
  END IF;

  UPDATE public.user_preferences
  SET preferences = updated_preferences,
      updated_at = now()
  WHERE user_id = auth.uid();

  RETURN updated_preferences;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_task_star(uuid, boolean) TO authenticated;
