import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ActivityFilters = {
  userId?: string;
  action?: string;
  from?: string; // ISO
  to?: string;   // ISO
  search?: string;
  page?: number;
  pageSize?: number;
};

export const listActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((f: ActivityFilters) => f)
  .handler(async ({ data, context }) => {
    // Admin/main_admin gate
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    const { data: isMain } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "main_admin",
    });
    if (!isAdmin && !isMain) throw new Error("Forbidden");

    const { userId, action, from, to, search, page = 1, pageSize = 50 } = data;
    let q = context.supabase
      .from("activity_log")
      .select("id, action, created_at, task_id, task_title, metadata, user:profiles!activity_log_user_id_fkey(id, full_name, email)",
        { count: "exact" });
    if (userId) q = q.eq("user_id", userId);
    if (action) q = q.eq("action", action);
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    if (search?.trim()) {
      const s = search.trim().replace(/[%_]/g, "\\$&");
      q = q.or(`action.ilike.%${s}%,task_title.ilike.%${s}%`);
    }
    const fromR = (page - 1) * pageSize;
    q = q.order("created_at", { ascending: false }).range(fromR, fromR + pageSize - 1);
    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0, page, pageSize };
  });

export const listActionTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("activity_log").select("action").limit(500);
    if (error) throw new Error(error.message);
    return Array.from(new Set((data ?? []).map((r) => r.action))).sort();
  });
