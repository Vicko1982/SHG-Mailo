// Edge function: admin-create-user
// Creates a new auth user (with profile + role). Allowed only when:
//  - No admin/main_admin exists yet (bootstrap → first user becomes main_admin), OR
//  - The caller is authenticated and has the 'admin' or 'main_admin' role.
// Admin and main_admin can create users and admins.
// A second main_admin can never be created.
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
  password: string;
  full_name: string;
  role: Role;
}

function personalSpaceName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "Personal";
  return `${parts[0]} ${Array.from(parts[parts.length - 1])[0]}`;
}

function personalSpaceKeyBase(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstInitial = Array.from(parts[0] ?? "P")[0] ?? "P";
  const lastInitial = parts.length > 1
    ? (Array.from(parts[parts.length - 1])[0] ?? "")
    : "";
  return `${firstInitial}${lastInitial}`.toLocaleUpperCase();
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
    if (!body.email || !body.password || !body.full_name || !body.role) {
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

    // The bootstrap account is the permanent Main Admin. Afterwards, both
    // administrators and the Main Admin may create admins, but never another
    // Main Admin.
    let finalRole: Role = body.role;
    if (isBootstrap) {
      finalRole = "main_admin";
    } else if (body.role === "main_admin") {
      return new Response(
        JSON.stringify({ error: "A Main Admin already exists and cannot be replaced" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: body.full_name },
    });
    if (createErr || !created.user) {
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
    });

    // Every account owns exactly one private personal space. The database
    // trigger normally creates it; this fallback also supports deployments
    // where the Edge Function is updated before the migration is applied.
    const { data: existingPersonalSpace } = await admin
      .from("spaces")
      .select("id")
      .eq("type", "personal")
      .eq("owner_id", userId)
      .maybeSingle();
    if (!existingPersonalSpace) {
      const baseKey = personalSpaceKeyBase(body.full_name);
      const { data: allSpaceKeys, error: keysError } = await admin
        .from("spaces")
        .select("key");
      if (keysError) throw keysError;
      const usedKeys = new Set((allSpaceKeys ?? []).map((space) => space.key));
      let starCount = 1;
      let personalKey = `${baseKey}*`;
      while (usedKeys.has(personalKey)) {
        starCount += 1;
        personalKey = `${baseKey}${"*".repeat(starCount)}`;
      }
      const { error: personalSpaceError } = await admin.from("spaces").insert({
        key: personalKey,
        name: personalSpaceName(body.full_name),
        type: "personal",
        owner_id: userId,
      });
      if (personalSpaceError) throw personalSpaceError;
    }

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
