-- There can be only one permanent Main Admin account in the application.
-- The role-management edge function prevents changing or reassigning it;
-- this database constraint prevents a second assignment at storage level.
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_single_main_admin
ON public.user_roles (role)
WHERE role = 'main_admin';
