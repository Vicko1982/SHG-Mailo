-- Every user receives one private personal space named:
-- first name + first letter of the last name (for example "Victor S").
CREATE OR REPLACE FUNCTION public.personal_space_name(_full_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH parts AS (
    SELECT regexp_split_to_array(trim(COALESCE(_full_name, '')), '\s+') AS value
  )
  SELECT CASE
    WHEN COALESCE(array_length(value, 1), 0) = 0 THEN 'Personal'
    WHEN array_length(value, 1) = 1 THEN value[1]
    ELSE value[1] || ' ' || left(value[array_length(value, 1)], 1)
  END
  FROM parts;
$$;

CREATE OR REPLACE FUNCTION public.personal_space_key(_full_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH parts AS (
    SELECT regexp_split_to_array(trim(COALESCE(_full_name, '')), '\s+') AS value
  )
  SELECT upper(
    COALESCE(left(value[1], 1), 'P')
    || CASE
      WHEN COALESCE(array_length(value, 1), 0) > 1
        THEN left(value[array_length(value, 1)], 1)
      ELSE ''
    END
    || '*'
  )
  FROM parts;
$$;

CREATE OR REPLACE FUNCTION public.ensure_personal_space_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.spaces
    WHERE type = 'personal' AND owner_id = NEW.id
  ) THEN
    INSERT INTO public.spaces (key, name, type, owner_id)
    VALUES (
      public.personal_space_key(NEW.full_name),
      public.personal_space_name(NEW.full_name),
      'personal',
      NEW.id
    );
  ELSE
    UPDATE public.tasks t
    SET task_key = public.personal_space_key(NEW.full_name)
      || '-'
      || substring(t.task_key FROM char_length(s.key) + 2)
    FROM public.spaces s
    WHERE t.space_id = s.id
      AND s.type = 'personal'
      AND s.owner_id = NEW.id
      AND s.key IS DISTINCT FROM public.personal_space_key(NEW.full_name);

    UPDATE public.spaces
    SET
      name = public.personal_space_name(NEW.full_name),
      key = public.personal_space_key(NEW.full_name)
    WHERE type = 'personal' AND owner_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_personal_space_after_profile_insert ON public.profiles;
CREATE TRIGGER ensure_personal_space_after_profile_insert
AFTER INSERT OR UPDATE OF full_name ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.ensure_personal_space_for_profile();

-- Create a personal space for every existing user who does not have one.
INSERT INTO public.spaces (key, name, type, owner_id)
SELECT
  public.personal_space_key(p.full_name),
  public.personal_space_name(p.full_name),
  'personal',
  p.id
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.spaces s
  WHERE s.type = 'personal' AND s.owner_id = p.id
);

-- Apply the new key to tasks before changing the key of existing spaces.
UPDATE public.tasks t
SET task_key = public.personal_space_key(p.full_name)
  || '-'
  || substring(t.task_key FROM char_length(s.key) + 2)
FROM public.spaces s
JOIN public.profiles p ON p.id = s.owner_id
WHERE t.space_id = s.id
  AND s.type = 'personal'
  AND s.key IS DISTINCT FROM public.personal_space_key(p.full_name);

-- Apply the new naming and key rules to all existing personal spaces.
UPDATE public.spaces s
SET
  name = public.personal_space_name(p.full_name),
  key = public.personal_space_key(p.full_name)
FROM public.profiles p
WHERE s.type = 'personal'
  AND s.owner_id = p.id;

-- Personal spaces never have members: access is granted only to their owner
-- and to the single Main Admin through user_can_access_space().
DELETE FROM public.space_members sm
USING public.spaces s
WHERE sm.space_id = s.id
  AND s.type = 'personal';

CREATE OR REPLACE FUNCTION public.prevent_personal_space_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.spaces
    WHERE id = NEW.space_id AND type = 'personal'
  ) THEN
    RAISE EXCEPTION 'Personal spaces cannot have members';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_personal_space_members_before_write ON public.space_members;
CREATE TRIGGER prevent_personal_space_members_before_write
BEFORE INSERT OR UPDATE ON public.space_members
FOR EACH ROW
EXECUTE FUNCTION public.prevent_personal_space_members();

-- Administrators manage shared spaces only. Personal spaces remain manageable
-- exclusively by their owner and the Main Admin.
DROP POLICY IF EXISTS "Spaces manageable by admins or personal owner" ON public.spaces;
CREATE POLICY "Spaces manageable by role and type"
  ON public.spaces
  TO authenticated
  USING (
    public.is_main_admin(auth.uid())
    OR (type = 'shared' AND public.has_role(auth.uid(), 'admin'))
    OR (type = 'personal' AND owner_id = auth.uid())
  )
  WITH CHECK (
    public.is_main_admin(auth.uid())
    OR (type = 'shared' AND public.has_role(auth.uid(), 'admin'))
    OR (type = 'personal' AND owner_id = auth.uid())
  );
