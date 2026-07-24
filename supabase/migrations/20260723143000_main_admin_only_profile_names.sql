-- User display names are managed centrally by the single Main Admin.
CREATE OR REPLACE FUNCTION public.protect_profile_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name
     AND NOT public.is_main_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only the Main Admin can rename users';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_name_before_update ON public.profiles;
CREATE TRIGGER protect_profile_name_before_update
BEFORE UPDATE OF full_name ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_name();
