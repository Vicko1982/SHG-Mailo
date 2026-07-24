import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sharedSpaceKey } from "@/lib/space-key";

export const listSpaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { asUserId?: string } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    const [{ data: rows, error }, { data: activeTasks, error: taskError }, { data: isMain }] = await Promise.all([
      context.supabase
        .from("spaces")
        .select("id, key, name, color, type, owner_id"),
      context.supabase
        .from("tasks")
        .select("space_id")
        .not("status", "in", "(done,cancelled)"),
      context.supabase.rpc("is_main_admin", { _user_id: context.userId }),
    ]);
    if (error) throw new Error(error.message);
    if (taskError) throw new Error(taskError.message);
    let spaces = rows ?? [];
    if (data.asUserId) {
      if (!isMain) throw new Error("Forbidden");
      const [ownedRes, memberRes] = await Promise.all([
        context.supabase.from("spaces").select("id").eq("owner_id", data.asUserId).eq("type", "personal"),
        context.supabase.from("space_members").select("space_id").eq("user_id", data.asUserId),
      ]);
      const allowed = new Set<string>([
        ...((ownedRes.data ?? []).map((r) => r.id)),
        ...((memberRes.data ?? []).map((r) => r.space_id)),
      ]);
      spaces = spaces.filter((s) => allowed.has(s.id));
    } else if (!isMain) {
      // Administrators and ordinary users see only their own personal space.
      // Shared spaces remain governed by the existing access policies.
      spaces = spaces.filter(
        (space) => space.type === "shared" || space.owner_id === context.userId,
      );
    }

    const counts = new Map<string, number>();
    (activeTasks ?? []).forEach((task) => {
      counts.set(task.space_id, (counts.get(task.space_id) ?? 0) + 1);
    });

    return spaces
      .map((space) => ({
        ...space,
        active_task_count: counts.get(space.id) ?? 0,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "personal" ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  });

export const listProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email, is_active")
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

function personalSpaceName(fullName: string | null): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Personal";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${Array.from(parts[parts.length - 1])[0]}`;
}

function personalSpaceKeyBase(fullName: string | null): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const firstInitial = Array.from(parts[0] ?? "P")[0] ?? "P";
  const lastInitial = parts.length > 1
    ? (Array.from(parts[parts.length - 1])[0] ?? "")
    : "";
  return `${firstInitial}${lastInitial}`.toLocaleUpperCase();
}

