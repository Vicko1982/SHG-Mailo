import { readFile } from "node:fs/promises";

const [exportPath, usersPath, serviceKeyPath] = process.argv.slice(2);
if (!exportPath || !usersPath || !serviceKeyPath) {
  throw new Error("Usage: node scripts/import-supabase-backup.mjs <export.json> <users.json> <service-key-file>");
}

const supabaseUrl = process.env.SUPABASE_URL;
if (!supabaseUrl) throw new Error("SUPABASE_URL is required");

const serviceKey = (await readFile(serviceKeyPath, "utf8")).trim();
const users = JSON.parse(await readFile(usersPath, "utf8"));
const exported = JSON.parse(await readFile(exportPath, "utf8"));
const data = exported.data ?? {};
const tasks = JSON.parse(data["shg-tasks-v5"] ?? "[]");
const sharedSpaces = JSON.parse(data["shg-shared-space-definitions"] ?? "{}");
const spaceAccess = JSON.parse(data["shg-space-access"] ?? "{}");
const activity = JSON.parse(data["shg-activity-log"] ?? "[]");
const manualOrder = JSON.parse(data["shg-manual-task-order"] ?? "[]");
const administrators = new Set(JSON.parse(data["shg-administrators"] ?? "[]").map(normalizeName));

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

function normalizeName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en");
}

function initials(value) {
  return String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

async function request(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: { ...headers, Prefer: "return=representation", ...(options.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

async function insertChunks(table, rows, size = 200) {
  let inserted = 0;
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size);
    if (!chunk.length) continue;
    await request(`/rest/v1/${table}`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(chunk),
    });
    inserted += chunk.length;
    process.stdout.write(`${table}: ${inserted}/${rows.length}\n`);
  }
}

async function fetchAll(path, pageSize = 1000) {
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const page = await request(path, {
      headers: { Range: `${start}-${start + pageSize - 1}` },
    });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

const existingTaskCount = await request("/rest/v1/tasks?select=id&limit=1");
const destinationAlreadyHasTasks = existingTaskCount.length > 0;

const orderedUsers = [
  ...users.filter((user) => user.role === "main_admin"),
  ...users.filter((user) => user.role !== "main_admin"),
];
const authUsers = await request("/auth/v1/admin/users?page=1&per_page=100");
const authByEmail = new Map((authUsers.users ?? []).map((user) => [user.email.toLowerCase(), user]));

for (const user of orderedUsers) {
  const email = user.email.toLowerCase();
  if (!authByEmail.has(email)) {
    const created = await request("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email,
        email_confirm: true,
        user_metadata: { full_name: user.full_name },
      }),
    });
    authByEmail.set(email, created);
  }
}

const nameToId = new Map();
for (const user of orderedUsers) {
  const authUser = authByEmail.get(user.email.toLowerCase());
  if (!authUser?.id) throw new Error(`Auth user was not created: ${user.email}`);
  nameToId.set(normalizeName(user.full_name), authUser.id);

  await request(`/rest/v1/profiles?id=eq.${authUser.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      full_name: user.full_name,
      email: user.email.toLowerCase(),
      initials: initials(user.full_name),
      is_active: true,
    }),
  });

  await request(`/rest/v1/user_roles?user_id=eq.${authUser.id}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  const role = user.role === "main_admin"
    ? "main_admin"
    : administrators.has(normalizeName(user.full_name))
      ? "admin"
      : "user";
  await request("/rest/v1/user_roles", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ user_id: authUser.id, role }),
  });
}

const sharedRows = Object.entries(sharedSpaces).map(([key, value]) => ({
  key,
  name: value.name,
  color: value.color ?? null,
  type: "shared",
}));
if (sharedRows.length) {
  await request("/rest/v1/spaces?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(sharedRows),
  });
}

const allSpaces = await request("/rest/v1/spaces?select=id,key,name,type,owner_id");
const spaceIdByKey = new Map(allSpaces.map((space) => [space.key, space.id]));
for (const [exportedKey, definition] of Object.entries(sharedSpaces)) {
  const matchingSpace = allSpaces.find(
    (space) => space.type === "shared" && space.name === definition.name,
  );
  if (matchingSpace) spaceIdByKey.set(exportedKey, matchingSpace.id);
}

