
-- 1. Add email column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- 2. Replace disabled with is_active (BOQ convention)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
UPDATE public.profiles SET is_active = NOT disabled;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS disabled;

-- 3. Trigger to auto-create profile + role on new auth user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_any_user boolean;
  assigned_role app_role;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  SELECT EXISTS (SELECT 1 FROM public.user_roles) INTO has_any_user;
  assigned_role := CASE WHEN has_any_user THEN 'user'::app_role ELSE 'main_admin'::app_role END;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Add a broader activity_log SELECT policy for main_admins (already covered by is_main_admin OR)
--    but ensure admins can also see the full log
DROP POLICY IF EXISTS "Admins can view all activity log" ON public.activity_log;
CREATE POLICY "Admins can view all activity log"
ON public.activity_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.is_main_admin(auth.uid()));

-- 5. Allow authenticated users to INSERT their own activity entries
DROP POLICY IF EXISTS "Users insert own activity" ON public.activity_log;
CREATE POLICY "Users insert own activity"
ON public.activity_log
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