export const syncPersonalSpaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isMainAdmin, error: roleError } = await context.supabase
      .rpc("is_main_admin", { _user_id: context.userId });
    if (roleError) throw new Error(roleError.message);
    if (!isMainAdmin) throw new Error("Only the Main Admin can synchronize personal spaces");

    const [{ data: profiles, error: profilesError }, { data: spaces, error: spacesError }] = await Promise.all([
      context.supabase.from("profiles").select("id, full_name"),
      context.supabase.from("spaces").select("id, key, name, type, owner_id"),
    ]);
    if (profilesError) throw new Error(profilesError.message);
    if (spacesError) throw new Error(spacesError.message);

    const personalByOwner = new Map(
      (spaces ?? []).filter((space) => space.type === "personal" && space.owner_id)
        .map((space) => [space.owner_id!, space]),
    );
    const desiredKeyByOwner = new Map<string, string>();
    const keyOccurrences = new Map<string, number>();
    const orderedProfiles = [...(profiles ?? [])].sort((a, b) =>
      (a.full_name ?? "").localeCompare(b.full_name ?? "", undefined, { sensitivity: "base" })
      || a.id.localeCompare(b.id)
    );
    for (const profile of orderedProfiles) {
      const base = personalSpaceKeyBase(profile.full_name);
      const occurrence = (keyOccurrences.get(base) ?? 0) + 1;
      keyOccurrences.set(base, occurrence);
      desiredKeyByOwner.set(profile.id, `${base}${"*".repeat(occurrence)}`);
    }
    let changed = 0;
    for (const profile of profiles ?? []) {
      const expectedName = personalSpaceName(profile.full_name);
      const expectedKey = desiredKeyByOwner.get(profile.id)!;
      const existing = personalByOwner.get(profile.id);
      if (!existing) {
        const { error } = await context.supabase.from("spaces").insert({
          key: expectedKey,
          name: expectedName,
          type: "personal",
          owner_id: profile.id,
        });
        if (error) throw new Error(error.message);
        changed += 1;
      } else if (existing.name !== expectedName || existing.key !== expectedKey) {
        if (existing.key !== expectedKey) {
          const { data: tasks, error: tasksError } = await context.supabase
            .from("tasks")
            .select("id, task_key")
            .eq("space_id", existing.id);
          if (tasksError) throw new Error(tasksError.message);
          for (const task of tasks ?? []) {
            const oldPrefix = `${existing.key}-`;
            const suffix = task.task_key.startsWith(oldPrefix)
              ? task.task_key.slice(oldPrefix.length)
              : task.task_key.split("-").pop()!;
            const { error: taskError } = await context.supabase
              .from("tasks")
              .update({ task_key: `${expectedKey}-${suffix}` })
              .eq("id", task.id);
            if (taskError) throw new Error(taskError.message);
          }
        }
        const { error } = await context.supabase
          .from("spaces")
          .update({ name: expectedName, key: expectedKey })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
        changed += 1;
      }
    }

    const desiredSharedKeys = new Map<string, string>();
    for (const space of (spaces ?? []).filter((item) => item.type === "shared")) {
      const expectedKey = sharedSpaceKey(space.name);
      const conflictingSpace = desiredSharedKeys.get(expectedKey);
      if (conflictingSpace && conflictingSpace !== space.id) {
        throw new Error(`Two Shared Spaces produce the same three-letter key ${expectedKey}.`);
      }
      desiredSharedKeys.set(expectedKey, space.id);
    }
    for (const space of (spaces ?? []).filter((item) => item.type === "shared")) {
      const expectedKey = sharedSpaceKey(space.name);
      if (space.key === expectedKey) continue;
      const { data: tasks, error: tasksError } = await context.supabase
        .from("tasks")
        .select("id, task_key")
        .eq("space_id", space.id);
      if (tasksError) throw new Error(tasksError.message);
      for (const task of tasks ?? []) {
        const oldPrefix = `${space.key}-`;
        const suffix = task.task_key.startsWith(oldPrefix)
          ? task.task_key.slice(oldPrefix.length)
          : task.task_key.split("-").pop()!;
        const { error: taskError } = await context.supabase
          .from("tasks")
          .update({ task_key: `${expectedKey}-${suffix}` })
          .eq("id", task.id);
        if (taskError) throw new Error(taskError.message);
      }
      const { error } = await context.supabase
        .from("spaces")
        .update({ key: expectedKey })
        .eq("id", space.id);
      if (error) throw new Error(error.message);
      changed += 1;
    }
    return { changed };
  });

export const getSpaceDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: space, error } = await context.supabase
      .from("spaces")
      .select("id, key, name, color, type, owner_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const { data: members, error: mErr } = await context.supabase
      .from("space_members")
      .select("user_id")
      .eq("space_id", data.id);
    if (mErr) throw new Error(mErr.message);
    return { space, memberIds: (members ?? []).map((m) => m.user_id) };
  });

export const createSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    key: string;
    name: string;
    color?: string | null;
    type: "shared" | "personal";
    owner_id?: string | null;
    member_ids?: string[];
  }) => d)
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase
      .from("spaces")
      .insert({
        key: data.type === "shared"
          ? sharedSpaceKey(data.name)
          : data.key.trim().toUpperCase(),
        name: data.name.trim(),
        color: data.color ?? null,
        type: data.type,
        owner_id: data.type === "personal" ? (data.owner_id ?? context.userId) : null,
      })
      .select("id, key")
      .single();
    if (error) throw new Error(error.message);
    if (data.member_ids?.length) {
      const rows = data.member_ids.map((uid) => ({ space_id: inserted.id, user_id: uid }));
      const { error: mErr } = await context.supabase.from("space_members").insert(rows);
      if (mErr) throw new Error(mErr.message);
    }
    await context.supabase.from("activity_log").insert({
      user_id: context.userId,
      action: "space_create",
      task_title: `${inserted.key} · ${data.name}`,
      metadata: { space_id: inserted.id, type: data.type },
    });
    return inserted;
  });

