ALTER TABLE public.mention_email_queue
  ADD COLUMN IF NOT EXISTS notification_type TEXT NOT NULL DEFAULT 'mention'
  CHECK (notification_type IN ('mention', 'task_created'));

UPDATE public.spaces
SET key = 'LCO', updated_at = now()
WHERE key = 'LEG'
  AND NOT EXISTS (SELECT 1 FROM public.spaces WHERE key = 'LCO');

UPDATE public.tasks
SET
  task_key = regexp_replace(task_key, '^LEG-', 'LCO-'),
  legacy_data = CASE
    WHEN legacy_data IS NULL THEN NULL
    ELSE jsonb_set(
      jsonb_set(legacy_data, '{id}', to_jsonb(regexp_replace(COALESCE(legacy_data->>'id', task_key), '^LEG-', 'LCO-'))),
      '{project}',
      '"LCO"'::jsonb
    )
  END,
  updated_at = now()
WHERE task_key LIKE 'LEG-%';
