-- Shared-space keys are always generated from the name and contain 3 letters.
CREATE OR REPLACE FUNCTION public.shared_space_key(_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  words text[];
  result text;
BEGIN
  words := regexp_split_to_array(
    trim(regexp_replace(COALESCE(_name, ''), '[^[:alnum:][:space:]]+', ' ', 'g')),
    '\s+'
  );
  IF COALESCE(array_length(words, 1), 0) <= 1 THEN
    result := left(COALESCE(words[1], ''), 3);
  ELSIF array_length(words, 1) = 2 THEN
    result := left(words[1], 1) || left(words[2], 2);
  ELSE
    result := left(words[1], 1) || left(words[2], 1) || left(words[3], 1);
  END IF;
  RETURN upper(rpad(result, 3, 'X'));
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_shared_space_key()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  desired_key text;
BEGIN
  IF NEW.type = 'shared' THEN
    desired_key := public.shared_space_key(NEW.name);
    IF TG_OP = 'UPDATE' AND OLD.key IS DISTINCT FROM desired_key THEN
      UPDATE public.tasks
      SET task_key = desired_key
        || '-'
        || substring(task_key FROM char_length(OLD.key) + 2)
      WHERE space_id = OLD.id;
    END IF;
    NEW.key := desired_key;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_shared_space_key_before_write ON public.spaces;
CREATE TRIGGER enforce_shared_space_key_before_write
BEFORE INSERT OR UPDATE OF name, key, type ON public.spaces
FOR EACH ROW
EXECUTE FUNCTION public.enforce_shared_space_key();

-- Update task keys before replacing the keys of existing shared spaces.
UPDATE public.tasks t
SET task_key = public.shared_space_key(s.name)
  || '-'
  || substring(t.task_key FROM char_length(s.key) + 2)
FROM public.spaces s
WHERE t.space_id = s.id
  AND s.type = 'shared'
  AND s.key IS DISTINCT FROM public.shared_space_key(s.name);

UPDATE public.spaces
SET key = public.shared_space_key(name)
WHERE type = 'shared'
  AND key IS DISTINCT FROM public.shared_space_key(name);
