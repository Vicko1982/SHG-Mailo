// One-shot seed importer. Public endpoint (delete after use).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Payload = {
  users: { full_name: string; email: string }[];
  spaces: { key: string; name: string; type: "shared" | "personal"; color?: string; owner?: string }[];
  access: Record<string, string[]>; // space key -> [full_name]
  tasks: any[];
  defaultPassword: string;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const body = (await req.json()) as Payload;

    const nameToId = new Map<string, string>();

    // 1) Users
    const { data: existingProfiles } = await admin.from("profiles").select("id, full_name, email");
    for (const p of existingProfiles ?? []) if (p.full_name) nameToId.set(p.full_name.toLowerCase(), p.id);

    for (const u of body.users) {
      const key = u.full_name.toLowerCase();
      if (nameToId.has(key)) continue;
      // create auth user
      const created = await admin.auth.admin.createUser({
        email: u.email,
        password: body.defaultPassword,
        email_confirm: true,
        user_metadata: { full_name: u.full_name },
      });
      if (created.error) { console.error("user", u.email, created.error.message); continue; }
      const id = created.data.user!.id;
      // handle_new_user trigger inserts profile + role. Update initials.
      await admin.from("profiles").update({ initials: initials(u.full_name), full_name: u.full_name, email: u.email }).eq("id", id);
      nameToId.set(key, id);
    }

    // 2) Spaces
    const keyToSpaceId = new Map<string, string>();
    const { data: existingSpaces } = await admin.from("spaces").select("id, key");
    for (const s of existingSpaces ?? []) keyToSpaceId.set(s.key, s.id);
    for (const s of body.spaces) {
      if (keyToSpaceId.has(s.key)) continue;
      const ownerId = s.owner ? nameToId.get(s.owner.toLowerCase()) ?? null : null;
      const ins = await admin.from("spaces").insert({
        key: s.key, name: s.name, type: s.type, color: s.color ?? null, owner_id: ownerId,
      }).select("id").single();
      if (ins.error) { console.error("space", s.key, ins.error.message); continue; }
      keyToSpaceId.set(s.key, ins.data.id);
    }

    // 3) Access / space_members
    const memberRows: any[] = [];
    for (const [spaceKey, members] of Object.entries(body.access)) {
      const sid = keyToSpaceId.get(spaceKey); if (!sid) continue;
      for (const m of members) {
        const uid = nameToId.get(m.toLowerCase()); if (!uid) continue;
        memberRows.push({ space_id: sid, user_id: uid });
      }
    }
    if (memberRows.length) {
      // Clean existing then insert
      await admin.from("space_members").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      // chunk
      for (let i = 0; i < memberRows.length; i += 500) {
        const chunk = memberRows.slice(i, i + 500);
        const r = await admin.from("space_members").insert(chunk);
        if (r.error) console.error("members chunk", r.error.message);
      }
    }

    // 4) Tasks
    const taskRows: any[] = [];
    for (const t of body.tasks) {
      const sid = keyToSpaceId.get(t.project); if (!sid) continue;
      const assigneeId = t.assignee && t.assignee !== "Unassigned" ? (nameToId.get(String(t.assignee).toLowerCase()) ?? null) : null;
      const supervisorId = t.supervisor ? (nameToId.get(String(t.supervisor).toLowerCase()) ?? null) : null;
      taskRows.push({
        task_key: t.id,
        title: t.title,
        space_id: sid,
        status: t.status,
        jira_status: t.jiraStatus ?? null,
        priority: t.priority ?? null,
        assignee_id: assigneeId,
        supervisor_id: supervisorId,
        description: t.description ?? null,
        issue_type: t.issueType ?? "Task",
        due_date: t.dueDate ? String(t.dueDate).slice(0, 10) : null,
        labels: Array.isArray(t.labels) ? t.labels : [],
        audit: t.audit ?? [],
        created_at: t.created ?? undefined,
        updated_at: t.updated ?? undefined,
      });
    }
    // wipe existing tasks first (fresh import)
    await admin.from("tasks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    let taskInserted = 0;
    for (let i = 0; i < taskRows.length; i += 200) {
      const chunk = taskRows.slice(i, i + 200);
      const r = await admin.from("tasks").insert(chunk);
      if (r.error) console.error("tasks chunk", i, r.error.message);
      else taskInserted += chunk.length;
    }

    return new Response(JSON.stringify({
      ok: true,
      users: nameToId.size,
      spaces: keyToSpaceId.size,
      members: memberRows.length,
      tasks: taskInserted,
    }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