export const updateSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    key?: string;
    name?: string;
    color?: string | null;
    owner_id?: string | null;
    member_ids?: string[];
  }) => d)
  .handler(async ({ data, context }) => {
    const patch: { key?: string; name?: string; color?: string | null; owner_id?: string | null } = {};
    let previousKey: string | undefined;
    let renamedTasks: Array<{ id: string; task_key: string; nextKey: string }> = [];

    if (data.key !== undefined) {
      const normalizedKey = data.key.trim().toUpperCase();
      if (!normalizedKey || !/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*\*?$/.test(normalizedKey)) {
        throw new Error("The space key may contain letters, numbers, hyphens, underscores and a trailing asterisk.");
      }

      const [{ data: currentSpace, error: spaceError }, { data: duplicate, error: duplicateError }] = await Promise.all([
        context.supabase.from("spaces").select("key").eq("id", data.id).single(),
        context.supabase.from("spaces").select("id").eq("key", normalizedKey).neq("id", data.id).maybeSingle(),
      ]);
      if (spaceError) throw new Error(spaceError.message);
      if (duplicateError) throw new Error(duplicateError.message);
      if (duplicate) throw new Error(`The space key ${normalizedKey} is already in use.`);

      previousKey = currentSpace.key;
      if (normalizedKey !== previousKey) {
        const { data: tasks, error: tasksError } = await context.supabase
          .from("tasks")
          .select("id, task_key")
          .eq("space_id", data.id);
        if (tasksError) throw new Error(tasksError.message);

        renamedTasks = (tasks ?? []).map((task) => {
          const expectedPrefix = `${previousKey}-`;
          const suffix = task.task_key.startsWith(expectedPrefix)
            ? task.task_key.slice(expectedPrefix.length)
            : task.task_key.split("-").pop()!;
          return { ...task, nextKey: `${normalizedKey}-${suffix}` };
        });

        if (renamedTasks.length) {
          const { data: conflicts, error: conflictError } = await context.supabase
            .from("tasks")
            .select("id, task_key")
            .in("task_key", renamedTasks.map((task) => task.nextKey));
          if (conflictError) throw new Error(conflictError.message);
          const taskIds = new Set(renamedTasks.map((task) => task.id));
          const conflict = (conflicts ?? []).find((task) => !taskIds.has(task.id));
          if (conflict) throw new Error(`The task key ${conflict.task_key} is already in use.`);
        }
        patch.key = normalizedKey;
      }
    }
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.color !== undefined) patch.color = data.color;
    if (data.owner_id !== undefined) patch.owner_id = data.owner_id;
    if (Object.keys(patch).length) {
      const { error } = await context.supabase.from("spaces").update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    for (const task of renamedTasks) {
      const { error } = await context.supabase
        .from("tasks")
        .update({ task_key: task.nextKey })
        .eq("id", task.id);
      if (error) throw new Error(error.message);
    }
    if (data.member_ids) {
      // Replace membership set
      const { error: dErr } = await context.supabase
        .from("space_members").delete().eq("space_id", data.id);
      if (dErr) throw new Error(dErr.message);
      if (data.member_ids.length) {
        const rows = data.member_ids.map((uid) => ({ space_id: data.id, user_id: uid }));
        const { error: iErr } = await context.supabase.from("space_members").insert(rows);
        if (iErr) throw new Error(iErr.message);
      }
    }
    if (Object.keys(patch).length || data.member_ids) {
      await context.supabase.from("activity_log").insert({
        user_id: context.userId,
        action: "space_update",
        metadata: { space_id: data.id, fields: Object.keys(patch), members_changed: !!data.member_ids },
      });
    }
    return { ok: true };
  });

export const deleteSpace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: sp } = await context.supabase
      .from("spaces").select("key, name").eq("id", data.id).maybeSingle();
    const { error } = await context.supabase.from("spaces").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("activity_log").insert({
      user_id: context.userId,
      action: "space_delete",
      task_title: sp ? `${sp.key} · ${sp.name}` : null,
      metadata: { space_id: data.id },
    });
    return { ok: true };
  });
