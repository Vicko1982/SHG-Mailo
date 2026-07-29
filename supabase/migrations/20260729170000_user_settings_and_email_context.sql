ALTER TABLE public.mention_email_queue
  ADD COLUMN IF NOT EXISTS recipient_context JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.app_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  current_approver_id UUID NOT NULL REFERENCES public.profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id)
);

INSERT INTO public.app_settings (id, current_approver_id)
SELECT true, id
FROM public.profiles
WHERE lower(full_name) = lower('Alexandros K')
LIMIT 1
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.app_settings TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.app_settings FROM anon, authenticated;

DROP POLICY IF EXISTS "Authenticated users can read app settings" ON public.app_settings;
CREATE POLICY "Authenticated users can read app settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.save_user_settings(
  admin_user_ids UUID[],
  selected_approver_id UUID,
  shared_space_access JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_role public.app_role;
  space_key TEXT;
  selected_space_id UUID;
BEGIN
  SELECT role INTO current_user_role
  FROM public.user_roles
  WHERE user_id = auth.uid() AND role = 'main_admin'
  LIMIT 1;

  IF current_user_role IS DISTINCT FROM 'main_admin'::public.app_role THEN
    RAISE EXCEPTION 'Only the Main Admin can save user settings';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = selected_approver_id AND is_active IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'A single active Approver is required';
  END IF;

  DELETE FROM public.user_roles WHERE role <> 'main_admin';
  INSERT INTO public.user_roles (user_id, role)
  SELECT
    profile.id,
    CASE
      WHEN profile.id = ANY(COALESCE(admin_user_ids, ARRAY[]::UUID[]))
        THEN 'admin'::public.app_role
      ELSE 'user'::public.app_role
    END
  FROM public.profiles AS profile
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles existing
    WHERE existing.user_id = profile.id AND existing.role = 'main_admin'
  );

  DELETE FROM public.space_members AS member
  USING public.spaces AS space
  WHERE member.space_id = space.id AND space.type = 'shared';

  FOR space_key IN SELECT jsonb_object_keys(COALESCE(shared_space_access, '{}'::jsonb))
  LOOP
    SELECT id INTO selected_space_id
    FROM public.spaces
    WHERE key = space_key AND type = 'shared'
    LIMIT 1;

    IF selected_space_id IS NOT NULL THEN
      INSERT INTO public.space_members (space_id, user_id)
      SELECT selected_space_id, value::UUID
      FROM jsonb_array_elements_text(shared_space_access -> space_key) AS value
      JOIN public.profiles ON profiles.id = value::UUID
      ON CONFLICT (space_id, user_id) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO public.app_settings (id, current_approver_id, updated_at, updated_by)
  VALUES (true, selected_approver_id, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE SET
    current_approver_id = EXCLUDED.current_approver_id,
    updated_at = EXCLUDED.updated_at,
    updated_by = EXCLUDED.updated_by;

  UPDATE public.tasks
  SET approver_id = selected_approver_id, updated_at = now()
  WHERE approver_id IS DISTINCT FROM selected_approver_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_user_settings(UUID[], UUID, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_user_settings(UUID[], UUID, JSONB)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_task_approver_and_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_approver UUID;
BEGIN
  SELECT current_approver_id INTO default_approver
  FROM public.app_settings
  WHERE id = true;

  IF default_approver IS NULL THEN
    SELECT id INTO default_approver
    FROM public.profiles
    WHERE lower(full_name) = lower('Alexandros K')
    LIMIT 1;
  END IF;

  NEW.approver_id := COALESCE(NEW.approver_id, default_approver);
  IF NEW.approver_id IS NULL THEN
    RAISE EXCEPTION 'Every task must have exactly one Approver';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.approver_id IS DISTINCT FROM OLD.approver_id
      AND auth.uid() IS NOT NULL
      AND NOT public.is_main_admin(auth.uid()) THEN
      RAISE EXCEPTION 'Only the Main Admin can change the Approver';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_changed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
