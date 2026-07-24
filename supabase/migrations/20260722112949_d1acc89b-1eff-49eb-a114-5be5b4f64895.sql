GRANT EXECUTE ON FUNCTION public.user_can_access_space(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_main_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

DROP POLICY "Tasks viewable by those with task access" ON public.tasks;
CREATE POLICY "Tasks viewable by those with task access"
ON public.tasks FOR SELECT
USING (
  public.is_main_admin(auth.uid())
  OR assignee_id = auth.uid()
  OR supervisor_id = auth.uid()
  OR public.user_can_access_space(auth.uid(), space_id)
);

DROP POLICY "Task comments viewable by task accessors" ON public.task_comments;
CREATE POLICY "Task comments viewable by task accessors"
ON public.task_comments FOR SELECT
USING (
  public.is_main_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_comments.task_id
      AND (
        t.assignee_id = auth.uid()
        OR t.supervisor_id = auth.uid()
        OR public.user_can_access_space(auth.uid(), t.space_id)
      )
  )
);