const memberRows = [];
for (const [spaceKey, memberNames] of Object.entries(spaceAccess)) {
  const spaceId = spaceIdByKey.get(spaceKey);
  if (!spaceId) continue;
  for (const memberName of memberNames) {
    const userId = nameToId.get(normalizeName(memberName));
    if (userId) memberRows.push({ space_id: spaceId, user_id: userId });
  }
}
const sharedMemberRows = memberRows.filter((row) => {
  const space = allSpaces.find((candidate) => candidate.id === row.space_id);
  return space?.type === "shared";
});
if (sharedMemberRows.length) {
  await request("/rest/v1/space_members?on_conflict=space_id,user_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(sharedMemberRows),
  });
}

const orderByTaskKey = new Map(manualOrder.map((taskKey, index) => [taskKey, index]));
const taskRows = tasks.map((task) => {
  const spaceId = spaceIdByKey.get(task.project);
  if (!spaceId) throw new Error(`Missing space ${task.project} for task ${task.id}`);
  return {
    task_key: task.id,
    title: task.title || task.id,
    space_id: spaceId,
    status: task.status ?? "backlog",
    jira_status: task.jiraStatus ?? null,
    priority: task.priority ?? null,
    assignee_id: nameToId.get(normalizeName(task.assignee)) ?? null,
    supervisor_id: nameToId.get(normalizeName(task.supervisor)) ?? null,
    approver_id: nameToId.get(normalizeName(task.approver)) ?? null,
    description: task.description ?? null,
    issue_type: task.issueType ?? "Task",
    due_date: task.dueDate ? String(task.dueDate).slice(0, 10) : null,
    labels: Array.isArray(task.labels) ? task.labels : [],
    cancellation_reason: task.cancellationReason ?? null,
    created_by_id: nameToId.get(normalizeName(task.creator)) ?? null,
    audit: Array.isArray(task.audit) ? task.audit : [],
    is_mini_task: Boolean(task.isMiniTask),
    manual_order: orderByTaskKey.get(task.id) ?? null,
    created_at: task.created || new Date().toISOString(),
    updated_at: task.updated || task.created || new Date().toISOString(),
    legacy_data: task,
  };
});
if (!destinationAlreadyHasTasks) {
  await insertChunks("tasks", taskRows, 150);
}

const insertedTasks = await fetchAll("/rest/v1/tasks?select=id,task_key");
const taskIdByKey = new Map(insertedTasks.map((task) => [task.task_key, task.id]));
const parentUpdates = tasks
  .filter((task) => task.parent && taskIdByKey.has(task.id) && taskIdByKey.has(task.parent))
  .map((task) => ({ id: taskIdByKey.get(task.id), parent_id: taskIdByKey.get(task.parent) }));
for (const update of parentUpdates) {
  await request(`/rest/v1/tasks?id=eq.${update.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ parent_id: update.parent_id }),
  });
}

const commentRows = tasks.flatMap((task) => {
  const taskId = taskIdByKey.get(task.id);
  if (!taskId) return [];
  return (task.comments ?? []).map((comment) => ({
    task_id: taskId,
    author_id: nameToId.get(normalizeName(comment.author)) ?? null,
    content: comment.text || " ",
    created_at: comment.createdAt || task.updated || new Date().toISOString(),
    updated_at: comment.createdAt || task.updated || new Date().toISOString(),
    legacy_data: comment,
  }));
});
if (destinationAlreadyHasTasks) {
  await request("/rest/v1/task_comments?id=not.is.null", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  await request("/rest/v1/activity_log?id=not.is.null", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}
await insertChunks("task_comments", commentRows, 200);

const activityRows = activity.map((entry) => ({
  user_id: nameToId.get(normalizeName(entry.user)) ?? null,
  action: entry.action || "Activity",
  task_id: taskIdByKey.get(entry.taskId) ?? null,
  task_title: entry.taskTitle || null,
  metadata: { role: entry.role ?? null, legacy_id: entry.id ?? null },
  created_at: entry.at || new Date().toISOString(),
  legacy_data: entry,
}));
await insertChunks("activity_log", activityRows, 200);

console.log(JSON.stringify({
  ok: true,
  users: orderedUsers.length,
  sharedSpaces: sharedRows.length,
  totalSpaces: allSpaces.length,
  tasks: taskRows.length,
  subtasks: parentUpdates.length,
  comments: commentRows.length,
  activity: activityRows.length,
}, null, 2));
