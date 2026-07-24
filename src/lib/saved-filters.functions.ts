import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SavedFilter = {
  id: string;
  name: string;
  filter_data: any;
  updated_at: string;
};

export const listSavedFilters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("saved_filters")
      .select("id, name, filter_data, updated_at")
      .eq("user_id", context.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as SavedFilter[];
  });

export const saveFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; filter_data: any }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("saved_filters")
      .insert({ user_id: context.userId, name: data.name.trim(), filter_data: data.filter_data })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteSavedFilter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("saved_filters").delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
