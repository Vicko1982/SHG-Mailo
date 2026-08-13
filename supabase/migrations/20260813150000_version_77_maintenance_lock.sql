-- MAILO Version 77: a real maintenance lock for safe production upgrades.
-- The public site shows a maintenance screen while this flag also prevents
-- already-open browser tabs from changing shared data mid-deployment.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_message text NOT NULL
    DEFAULT 'MAILO is being upgraded. Please try again in a few minutes.',
  ADD COLUMN IF NOT EXISTS minimum_client_version integer NOT NULL DEFAULT 77;

CREATE OR REPLACE FUNCTION public.reject_mailo_writes_during_maintenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  maintenance_enabled boolean := false;
  current_message text;
  required_client_version integer := 77;
  supplied_client_version integer := 0;
  request_headers jsonb := '{}'::jsonb;
BEGIN
  SELECT settings.maintenance_mode, settings.maintenance_message,
    settings.minimum_client_version
  INTO maintenance_enabled, current_message, required_client_version
  FROM public.app_settings settings
  WHERE settings.id = true;

  -- SQL migrations, service-role integrations and scheduled backend work do
  -- not carry the authenticated browser role and continue to operate safely.
  IF auth.role() = 'authenticated' THEN
    BEGIN
      request_headers := COALESCE(
        NULLIF(current_setting('request.headers', true), '')::jsonb,
        '{}'::jsonb
      );
    EXCEPTION WHEN OTHERS THEN
      request_headers := '{}'::jsonb;
    END;
    IF COALESCE(request_headers->>'x-mailo-version', '') ~ '^[0-9]+$' THEN
      supplied_client_version := (request_headers->>'x-mailo-version')::integer;
    END IF;

    IF maintenance_enabled THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = COALESCE(
          NULLIF(current_message, ''),
          'MAILO is being upgraded. Please try again in a few minutes.'
        );
    END IF;

    IF supplied_client_version < COALESCE(required_client_version, 77) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'MAILO was upgraded. Please refresh the page before continuing.';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profiles',
    'user_roles',
    'spaces',
    'space_folders',
    'space_folder_assignments',
    'space_members',
    'tasks',
    'task_comments',
    'task_status_history',
    'task_status_events',
    'task_last_checks',
    'activity_log',
    'notifications',
    'mention_email_queue',
    'task_automation_deliveries',
    'user_preferences',
    'saved_filters',
    'password_reset_requests',
    'voice_task_drafts',
    'voice_shortcut_requests',
    'voice_realtime_usage',
    'voice_device_tokens',
    'mailo_owner_lock'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS mailo_maintenance_write_lock ON public.%I',
        table_name
      );
      EXECUTE format(
        'CREATE TRIGGER mailo_maintenance_write_lock '
        'BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.reject_mailo_writes_during_maintenance()',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_mailo_maintenance(
  enabled boolean,
  message text DEFAULT 'MAILO is being upgraded. Please try again in a few minutes.'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND NOT public.is_victor_stavropoulos(auth.uid()) THEN
    RAISE EXCEPTION 'Only Victor can change MAILO maintenance mode';
  END IF;

  UPDATE public.app_settings
  SET maintenance_mode = COALESCE(enabled, false),
      maintenance_message = COALESCE(
        NULLIF(message, ''),
        'MAILO is being upgraded. Please try again in a few minutes.'
      ),
      updated_at = now(),
      updated_by = auth.uid()
  WHERE id = true;
END;
$$;

REVOKE ALL ON FUNCTION public.set_mailo_maintenance(boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_mailo_maintenance(boolean, text)
  TO authenticated, service_role;
