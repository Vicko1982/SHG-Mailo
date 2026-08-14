-- Keep standard-user reads non-recursive. All relationship checks happen in
-- SECURITY DEFINER helpers, so RLS policies never query another RLS-protected
-- table directly.

CREATE OR REPLACE FUNCTION public.user_has_task_in_space(
  _user_id uuid,
  _space_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks task
    WHERE task.space_id = _space_id
      AND (
        task.assignee_id = _user_id
        OR task.supervisor_id = _user_id
        OR task.approver_id = _user_id
        OR task.created_by_id = _user_id
        OR public.user_is_mentioned_in_task(_user_id, task.id)
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_has_task_in_space(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Spaces viewable by those with access" ON public.spaces;
CREATE POLICY "Spaces viewable by those with access"
ON public.spaces FOR SELECT
TO authenticated
USING (
  type = 'shared'
  OR public.is_main_admin(auth.uid())
  OR owner_id = auth.uid()
  OR public.user_has_task_in_space(auth.uid(), id)
);

DROP POLICY IF EXISTS "Space members viewable by those with space access" ON public.space_members;
DROP POLICY IF EXISTS "Space members viewable by main admin or space member" ON public.space_members;
CREATE POLICY "Space members viewable by those with space access"
ON public.space_members FOR SELECT
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR user_id = auth.uid()
  OR public.user_can_access_space(auth.uid(), space_id)
);

DROP POLICY IF EXISTS "Task status history viewable by task accessors" ON public.task_status_history;
CREATE POLICY "Task status history viewable by task accessors"
ON public.task_status_history FOR SELECT
TO authenticated
USING (public.user_can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "Activity log viewable by main admin or related task accessors" ON public.activity_log;
CREATE POLICY "Activity log viewable by task accessors"
ON public.activity_log FOR SELECT
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR public.has_role(auth.uid(), 'admin')
  OR task_id IS NULL
  OR public.user_can_access_task(auth.uid(), task_id)
);
