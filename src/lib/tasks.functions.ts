import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TaskSortKey = "updated_at" | "created_at" | "task_key" | "title" | "status" | "priority" | "due_date";

export type TaskFilters = {
  spaceKey?: string;
  scope?: "all" | "mine" | "supervising";
  statuses?: string[];
  priorities?: string[];
  assigneeIds?: string[];
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: TaskSortKey;
  sortDir?: "asc" | "desc";
  asUserId?: string; // main_admin impersonation only
};

const TASK_SELECT = `
  id, task_key, title, status, jira_status, priority, due_date, labels, parent_id, issue_type,
  created_at, updated_at, description, audit,
  space:spaces!inner(id, key, name, color, type, owner_id),
  assignee:profiles!tasks_assignee_id_fkey(id, full_name),
  supervisor:profiles!tasks_supervisor_id_fkey(id, full_name),
  created_by:profiles!tasks_created_by_id_fkey(id, full_name)
`;

async function assertMainAdmin(supabase: import("@supabase/supabase-js").SupabaseClient, userId: string) {
  const { data } = await supabase.rpc("is_main_admin", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

export const listTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((f: TaskFilters) => f)
  .handler(async ({ data, context }) => {
    const {
      spaceKey,
      scope = "all",
      statuses,
      priorities,
      assigneeIds,
      search,
      page = 1,
      pageSize = 50,
      sortBy = "updated_at",
      sortDir = "desc",
      asUserId,
    } = data;

    let q = context.supabase
      .from("tasks")
      .select(TASK_SELECT, { count: "exact" });

    if (spaceKey) q = q.eq("space.key", spaceKey);
    if (statuses?.length) q = q.in("status", statuses);
    if (priorities?.length) q = q.in("priority", priorities);
    if (assigneeIds?.length) q = q.in("assignee_id", assigneeIds);
    if (scope === "mine") q = q.eq("assignee_id", context.userId);
    if (scope === "supervising") q = q.eq("supervisor_id", context.userId);

    if (asUserId) {
      await assertMainAdmin(context.supabase, context.userId);
      // Spaces the impersonated user can access (personal owner + member)
      const [ownedRes, memberRes] = await Promise.all([
        context.supabase.from("spaces").select("id").eq("owner_id", asUserId).eq("type", "personal"),
        context.supabase.from("space_members").select("space_id").eq("user_id", asUserId),
      ]);
      const spaceIds = new Set<string>([
        ...((ownedRes.data ?? []).map((r) => r.id)),
        ...((memberRes.data ?? []).map((r) => r.space_id)),
      ]);
      const ids = Array.from(spaceIds);
      const orParts = [
        `assignee_id.eq.${asUserId}`,
        `supervisor_id.eq.${asUserId}`,
      ];
      if (ids.length) orParts.push(`space_id.in.(${ids.join(",")})`);
      q = q.or(orParts.join(","));
    }

    if (search && search.trim()) {
      const s = search.trim().replace(/[%_]/g, "\\$&");
      q = q.or(`title.ilike.%${s}%,task_key.ilike.%${s}%,description.ilike.%${s}%`);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    q = q.order(sortBy, { ascending: sortDir === "asc", nullsFirst: false }).range(from, to);

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0, page, pageSize };
  });

export const getTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskKey: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("task_key", data.taskKey)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string; status: string }) => d)
  .handler(async ({ data, context }) => {
    const valid = [
      "backlog", "todo", "progress", "pause", "blocked", "review", "done", "cancelled",
    ];
    if (!valid.includes(data.status)) throw new Error("Invalid status");
    const { data: before } = await context.supabase
      .from("tasks").select("status, title").eq("id", data.taskId).maybeSingle();
    const { error } = await context.supabase
      .from("tasks")
      .update({ status: data.status })
      .eq("id", data.taskId);
    if (error) throw new Error(error.message);
    await context.supabase.from("activity_log").insert({
      user_id: context.userId,
      action: "task_update_status",
      task_id: data.taskId,
      task_title: before?.title ?? null,
      metadata: { from: before?.status ?? null, to: data.status },
    });
    return { ok: true };
  });

