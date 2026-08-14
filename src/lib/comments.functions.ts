import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("task_comments")
      .select("id, content, created_at, updated_at, author:profiles!task_comments_author_id_fkey(id, full_name)")
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; content: string }) => d)
  .handler(async ({ data, context }) => {
    if (!data.content.trim()) throw new Error("Empty comment");
    const { data: inserted, error } = await context.supabase
      .from("task_comments")
      .insert({ task_id: data.taskId, content: data.content, author_id: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const { data: t } = await context.supabase
      .from("tasks").select("title").eq("id", data.taskId).maybeSingle();
    await context.supabase.from("activity_log").insert({
      user_id: context.userId,
      action: "task_comment",
      task_id: data.taskId,
      task_title: t?.title ?? null,
    });
    const { data: notification, error: notificationError } = await context.supabase.functions.invoke(
      "send-mention-email",
      { body: { taskId: data.taskId, commentId: inserted.id } },
    );
    return {
      ok: true,
      notification: notificationError
        ? { sent: 0, failed: 0, error: notificationError.message }
        : notification,
    };
  });
