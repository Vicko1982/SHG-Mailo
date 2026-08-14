ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS approver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_mini_task BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manual_order BIGINT,
  ADD COLUMN IF NOT EXISTS legacy_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.task_comments
  ADD COLUMN IF NOT EXISTS legacy_data JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.activity_log
  ADD COLUMN IF NOT EXISTS legacy_data JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS tasks_approver_id_idx
  ON public.tasks (approver_id);

CREATE INDEX IF NOT EXISTS tasks_parent_id_idx
  ON public.tasks (parent_id);

CREATE INDEX IF NOT EXISTS tasks_manual_order_idx
  ON public.tasks (manual_order);

