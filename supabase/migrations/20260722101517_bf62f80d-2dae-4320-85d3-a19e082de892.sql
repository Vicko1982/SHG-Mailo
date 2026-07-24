CREATE TYPE public.app_role AS ENUM ('main_admin', 'admin', 'user');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  initials TEXT,
  avatar_url TEXT,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

CREATE TABLE public.spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  type TEXT NOT NULL DEFAULT 'shared',
  owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_space_type CHECK (type IN ('shared', 'personal'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spaces TO authenticated;
GRANT ALL ON public.spaces TO service_role;

CREATE TABLE public.space_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  collapsed BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_folders TO authenticated;
GRANT ALL ON public.space_folders TO service_role;

CREATE TABLE public.space_folder_assignments (
  space_id UUID REFERENCES public.spaces(id) ON DELETE CASCADE NOT NULL,
  folder_id UUID REFERENCES public.space_folders(id) ON DELETE CASCADE NOT NULL,
  PRIMARY KEY (space_id, folder_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.space_folder_assignments TO authenticated;
GRANT ALL ON public.space_folder_assignments TO service_role;

CREATE TABLE public.space_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID REFERENCES public.spaces(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id)
);

GRANT SELECT ON public.space_members TO authenticated;
GRANT ALL ON public.space_members TO service_role;

CREATE TABLE public.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  space_id UUID REFERENCES public.spaces(id) ON DELETE RESTRICT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  jira_status TEXT,
  priority TEXT,
  assignee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  supervisor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  description TEXT,
  issue_type TEXT NOT NULL DEFAULT 'Task',
  parent_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date DATE,
  labels TEXT[] NOT NULL DEFAULT '{}',
  cancellation_reason TEXT,
  created_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  audit JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT valid_status CHECK (status IN ('backlog', 'todo', 'progress', 'pause', 'blocked', 'review', 'done', 'cancelled'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;

CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;

CREATE TABLE public.task_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  changed_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.task_status_history TO authenticated;
GRANT ALL ON public.task_status_history TO service_role;

CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  task_title TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

CREATE TABLE public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_preferences TO authenticated;
GRANT ALL ON public.user_preferences TO service_role;

CREATE TABLE public.saved_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  filter_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_filters TO authenticated;
GRANT ALL ON public.saved_filters TO service_role;

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

CREATE TABLE public.password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  requested_by_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.password_reset_requests TO authenticated;
GRANT ALL ON public.password_reset_requests TO service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_main_admin(_user_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'main_admin');
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_space(_user_id uuid, _space_id uuid)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_main_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM public.spaces s
      WHERE s.id = _space_id AND s.type = 'personal' AND s.owner_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.space_members sm
      WHERE sm.space_id = _space_id AND sm.user_id = _user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_folder_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by all authenticated users"
ON public.profiles FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY "Users can update own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id OR public.is_main_admin(auth.uid()))
WITH CHECK (auth.uid() = id OR public.is_main_admin(auth.uid()));

CREATE POLICY "Roles are viewable by all authenticated users"
ON public.user_roles FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY "Only main admin can manage roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.is_main_admin(auth.uid()))
WITH CHECK (public.is_main_admin(auth.uid()));

CREATE POLICY "Spaces viewable by those with access"
ON public.spaces FOR SELECT
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR (type = 'personal' AND owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.space_members sm
    WHERE sm.space_id = public.spaces.id AND sm.user_id = auth.uid()
  )
);

CREATE POLICY "Spaces manageable by main admin or personal owner"
ON public.spaces FOR ALL
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR (type = 'personal' AND owner_id = auth.uid())
)
WITH CHECK (
  public.is_main_admin(auth.uid())
  OR (type = 'personal' AND owner_id = auth.uid())
);

CREATE POLICY "Space folders viewable by authenticated users"
ON public.space_folders FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY "Space folders manageable by main admin"
ON public.space_folders FOR ALL
TO authenticated
USING (public.is_main_admin(auth.uid()))
WITH CHECK (public.is_main_admin(auth.uid()));

CREATE POLICY "Space folder assignments viewable by authenticated users"
ON public.space_folder_assignments FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY "Space folder assignments manageable by main admin"
ON public.space_folder_assignments FOR ALL
TO authenticated
USING (public.is_main_admin(auth.uid()))
WITH CHECK (public.is_main_admin(auth.uid()));

CREATE POLICY "Space members viewable by main admin or space member"
ON public.space_members FOR SELECT
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.space_members sm
    WHERE sm.space_id = public.space_members.space_id AND sm.user_id = auth.uid()
  )
);

CREATE POLICY "Space members manageable by main admin"
ON public.space_members FOR ALL
TO authenticated
USING (public.is_main_admin(auth.uid()))
WITH CHECK (public.is_main_admin(auth.uid()));

CREATE POLICY "Tasks viewable by those with task access"
ON public.tasks FOR SELECT
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR assignee_id = auth.uid()
  OR supervisor_id = auth.uid()
  OR public.user_can_access_space(auth.uid(), space_id)
  OR EXISTS (
    SELECT 1 FROM public.task_comments c
    WHERE c.task_id = public.tasks.id
    AND c.content ILIKE '%@' || COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), '') || '%'
  )
);

