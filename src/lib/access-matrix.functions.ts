import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(context: { supabase: any; userId: string }) {
  const [{ data: isMain }, { data: isAdmin }] = await Promise.all([
    context.supabase.rpc("is_main_admin", { _user_id: context.userId }),
    context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
  ]);
  if (!isMain && !isAdmin) throw new Error("Forbidden");
}

export const getAccessMatrix = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const [usersRes, spacesRes, membersRes] = await Promise.all([
      context.supabase.from("profiles").select("id, full_name, email, is_active").order("full_name"),
      context.supabase.from("spaces").select("id, key, name, color, type, owner_id").order("type").order("name"),
      context.supabase.from("space_members").select("space_id, user_id"),
    ]);
    if (usersRes.error) throw new Error(usersRes.error.message);
    if (spacesRes.error) throw new Error(spacesRes.error.message);
    if (membersRes.error) throw new Error(membersRes.error.message);
    return {
      users: usersRes.data ?? [],
      spaces: spacesRes.data ?? [],
      members: membersRes.data ?? [],
    };
  });

export const setSpaceMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { space_id: string; user_id: string; enabled: boolean }) => d)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (data.enabled) {
      const { error } = await context.supabase
        .from("space_members")
        .upsert({ space_id: data.space_id, user_id: data.user_id }, { onConflict: "space_id,user_id" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("space_members").delete()
        .eq("space_id", data.space_id).eq("user_id", data.user_id);
      if (error) throw new Error(error.message);
    }
    await context.supabase.from("activity_log").insert({
      user_id: context.userId,
      action: data.enabled ? "space_member_add" : "space_member_remove",
      metadata: { space_id: data.space_id, target_user_id: data.user_id },
    });
    return { ok: true };
  });
