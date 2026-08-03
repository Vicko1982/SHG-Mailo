// Edge function: admin-create-user
// Creates a new auth user (with profile + role). Allowed only when:
//  - No admin/main_admin exists yet (bootstrap → first user becomes main_admin), OR
//  - The caller is authenticated and has the 'admin' or 'main_admin' role.
// Admin and main_admin can create users and admins.
// Existing Main Admins may create additional Main Admins. Victor remains permanent.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Role = "main_admin" | "admin" | "user";

interface Payload {
  email: string;
  password?: string;
  full_name: string;
  role: Role;
  voice_names?: string[];
  aliases?: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Bootstrap check: any admin/main_admin exists?
    const { count: adminCount, error: cErr } = await admin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .in("role", ["admin", "main_admin"]);
    if (cErr) throw cErr;

    let callerRole: Role | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: u } = await userClient.auth.getUser(token);
      if (u?.user) {
        const { data: roles } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", u.user.id);
        if (roles?.some((r) => r.role === "main_admin")) callerRole = "main_admin";
        else if (roles?.some((r) => r.role === "admin")) callerRole = "admin";
      }
    }

    const isBootstrap = (adminCount ?? 0) === 0;
    if (!isBootstrap && !callerRole) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as Payload;
    if (!body.email || !body.full_name || !body.role) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["main_admin", "admin", "user"].includes(body.role)) {
      return new Response(JSON.stringify({ error: "Invalid role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The bootstrap account is the permanent Main Admin. Afterwards only an
    // existing Main Admin may create another Main Admin.
    let finalRole: Role = body.role;
    if (isBootstrap) {
      finalRole = "main_admin";
    } else if (body.role === "main_admin" && callerRole !== "main_admin") {
      return new Response(
        JSON.stringify({ error: "Only a Main Admin can create another Main Admin" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password || `${crypto.randomUUID()}Aa1!`,
      email_confirm: true,
      user_metadata: { full_name: body.full_name },
    });
    // Synchronization is idempotent: if Auth already knows this email, reuse
    // that account and repair its profile/role instead of creating a duplicate.
    if (createErr || !created.user) {
      const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw listError;
      const existing = existingUsers.users.find((user) =>
        String(user.email || "").toLocaleLowerCase() === body.email.trim().toLocaleLowerCase()
      );
      if (existing) created = { user: existing };
    }
    if (!created.user) {
      return new Response(
        JSON.stringify({ error: createErr?.message ?? "Create failed" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userId = created.user.id;

    // handle_new_user trigger already inserts profile + role.
    // Ensure profile fields are correct.
    await admin.from("profiles").upsert({
      id: userId,
      full_name: body.full_name,
      email: body.email,
      voice_names: Array.isArray(body.voice_names) ? body.voice_names : [],
      aliases: Array.isArray(body.aliases) ? body.aliases : [],
    });

    // Reset roles to the requested one
    await admin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: userId, role: finalRole });
    if (roleErr) {
      return new Response(JSON.stringify({ error: roleErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, user_id: userId, role: finalRole, bootstrap: isBootstrap }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