export const updateTaskFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      taskId: string;
      title?: string;
      description?: string | null;
      priority?: string | null;
      assignee_id?: string | null;
      supervisor_id?: string | null;
      due_date?: string | null;
      status?: string;
      space_id?: string;
      labels?: string[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { taskId, ...fields } = data;
    const { data: before } = await context.supabase
      .from("tasks")
      .select("title, status, supervisor_id, space_id, space:spaces!inner(type, owner_id)")
      .eq("id", taskId)
      .maybeSingle();
    const [{ data: isAdmin }, { data: isMain }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }),
      context.supabase.rpc("is_main_admin", { _user_id: context.userId }),
    ]);
    const isSupervisor = before?.supervisor_id === context.userId;
    const changedFields = Object.keys(fields).filter(
      (key) => fields[key as keyof typeof fields] !== undefined,
    );
    const currentSpace = Array.isArray(before?.space) ? before.space[0] : before?.space;
    const isMovingFromOwnPersonalSpace = changedFields.length === 1
      && changedFields[0] === "space_id"
      && !!fields.space_id
      && fields.space_id !== before?.space_id
      && currentSpace?.type === "personal"
      && currentSpace?.owner_id === context.userId;

    if (!isAdmin && !isMain && !isSupervisor && !isMovingFromOwnPersonalSpace) {
      throw new Error(
        "A user can only move a task once, from their own Personal Space to another accessible Space",
      );
    }
    if (fields.status && !ALL_TASK_STATUSES.includes(fields.status)) {
      throw new Error("Invalid status");
    }
    const updateFields: typeof fields & { task_key?: string } = { ...fields };
    if (fields.space_id && fields.space_id !== before?.space_id) {
      const { data: destination, error: destinationError } = await context.supabase
        .from("spaces")
        .select("key")
        .eq("id", fields.space_id)
        .maybeSingle();
      if (destinationError) throw new Error(destinationError.message);
      if (!destination) throw new Error("You do not have access to the selected Space");

      const { data: existingKeys, error: keysError } = await context.supabase
        .from("tasks")
        .select("task_key")
        .like("task_key", `${destination.key}-%`);
      if (keysError) throw new Error(keysError.message);
      const nextNumber = Math.max(
        0,
        ...(existingKeys ?? []).map(
          (row) => Number(row.task_key.slice(destination.key.length + 1)) || 0,
        ),
      ) + 1;
      updateFields.task_key = `${destination.key}-${nextNumber}`;
    }
    const { error } = await context.supabase
      .from("tasks")
      .update(updateFields)
      .eq("id", taskId);
    if (error) throw new Error(error.message);
    await context.supabase.from("activity_log").insert({
      user_id: context.userId,
      action: "task_edit",
      task_id: taskId,
      task_title: before?.title ?? null,
      metadata: { fields: Object.keys(updateFields) },
    });
    return { ok: true };
  });

const ALL_TASK_STATUSES = [
  "backlog", "todo", "progress", "pause", "blocked", "review", "done", "cancelled",
];

export const getTaskActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("activity_log")
      .select("id, action, created_at, metadata, user:profiles!activity_log_user_id_fkey(id, full_name)")
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getTaskAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { taskId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: task, error } = await context.supabase
      .from("tasks")
      .select("space_id, assignee_id, supervisor_id, created_by_id, space:spaces!inner(owner_id)")
      .eq("id", data.taskId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!task) return [];

    const [{ data: members }, { data: comments }, { data: profiles }, { data: roles }] = await Promise.all([
      context.supabase.from("space_members").select("user_id").eq("space_id", task.space_id),
      context.supabase.from("task_comments").select("content").eq("task_id", data.taskId),
      context.supabase.from("profiles").select("id, full_name, email, is_active"),
      context.supabase.from("user_roles").select("user_id, role").in("role", ["admin", "main_admin"]),
    ]);

    const ids = new Set<string>();
    [task.assignee_id, task.supervisor_id, task.created_by_id, task.space?.owner_id]
      .filter(Boolean)
      .forEach((id) => ids.add(id as string));
    (members ?? []).forEach((m) => ids.add(m.user_id));
    (roles ?? []).forEach((r) => ids.add(r.user_id));

    const commentText = (comments ?? []).map((c) => c.content).join("\n").toLowerCase();
    (profiles ?? []).forEach((p) => {
      if (p.full_name && commentText.includes(`@${p.full_name.toLowerCase()}`)) ids.add(p.id);
    });

    return (profiles ?? [])
      .filter((p) => ids.has(p.id))
      .map((p) => ({
        ...p,
        reason:
          p.id === task.assignee_id ? "Assignee"
          : p.id === task.supervisor_id ? "Supervisor"
          : (roles ?? []).some((r) => r.user_id === p.id) ? "Administrator"
          : p.id === task.space?.owner_id ? "Space owner"
          : (members ?? []).some((m) => m.user_id === p.id) ? "Space member"
          : "Mentioned",
      }))
      .sort((a, b) => (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""));
  });

