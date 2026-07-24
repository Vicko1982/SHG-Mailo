
-- Allow admin role (in addition to main_admin) to manage spaces and members
DROP POLICY IF EXISTS "Spaces manageable by main admin or personal owner" ON public.spaces;
CREATE POLICY "Spaces manageable by admins or personal owner"
  ON public.spaces
  TO authenticated
  USING (
    public.is_main_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR (type = 'personal' AND owner_id = auth.uid())
  )
  WITH CHECK (
    public.is_main_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR (type = 'personal' AND owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Space members manageable by main admin" ON public.space_members;
CREATE POLICY "Space members manageable by admins"
  ON public.space_members
  TO authenticated
  USING (public.is_main_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.is_main_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'));
