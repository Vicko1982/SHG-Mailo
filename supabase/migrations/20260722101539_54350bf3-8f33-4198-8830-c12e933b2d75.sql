REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_main_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_can_access_space(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_main_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.user_can_access_space(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;