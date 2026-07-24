-- Allocate an additional trailing asterisk whenever personal-space initials
-- are already in use: VS*, VS**, VS***, and so on.
CREATE OR REPLACE FUNCTION public.next_personal_space_key(
  _full_name text,
  _exclude_space_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parts text[];
  base_key text;
  candidate text;
  star_count integer := 1;
BEGIN
  parts := regexp_split_to_array(trim(COALESCE(_full_name, '')), '\s+');
  base_key := upper(
    COALESCE(left(parts[1], 1), 'P')
    || CASE WHEN array_length(parts, 1) > 1
      THEN left(parts[array_length(parts, 1)], 1)
      ELSE ''
    END
  );
  candidate := base_key || '*';
  WHILE EXISTS (
    SELECT 1
    FROM public.spaces
    WHERE key = candidate
      AND (_exclude_space_id IS NULL OR id <> _exclude_space_id)
  ) LOOP
    star_count := star_count + 1;
    candidate := base_key || repeat('*', star_count);
  END LOOP;
  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_personal_space_for_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  personal_space public.spaces%ROWTYPE;
  desired_key text;
BEGIN
  SELECT *
  INTO personal_space
  FROM public.spaces
  WHERE type = 'personal' AND owner_id = NEW.id
  LIMIT 1;

  desired_key := public.next_personal_space_key(NEW.full_name, personal_space.id);

  IF personal_space.id IS NULL THEN
    INSERT INTO public.spaces (key, name, type, owner_id)
    VALUES (
      desired_key,
      public.personal_space_name(NEW.full_name),
      'personal',
      NEW.id
    );
  ELSE
    IF personal_space.key IS DISTINCT FROM desired_key THEN
      UPDATE public.tasks
      SET task_key = desired_key
        || '-'
        || substring(task_key FROM char_length(personal_space.key) + 2)
      WHERE space_id = personal_space.id;
    END IF;

    UPDATE public.spaces
    SET
      name = public.personal_space_name(NEW.full_name),
      key = desired_key
    WHERE id = personal_space.id;
  END IF;
  RETURN NEW;
END;
$$;
