(() => {
  const TASK_KEY = 'shg-tasks-v5';
  const ACTIVITY_KEY = 'shg-activity-log';
  const SHARED_SPACES_KEY = 'shg-shared-space-definitions';
  const SPACE_ACCESS_KEY = 'shg-space-access';
  const ADMIN_KEY = 'shg-administrators';
  const APPROVER_KEY = 'shg-approvers';
  const REMOTE_TIMEOUT = 20000;

  const cache = {
    tasks: new Map(),
    taskHashes: new Map(),
    comments: new Map(),
    commentHashes: new Map(),
    profiles: new Map(),
    profileIdsByName: new Map(),
    spaces: new Map(),
    spaceIdsByKey: new Map(),
    activityIds: new Set(),
    ready: false,
    syncing: false,
    queued: false,
    timer: null,
  };

  function session() {
    return window.shgGetSupabaseSession?.() || null;
  }

  function enabled() {
    return Boolean(session()?.access_token && window.SHG_SUPABASE_URL && window.SHG_SUPABASE_KEY);
  }

  function headers(extra = {}) {
    return {
      apikey: window.SHG_SUPABASE_KEY,
      Authorization: `Bearer ${session()?.access_token || ''}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT);
    try {
      const response = await fetch(`${window.SHG_SUPABASE_URL}${path}`, {
        ...options,
        headers: headers(options.headers),
        signal: controller.signal,
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      if (!response.ok) {
        throw new Error(body?.message || body?.error_description || body?.hint || `Database request failed (${response.status})`);
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchAll(table, select = '*', extra = '') {
    const rows = [];
    const size = 1000;
    for (let start = 0; ; start += size) {
      const separator = extra ? `&${extra}` : '';
      const page = await request(`/rest/v1/${table}?select=${encodeURIComponent(select)}${separator}`, {
        headers: { Range: `${start}-${start + size - 1}` },
      });
      rows.push(...page);
      if (page.length < size) return rows;
    }
  }

  function normalizedName(value) {
    return String(value || '').trim().toLocaleLowerCase('en');
  }

  function safeClone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function publicTask(task) {
    const clone = safeClone(task) || {};
    delete clone._supabaseId;
    return clone;
  }

  function taskHash(task) {
    return JSON.stringify(publicTask(task));
  }

  function commentHash(comment) {
    const clone = safeClone(comment) || {};
    delete clone._supabaseId;
    delete clone.pending;
    return JSON.stringify(clone);
  }

  function profileName(id) {
    return cache.profiles.get(id)?.full_name || '';
  }

  function profileId(name) {
    const clean = normalizedName(name);
    if (!clean || clean === 'unassigned') return null;
    return cache.profileIdsByName.get(clean) || null;
  }

  function taskFromRow(row, parentKeyById, commentsByTask) {
    const legacy = row.legacy_data && typeof row.legacy_data === 'object'
      ? safeClone(row.legacy_data)
      : {};
    const task = {
      ...legacy,
      id: row.task_key,
      title: row.title,
      project: cache.spaces.get(row.space_id)?.key || legacy.project || '',
      status: row.status,
      jiraStatus: row.jira_status || legacy.jiraStatus || '',
      priority: row.priority || legacy.priority || 'Medium',
      assignee: profileName(row.assignee_id) || 'Unassigned',
      supervisor: profileName(row.supervisor_id) || '',
      approver: profileName(row.approver_id) || '',
      description: row.description || legacy.description || '',
      issueType: row.issue_type || legacy.issueType || 'Task',
      parent: row.parent_id ? parentKeyById.get(row.parent_id) || null : null,
      created: row.created_at,
      updated: row.updated_at,
      dueDate: row.due_date || null,
      labels: Array.isArray(row.labels) ? row.labels : [],
      cancellationReason: row.cancellation_reason || legacy.cancellationReason || '',
      creator: profileName(row.created_by_id) || legacy.creator || '',
      audit: Array.isArray(row.audit) ? row.audit : [],
      isMiniTask: Boolean(row.is_mini_task),
      comments: commentsByTask.get(row.id) || [],
      _supabaseId: row.id,
    };
    return task;
  }

  function commentFromRow(row) {
    const legacy = row.legacy_data && typeof row.legacy_data === 'object'
      ? safeClone(row.legacy_data)
      : {};
    return {
      ...legacy,
      id: legacy.id || row.id,
      author: profileName(row.author_id) || legacy.author || 'System',
      text: row.content,
      images: Array.isArray(legacy.images) ? legacy.images : [],
      createdAt: row.created_at,
      _supabaseId: row.id,
    };
  }

  function activityFromRow(row) {
    const legacy = row.legacy_data && typeof row.legacy_data === 'object'
      ? safeClone(row.legacy_data)
      : {};
    return {
      ...legacy,
      id: legacy.id || row.id,
      at: row.created_at,
      user: profileName(row.user_id) || legacy.user || 'System',
      action: legacy.action || row.action,
      taskId: legacy.taskId || row.task?.task_key || '',
      taskTitle: legacy.taskTitle || row.task_title || '',
      _supabaseId: row.id,
    };
  }

  async function loadRemoteData() {
    if (!enabled()) return { remote: false };

    const [profiles, roles, spaces, members, tasks, comments, activity] = await Promise.all([
      fetchAll('profiles', 'id,full_name,email,initials,is_active,last_login'),
      fetchAll('user_roles', 'user_id,role'),
      fetchAll('spaces', 'id,key,name,color,type,owner_id'),
      fetchAll('space_members', 'space_id,user_id'),
      fetchAll('tasks', 'id,task_key,title,space_id,status,jira_status,priority,assignee_id,supervisor_id,approver_id,description,issue_type,parent_id,created_at,updated_at,due_date,labels,cancellation_reason,created_by_id,audit,is_mini_task,manual_order,legacy_data'),
      fetchAll('task_comments', 'id,task_id,author_id,content,created_at,updated_at,legacy_data'),
      fetchAll('activity_log', 'id,user_id,action,task_id,task_title,metadata,created_at,legacy_data,task:tasks(task_key)'),
    ]);

    cache.profiles.clear();
    cache.profileIdsByName.clear();
    for (const profile of profiles) {
      cache.profiles.set(profile.id, profile);
      if (profile.full_name) cache.profileIdsByName.set(normalizedName(profile.full_name), profile.id);
    }

    cache.spaces.clear();
    cache.spaceIdsByKey.clear();
    for (const space of spaces) {
      cache.spaces.set(space.id, space);
      cache.spaceIdsByKey.set(space.key, space.id);
    }

    const commentsByTask = new Map();
    cache.comments.clear();
    cache.commentHashes.clear();
    for (const row of comments) {
      const comment = commentFromRow(row);
      if (!commentsByTask.has(row.task_id)) commentsByTask.set(row.task_id, []);
      commentsByTask.get(row.task_id).push(comment);
      cache.comments.set(row.id, { ...row, localId: comment.id });
      cache.commentHashes.set(row.id, commentHash(comment));
    }
    for (const taskComments of commentsByTask.values()) {
      taskComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const parentKeyById = new Map(tasks.map(row => [row.id, row.task_key]));
    const localTasks = tasks.map(row => taskFromRow(row, parentKeyById, commentsByTask));
    cache.tasks.clear();
    cache.taskHashes.clear();
    for (const task of localTasks) {
      cache.tasks.set(task._supabaseId, task);
      cache.taskHashes.set(task._supabaseId, taskHash(task));
    }

    const sharedDefinitions = Object.fromEntries(
      spaces
        .filter(space => space.type === 'shared')
        .map(space => [space.key, { name: space.name, color: space.color || '#617a9d' }]),
    );
    const access = Object.fromEntries(spaces.map(space => [space.key, []]));
    for (const member of members) {
      const key = cache.spaces.get(member.space_id)?.key;
      const name = profileName(member.user_id);
      if (key && name) access[key].push(name);
    }

    const adminNames = roles
      .filter(row => row.role === 'admin' || row.role === 'main_admin')
      .map(row => profileName(row.user_id))
      .filter(Boolean);
    const localActivity = activity.map(activityFromRow);

    localStorage.setItem(TASK_KEY, JSON.stringify(localTasks));
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(localActivity));
    localStorage.setItem(SHARED_SPACES_KEY, JSON.stringify(sharedDefinitions));
    localStorage.setItem(SPACE_ACCESS_KEY, JSON.stringify(access));
    localStorage.setItem(ADMIN_KEY, JSON.stringify(adminNames));
    localStorage.setItem(APPROVER_KEY, JSON.stringify([
      ...new Set(localTasks.map(task => task.approver).filter(Boolean)),
    ]));

    cache.activityIds = new Set(localActivity.map(entry => entry.id));
    cache.ready = true;
    window.SHG_REMOTE_READY = true;
    window.dispatchEvent(new CustomEvent('shg:remote-ready', {
      detail: { tasks: localTasks.length, comments: comments.length, spaces: spaces.length },
    }));
    return { remote: true, tasks: localTasks.length, comments: comments.length, spaces: spaces.length };
  }

  function taskPayload(task) {
    return {
      task_key: task.id,
      title: String(task.title || task.id),
      space_id: cache.spaceIdsByKey.get(task.project),
      status: task.status || 'backlog',
      jira_status: task.jiraStatus || null,
      priority: task.priority || null,
      assignee_id: profileId(task.assignee),
      supervisor_id: profileId(task.supervisor),
      approver_id: profileId(task.approver),
      description: task.description || null,
      issue_type: task.issueType || (task.parent ? 'Subtask' : 'Task'),
      due_date: task.dueDate ? String(task.dueDate).slice(0, 10) : null,
      labels: Array.isArray(task.labels) ? task.labels : [],
      cancellation_reason: task.cancellationReason || null,
      created_by_id: profileId(task.creator) || session()?.user?.id || null,
      audit: Array.isArray(task.audit) ? task.audit : [],
      is_mini_task: Boolean(task.isMiniTask),
      manual_order: null,
      created_at: task.created || new Date().toISOString(),
      updated_at: task.updated || new Date().toISOString(),
      legacy_data: publicTask(task),
    };
  }

  async function syncComments(task) {
    const taskId = task._supabaseId;
    const current = Array.isArray(task.comments) ? task.comments : [];
    const currentRemoteIds = new Set(current.map(comment => comment._supabaseId).filter(Boolean));
    const existingForTask = [...cache.comments.values()].filter(row => row.task_id === taskId);

    for (const row of existingForTask) {
      if (!currentRemoteIds.has(row.id)) {
        await request(`/rest/v1/task_comments?id=eq.${row.id}`, {
          method: 'DELETE',
          headers: { Prefer: 'return=minimal' },
        });
        cache.comments.delete(row.id);
        cache.commentHashes.delete(row.id);
      }
    }

    for (const comment of current) {
      const payload = {
        task_id: taskId,
        author_id: profileId(comment.author),
        content: String(comment.text || ' '),
        created_at: comment.createdAt || new Date().toISOString(),
        updated_at: comment.createdAt || new Date().toISOString(),
        legacy_data: (() => {
          const clone = safeClone(comment) || {};
          delete clone._supabaseId;
          delete clone.pending;
          return clone;
        })(),
      };
      const hash = commentHash(comment);
      if (comment._supabaseId) {
        if (cache.commentHashes.get(comment._supabaseId) !== hash) {
          await request(`/rest/v1/task_comments?id=eq.${comment._supabaseId}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(payload),
          });
          cache.commentHashes.set(comment._supabaseId, hash);
        }
        continue;
      }
      const inserted = await request('/rest/v1/task_comments?select=id', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });
      const id = inserted?.[0]?.id;
      if (id) {
        comment._supabaseId = id;
        cache.comments.set(id, { id, task_id: taskId, localId: comment.id });
        cache.commentHashes.set(id, commentHash(comment));
      }
    }
  }

  async function upsertTask(task) {
    const payload = taskPayload(task);
    if (!payload.space_id) throw new Error(`Unknown Space for task ${task.id}`);
    let id = task._supabaseId;
    if (id) {
      const updated = await request(`/rest/v1/tasks?id=eq.${id}&select=id,task_key`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });
      id = updated?.[0]?.id || id;
    } else {
      const inserted = await request('/rest/v1/tasks?on_conflict=task_key&select=id,task_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload),
      });
      id = inserted?.[0]?.id;
      if (!id) throw new Error(`Task ${task.id} was not saved`);
      task._supabaseId = id;
    }
    cache.tasks.set(id, task);
    await syncComments(task);
    cache.taskHashes.set(id, taskHash(task));
  }

  async function syncTasks(tasks, activity = []) {
    if (!cache.ready || cache.syncing) {
      cache.queued = true;
      return;
    }
    cache.syncing = true;
    cache.queued = false;
    try {
      const currentRemoteIds = new Set(tasks.map(task => task._supabaseId).filter(Boolean));
      for (const [id] of cache.tasks) {
        if (!currentRemoteIds.has(id)) {
          await request(`/rest/v1/tasks?id=eq.${id}`, {
            method: 'DELETE',
            headers: { Prefer: 'return=minimal' },
          });
          cache.tasks.delete(id);
          cache.taskHashes.delete(id);
        }
      }

      const changed = tasks.filter(task => (
        !task._supabaseId || cache.taskHashes.get(task._supabaseId) !== taskHash(task)
      ));
      for (const task of changed) await upsertTask(task);

      const idByKey = new Map(tasks.map(task => [task.id, task._supabaseId]).filter(([, id]) => id));
      for (const task of changed) {
        const desiredParentId = task.parent ? idByKey.get(task.parent) || null : null;
        await request(`/rest/v1/tasks?id=eq.${task._supabaseId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ parent_id: desiredParentId }),
        });
      }

      for (const entry of activity) {
        if (!entry?.id || cache.activityIds.has(entry.id)) continue;
        await request('/rest/v1/activity_log', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: session()?.user?.id || null,
            action: entry.action || 'Activity',
            task_id: idByKey.get(entry.taskId) || null,
            task_title: entry.taskTitle || null,
            metadata: { role: entry.role || null },
            created_at: entry.at || new Date().toISOString(),
            legacy_data: entry,
          }),
        });
        cache.activityIds.add(entry.id);
      }

      localStorage.setItem(TASK_KEY, JSON.stringify(tasks));
      window.dispatchEvent(new CustomEvent('shg:remote-saved', { detail: { changed: changed.length } }));
    } catch (error) {
      console.error('SHG remote sync failed', error);
      window.dispatchEvent(new CustomEvent('shg:remote-error', { detail: { message: error.message } }));
    } finally {
      cache.syncing = false;
      if (cache.queued) setTimeout(() => syncTasks(tasks, activity), 50);
    }
  }

  function queueSync(tasks, activity) {
    if (!cache.ready) return;
    clearTimeout(cache.timer);
    cache.timer = setTimeout(() => syncTasks(tasks, activity), 250);
  }

  window.shgPrepareRemoteData = loadRemoteData;
  window.shgQueueRemoteSync = queueSync;
  window.shgFlushRemoteSync = syncTasks;
})();
