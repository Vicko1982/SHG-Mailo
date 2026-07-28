-- Align database access with the SHG Task Manager permissions used by the
-- local 219 interface. These helpers are SECURITY DEFINER so task/comment
-- policies can inspect mentions without recursive RLS evaluation.

CREATE OR REPLACE FUNCTION public.user_is_mentioned_in_task(
  _user_id uuid,
  _task_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.task_comments comment
    JOIN public.profiles profile ON profile.id = _user_id
    WHERE comment.task_id = _task_id
      AND comment.content ILIKE '%@' || profile.full_name || '%'
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_task(
  _user_id uuid,
  _task_id uuid
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
    JOIN public.spaces space ON space.id = task.space_id
    WHERE task.id = _task_id
      AND (
        public.is_main_admin(_user_id)
        OR task.assignee_id = _user_id
        OR task.supervisor_id = _user_id
        OR task.approver_id = _user_id
        OR task.created_by_id = _user_id
        OR public.user_can_access_space(_user_id, task.space_id)
        OR public.user_is_mentioned_in_task(_user_id, task.id)
        OR (
          space.type = 'shared'
          AND public.has_role(_user_id, 'admin')
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_space(
  _user_id uuid,
  _space_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_main_admin(_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.spaces space
      WHERE space.id = _space_id
        AND (
          (space.type = 'personal' AND space.owner_id = _user_id)
          OR (
            space.type = 'shared'
            AND public.has_role(_user_id, 'admin')
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.space_members member
      WHERE member.space_id = _space_id
        AND member.user_id = _user_id
    );
$$;

GRANT EXECUTE ON FUNCTION public.user_is_mentioned_in_task(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_task(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_space(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Spaces viewable by those with access" ON public.spaces;
CREATE POLICY "Spaces viewable by those with access"
ON public.spaces FOR SELECT
TO authenticated
USING (
  type = 'shared'
  OR public.is_main_admin(auth.uid())
  OR owner_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.tasks task
    WHERE task.space_id = spaces.id
      AND public.user_can_access_task(auth.uid(), task.id)
  )
);

DROP POLICY IF EXISTS "Tasks viewable by those with task access" ON public.tasks;
CREATE POLICY "Tasks viewable by those with task access"
ON public.tasks FOR SELECT
TO authenticated
USING (public.user_can_access_task(auth.uid(), id));

DROP POLICY IF EXISTS "Tasks insertable by space members" ON public.tasks;
CREATE POLICY "Tasks insertable by authenticated users"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (
  public.is_main_admin(auth.uid())
  OR created_by_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.spaces space
    WHERE space.id = space_id
      AND (
        space.type = 'shared'
        OR (space.type = 'personal' AND space.owner_id = auth.uid())
      )
  )
);

DROP POLICY IF EXISTS "Tasks updatable by those with task access" ON public.tasks;
CREATE POLICY "Tasks updatable by those with task access"
ON public.tasks FOR UPDATE
TO authenticated
USING (public.user_can_access_task(auth.uid(), id))
WITH CHECK (public.user_can_access_task(auth.uid(), id));

DROP POLICY IF EXISTS "Tasks deletable by main admin or supervisor" ON public.tasks;
CREATE POLICY "Tasks deletable by authorized managers"
ON public.tasks FOR DELETE
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR approver_id = auth.uid()
  OR (
    EXISTS (
      SELECT 1
      FROM public.spaces space
      WHERE space.id = space_id
        AND space.type = 'shared'
    )
    AND public.has_role(auth.uid(), 'admin')
  )
);

DROP POLICY IF EXISTS "Task comments viewable by task accessors" ON public.task_comments;
CREATE POLICY "Task comments viewable by task accessors"
ON public.task_comments FOR SELECT
TO authenticated
USING (public.user_can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "Task comments insertable by task accessors" ON public.task_comments;
CREATE POLICY "Task comments insertable by task accessors"
ON public.task_comments FOR INSERT
TO authenticated
WITH CHECK (public.user_can_access_task(auth.uid(), task_id));

DROP POLICY IF EXISTS "Task comments editable by author or main admin" ON public.task_comments;
CREATE POLICY "Task comments editable by author or administrators"
ON public.task_comments FOR UPDATE
TO authenticated
USING (
  author_id = auth.uid()
  OR public.is_main_admin(auth.uid())
  OR public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  author_id = auth.uid()
  OR public.is_main_admin(auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Task comments deletable by author or main admin" ON public.task_comments;
CREATE POLICY "Task comments deletable by author or administrators"
ON public.task_comments FOR DELETE
TO authenticated
USING (
  author_id = auth.uid()
  OR public.is_main_admin(auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);