export const createSubtask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { parentTaskId: string; title: string }) => d)
  .handler(async ({ data, context }) => {
    if (!data.title.trim()) throw new Error("A title is required");
    const { data: parent, error: parentError } = await context.supabase
      .from("tasks")
      .select("title, space_id, supervisor_id, space:spaces!inner(key)")
      .eq("id", data.parentTaskId)
      .single();
    if (parentError) throw new Error(parentError.message);
    const prefix = parent.space.key;
    const { data: existing, error: existingError } = await context.supabase
      .from("tasks")
      .select("task_key")
      .like("task_key", `${prefix}-%`);
    if (existingError) throw new Error(existingError.message);
    const nextNumber = Math.max(
      0,
      ...(existing ?? []).map((row) => Number(row.task_key.slice(prefix.length + 1)) || 0),
    ) + 1;
    const taskKey = `${prefix}-${nextNumber}`;
    const { data: created, error } = await context.supabase
      .from("tasks")
      .insert({
        task_key: taskKey,
        title: data.title.trim(),
        space_id: parent.space_id,
        status: "backlog",
        priority: "Medium",
        supervisor_id: parent.supervisor_id,
        parent_id: data.parentTaskId,
        issue_type: "Subtask",
        created_by_id: context.userId,
      })
      .select("id, task_key")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("activity_log").insert({
      user_id: context.userId,
      action: "subtask_create",
      task_id: created.id,
      task_title: data.title.trim(),
      metadata: { parent_task_id: data.parentTaskId, parent_title: parent.title },
    });
    return created;
  });

export const setTaskPlacement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    taskId: string;
    parentTaskId?: string | null;
  }) => d)
  .handler(async ({ data, context }) => {
    if (data.parentTaskId === data.taskId) throw new Error("A task cannot be its own subtask");
    const { data: task, error: taskError } = await context.supabase
      .from("tasks")
      .select("id, title, parent_id, space_id")
      .eq("id", data.taskId)
      .single();
    if (taskError) throw new Error(taskError.message);

    if (!data.parentTaskId) {
      const { error } = await context.supabase
        .from("tasks")
        .update({ parent_id: null, issue_type: "Task" })
        .eq("id", data.taskId);
      if (error) throw new Error(error.message);
      await context.supabase.from("activity_log").insert({
        user_id: context.userId,
        action: "task_make_standalone",
        task_id: task.id,
        task_title: task.title,
        metadata: { previous_parent_id: task.parent_id },
      });
      return { ok: true };
    }

    const { data: parent, error: parentError } = await context.supabase
      .from("tasks")
      .select("id, title, parent_id, space_id, space:spaces!inner(key)")
      .eq("id", data.parentTaskId)
      .single();
    if (parentError) throw new Error(parentError.message);
    if (parent.parent_id === task.id) throw new Error("This change would create a circular subtask relationship");

    const patch: {
      parent_id: string;
      issue_type: string;
      space_id?: string;
      task_key?: string;
    } = {
      parent_id: parent.id,
      issue_type: "Subtask",
    };
    if (task.space_id !== parent.space_id) {
      const prefix = parent.space.key;
      const { data: existing, error: existingError } = await context.supabase
        .from("tasks")
        .select("task_key")
        .like("task_key", `${prefix}-%`);
      if (existingError) throw new Error(existingError.message);
      const nextNumber = Math.max(
        0,
        ...(existing ?? []).map((row) => Number(row.task_key.slice(prefix.length + 1)) || 0),
      ) + 1;
      patch.space_id = parent.space_id;
      patch.task_key = `${prefix}-${nextNumber}`;
    }
    const { error } = await context.supabase.from("tasks").update(patch).eq("id", task.id);
    if (error) throw new Error(error.message);
    await context.supabase.from("activity_log").insert({
      user_id: context.userId,
      action: "task_make_subtask",
      task_id: task.id,
      task_title: task.title,
      metadata: { parent_task_id: parent.id, parent_title: parent.title },
    });
    return { ok: true };
  });

export const listTaskLabels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tasks")
      .select("labels");
    if (error) throw new Error(error.message);
    const labels = new Map<string, string>();
    (data ?? []).forEach((row) => {
      (row.labels ?? []).forEach((label: string) => {
        const clean = label.trim();
        if (clean && !labels.has(clean.toLocaleLowerCase())) {
          labels.set(clean.toLocaleLowerCase(), clean);
        }
      });
    });
    return Array.from(labels.values()).sort((a, b) => a.localeCompare(b));
  });