CREATE POLICY "Tasks insertable by space members"
ON public.tasks FOR INSERT
TO authenticated
WITH CHECK (
  public.is_main_admin(auth.uid())
  OR public.user_can_access_space(auth.uid(), space_id)
);

CREATE POLICY "Tasks updatable by those with task access"
ON public.tasks FOR UPDATE
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR assignee_id = auth.uid()
  OR supervisor_id = auth.uid()
  OR public.user_can_access_space(auth.uid(), space_id)
)
WITH CHECK (
  public.is_main_admin(auth.uid())
  OR assignee_id = auth.uid()
  OR supervisor_id = auth.uid()
  OR public.user_can_access_space(auth.uid(), space_id)
);

CREATE POLICY "Tasks deletable by main admin or supervisor"
ON public.tasks FOR DELETE
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR supervisor_id = auth.uid()
  OR created_by_id = auth.uid()
);

CREATE POLICY "Task comments viewable by task accessors"
ON public.task_comments FOR SELECT
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = public.task_comments.task_id
    AND (
      t.assignee_id = auth.uid()
      OR t.supervisor_id = auth.uid()
      OR public.user_can_access_space(auth.uid(), t.space_id)
      OR EXISTS (
        SELECT 1 FROM public.task_comments c
        WHERE c.task_id = t.id
        AND c.content ILIKE '%@' || COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), '') || '%'
      )
    )
  )
);

CREATE POLICY "Task comments insertable by task accessors"
ON public.task_comments FOR INSERT
TO authenticated
WITH CHECK (
  public.is_main_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = public.task_comments.task_id
    AND (
      t.assignee_id = auth.uid()
      OR t.supervisor_id = auth.uid()
      OR public.user_can_access_space(auth.uid(), t.space_id)
    )
  )
);

CREATE POLICY "Task comments editable by author or main admin"
ON public.task_comments FOR UPDATE
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR author_id = auth.uid()
)
WITH CHECK (
  public.is_main_admin(auth.uid())
  OR author_id = auth.uid()
);

CREATE POLICY "Task comments deletable by author or main admin"
ON public.task_comments FOR DELETE
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR author_id = auth.uid()
);

CREATE POLICY "Task status history viewable by task accessors"
ON public.task_status_history FOR SELECT
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = public.task_status_history.task_id
    AND (
      t.assignee_id = auth.uid()
      OR t.supervisor_id = auth.uid()
      OR public.user_can_access_space(auth.uid(), t.space_id)
      OR EXISTS (
        SELECT 1 FROM public.task_comments c
        WHERE c.task_id = t.id
        AND c.content ILIKE '%@' || COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), '') || '%'
      )
    )
  )
);

CREATE POLICY "Activity log viewable by main admin or related task accessors"
ON public.activity_log FOR SELECT
TO authenticated
USING (
  public.is_main_admin(auth.uid())
  OR task_id IS NULL
  OR EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = public.activity_log.task_id
    AND (
      t.assignee_id = auth.uid()
      OR t.supervisor_id = auth.uid()
      OR public.user_can_access_space(auth.uid(), t.space_id)
      OR EXISTS (
        SELECT 1 FROM public.task_comments c
        WHERE c.task_id = t.id
        AND c.content ILIKE '%@' || COALESCE((SELECT full_name FROM public.profiles WHERE id = auth.uid()), '') || '%'
      )
    )
  )
);

CREATE POLICY "User preferences are private"
ON public.user_preferences FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Saved filters are private"
ON public.saved_filters FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Notifications are private"
ON public.notifications FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Password reset requests viewable by main admin"
ON public.password_reset_requests FOR SELECT
TO authenticated
USING (public.is_main_admin(auth.uid()));

CREATE POLICY "Password reset requests insertable by main admin"
ON public.password_reset_requests FOR INSERT
TO authenticated
WITH CHECK (public.is_main_admin(auth.uid()));

CREATE POLICY "Password reset requests deletable by main admin"
ON public.password_reset_requests FOR DELETE
TO authenticated
USING (public.is_main_admin(auth.uid()));

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER spaces_updated_at BEFORE UPDATE ON public.spaces
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER space_folders_updated_at BEFORE UPDATE ON public.space_folders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER task_comments_updated_at BEFORE UPDATE ON public.task_comments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER user_preferences_updated_at BEFORE UPDATE ON public.user_preferences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER saved_filters_updated_at BEFORE UPDATE ON public.saved_filters
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();