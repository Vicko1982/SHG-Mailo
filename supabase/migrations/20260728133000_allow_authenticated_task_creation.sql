-- Every authenticated SHG user may create a task in any selectable space.
-- A direct creator policy also guarantees that PostgREST can return the newly
-- inserted row immediately, without depending on relationship checks.

DROP POLICY IF EXISTS "Tasks insertable by authenticated users" ON public.tasks;
DROP POLICY IF EXISTS "Tasks insertable by space members" ON public.tasks;
CREATE POLICY "Tasks insertable by authenticated users"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND created_by_id = auth.uid()
);

DROP POLICY IF EXISTS "Task creators can view own tasks" ON public.tasks;
CREATE POLICY "Task creators can view own tasks"
ON public.tasks FOR SELECT
TO authenticated
USING (created_by_id = auth.uid());
