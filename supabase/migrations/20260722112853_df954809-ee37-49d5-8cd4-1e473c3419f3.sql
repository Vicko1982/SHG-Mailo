DROP POLICY "Space members viewable by main admin or space member" ON public.space_members;
CREATE POLICY "Space members viewable by those with space access"
ON public.space_members FOR SELECT
USING (public.is_main_admin(auth.uid()) OR user_id = auth.uid() OR public.user_can_access_space(auth.uid(), space_id));

DROP POLICY "Spaces viewable by those with access" ON public.spaces;
CREATE POLICY "Spaces viewable by those with access"
ON public.spaces FOR SELECT
USING (public.user_can_access_space(auth.uid(), id));