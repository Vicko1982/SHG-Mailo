-- MAILO Version 53 notification policy.
-- Human comments and @mentions are now Task Chat/browser notifications.
-- Login/security mail is owned by Auth. Assignment, responsibility, date and
-- unanswered-reminder emails remain in their dedicated workflows.

DROP TRIGGER IF EXISTS enqueue_human_comment_notifications_trigger
  ON public.task_comments;

CREATE OR REPLACE FUNCTION public.enqueue_human_comment_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_human_comment_notifications()
IS 'Version 53: comments and mentions are delivered by MAILO Task Chat, not email.';
