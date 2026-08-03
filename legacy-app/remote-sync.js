(() => {
  const TASK_KEY = 'shg-tasks-v5';
  const ACTIVITY_KEY = 'shg-activity-log';
  const SHARED_SPACES_KEY = 'shg-shared-space-definitions';
  const SPACE_ACCESS_KEY = 'shg-space-access';
  const ADMIN_KEY = 'shg-administrators';
  const APPROVER_KEY = 'shg-approvers';
  const DELETED_TASKS_KEY = 'shg-deleted-task-ids';
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
    retryTimer: null,
    retryDelay: 3000,
  };
  let prepareRetryTimer = null;

  function session() {
    return window.shgGetSupabaseSession?.() || null;
  }

  function enabled() {
    return Boolean(session()?.access_token && window.SHG_SUPABASE_URL && window.SHG_SUPABASE_KEY);
  }

  function safeLocalSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      window.SHG_LOCAL_CACHE_FULL = true;
      console.warn(`Local cache skipped for ${key}`, error);
      return false;
    }
  }

  function taskForLocalCache(task) {
    const clone = safeClone(task) || {};
    if (!clone._supabaseId) return clone;
    for (const comment of clone.comments || []) {
      if (!Array.isArray(comment.images)) continue;
      comment.images = comment.images.filter(source => !String(source || '').startsWith('data:'));
    }
    return clone;
  }

  function writeTaskCache(tasks) {
    return safeLocalSet(TASK_KEY, JSON.stringify((tasks || []).map(taskForLocalCache)));
  }

  function headers(extra = {}, accessToken = session()?.access_token || '') {
    return {
      apikey: window.SHG_SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT);
    try {
      const activeSession = await window.shgEnsureFreshSession?.(60 * 1000) || session();
      if (!activeSession?.access_token) throw new Error('The shared database connection is temporarily unavailable.');
      const response = await fetch(`${window.SHG_SUPABASE_URL}${path}`, {
        ...options,
        headers: headers(options.headers, activeSession.access_token),
        signal: controller.signal,
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const error = new Error(body?.message || body?.error_description || body?.hint || `Database request failed (${response.status})`);
        error.status = response.status;
        error.code = body?.code || '';
        throw error;
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
      let page;
      try {
        page = await request(`/rest/v1/${table}?select=${encodeURIComponent(select)}${separator}`, {
          headers: { Range: `${start}-${start + size - 1}` },
        });
      } catch (error) {
        error.message = `${table}: ${error.message}`;
        throw error;
      }
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
      targetStartDate: row.target_start_date || legacy.targetStartDate || null,
      unblockingDate: row.unblocking_date || legacy.unblockingDate || null,
      disableMainAdminReminders: Boolean(row.disable_main_admin_reminders ?? legacy.disableMainAdminReminders),
      lastHumanActivityAt: row.last_human_activity_at || legacy.lastHumanActivityAt || row.created_at,
      lastStatusChangedAt: row.last_status_changed_at || legacy.lastStatusChangedAt || row.created_at,
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
    let rawPendingLocalTasks = [];
    let deletedTaskKeys = new Set();
    try {
      rawPendingLocalTasks = (JSON.parse(localStorage.getItem(TASK_KEY)) || [])
        .filter(task => task && !task._supabaseId);
    } catch {}
    try {
      deletedTaskKeys = new Set(JSON.parse(localStorage.getItem(DELETED_TASKS_KEY)) || []);
    } catch {}

    const core = await Promise.all([
      fetchAll('profiles', 'id,full_name,email,initials,is_active,last_login,voice_names,aliases'),
      fetchAll('user_roles', 'user_id,role'),
      fetchAll('spaces', 'id,key,name,color,type,owner_id'),
      fetchAll('space_members', 'space_id,user_id'),
      fetchAll('tasks', 'id,task_key,title,space_id,status,jira_status,priority,assignee_id,supervisor_id,approver_id,description,issue_type,parent_id,created_at,updated_at,due_date,target_start_date,unblocking_date,disable_main_admin_reminders,last_human_activity_at,last_status_changed_at,labels,cancellation_reason,created_by_id,audit,is_mini_task,manual_order,legacy_data'),
    ]);
    const optional = await Promise.allSettled([
      fetchAll('task_comments', 'id,task_id,author_id,content,created_at,updated_at,legacy_data'),
      fetchAll('app_settings', 'current_approver_id', 'id=eq.true'),
    ]);
    const [profiles, roles, spaces, members, tasks] = core;
    const comments = optional[0].status === 'fulfilled' ? optional[0].value : [];
    const settings = optional[1].status === 'fulfilled' ? optional[1].value : [];
    for (const result of optional) {
      if (result.status === 'rejected') console.warn('Optional shared data unavailable', result.reason);
    }

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
    const allRemoteTasks = tasks.map(row => taskFromRow(row, parentKeyById, commentsByTask));
    const tombstonedRemoteTasks = allRemoteTasks.filter(task => deletedTaskKeys.has(task.id));
    const localTasks = allRemoteTasks.filter(task => !deletedTaskKeys.has(task.id));
    const currentProfileName = profileName(session()?.user?.id);
    if (currentProfileName) window.SHG_AUTH_USER_NAME = currentProfileName;
    window.SHG_USER_EMAILS = Object.fromEntries(profiles.filter(profile=>profile.full_name&&profile.email).map(profile=>[profile.full_name,profile.email]));
    const remoteTaskKeys = new Set(localTasks.map(task => task.id));
    const pendingByKey = new Map();
    for (const task of rawPendingLocalTasks) {
      if (deletedTaskKeys.has(task.id)) continue;
      if (!task.id || remoteTaskKeys.has(task.id)) continue;
      if (normalizedName(task.creator) !== normalizedName(currentProfileName)) continue;
      if (!cache.spaceIdsByKey.has(task.project)) continue;
      const previous = pendingByKey.get(task.id);
      const previousUpdated = new Date(previous?.updated || previous?.createdAt || 0).getTime();
      const taskUpdated = new Date(task.updated || task.createdAt || 0).getTime();
      if (!previous || taskUpdated >= previousUpdated) pendingByKey.set(task.id, task);
    }
    const pendingLocalTasks = [...pendingByKey.values()];
    for (const task of pendingLocalTasks) {
      localTasks.unshift(task);
    }
    cache.tasks.clear();
    cache.taskHashes.clear();
    for (const task of allRemoteTasks) {
      if (!task._supabaseId) continue;
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
    const mainAdminNames = roles
      .filter(row => row.role === 'main_admin')
      .map(row => profileName(row.user_id))
      .filter(Boolean);
    const localActivity = [];
    const currentApproverName = profileName(settings[0]?.current_approver_id) ||
      [...new Set(localTasks.map(task => task.approver).filter(Boolean))][0] ||
      '';
    const approverNames = currentApproverName ? [currentApproverName] : [];

    window.SHG_REMOTE_BOOTSTRAP = {
      profiles: profiles.filter(profile => profile.is_active !== false).map(profile => ({id:profile.id,name:profile.full_name,email:profile.email||'',initials:profile.initials||'',voiceNames:profile.voice_names||[],aliases:profile.aliases||[]})),
      tasks: localTasks,
      activity: localActivity,
      sharedSpaces: sharedDefinitions,
      spaceAccess: access,
      adminNames,
      mainAdminNames,
      approverNames,
      currentApproverName,
    };
    writeTaskCache(localTasks);
    safeLocalSet(ACTIVITY_KEY, JSON.stringify(localActivity));
    safeLocalSet(SHARED_SPACES_KEY, JSON.stringify(sharedDefinitions));
    safeLocalSet(SPACE_ACCESS_KEY, JSON.stringify(access));
    safeLocalSet(ADMIN_KEY, JSON.stringify(adminNames));
    safeLocalSet(APPROVER_KEY, JSON.stringify(approverNames));

    cache.activityIds = new Set(localActivity.map(entry => entry.id));
    cache.ready = true;
    window.SHG_REMOTE_READY = true;
    window.dispatchEvent(new CustomEvent('shg:remote-ready', {
      detail: { tasks: localTasks.length, comments: comments.length, spaces: spaces.length },
    }));
    // The activity history is not needed to paint the task workspace. Load it
    // after the interactive shell is ready, then hydrate the Activity tab.
    fetchAll('activity_log', 'id,user_id,action,task_id,task_title,metadata,created_at,legacy_data,task:tasks(task_key)')
      .then(rows => {
        const deferredActivity = rows.map(activityFromRow);
        window.SHG_REMOTE_BOOTSTRAP.activity = deferredActivity;
        safeLocalSet(ACTIVITY_KEY, JSON.stringify(deferredActivity));
        cache.activityIds = new Set(deferredActivity.map(entry => entry.id));
        window.dispatchEvent(new CustomEvent('shg:activity-ready', { detail: deferredActivity }));
      })
      .catch(error => console.warn('Activity history unavailable', error));
    if (pendingLocalTasks.length || tombstonedRemoteTasks.length) {
      setTimeout(() => syncTasks(localTasks, localActivity), 0);
    }
    return { remote: true, tasks: localTasks.length, comments: comments.length, spaces: spaces.length };
  }

  async function prepareRemoteData() {
    try {
      const result = await loadRemoteData();
      if (prepareRetryTimer) {
        clearTimeout(prepareRetryTimer);
        prepareRetryTimer = null;
      }
      return result;
    } catch (error) {
      if (enabled() && !prepareRetryTimer) {
        prepareRetryTimer = setTimeout(async () => {
          prepareRetryTimer = null;
          try {
            await prepareRemoteData();
            if (window.SHG_APP_LOADED) location.reload();
          } catch {}
        }, 3000);
      }
      throw error;
    }
  }

  function incrementTaskKey(taskKey) {
    const match = String(taskKey || '').match(/^(.*?)-(\d+)$/);
    if (!match) return `${taskKey}-2`;
    return `${match[1]}-${Number(match[2]) + 1}`;
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
      target_start_date: task.targetStartDate ? String(task.targetStartDate).slice(0, 10) : null,
      unblocking_date: task.unblockingDate ? String(task.unblockingDate).slice(0, 10) : null,
      disable_main_admin_reminders: Boolean(task.disableMainAdminReminders),
      last_human_activity_at: task.lastHumanActivityAt || task.created || new Date().toISOString(),
      last_status_changed_at: task.lastStatusChangedAt || task.created || new Date().toISOString(),
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
        if (
          !comment.system &&
          !comment.automationType &&
          typeof window.shgInvokeFunction === 'function'
        ) {
          try {
            await window.shgInvokeFunction('send-mention-email', {
              notificationType: 'comment',
              taskId,
              commentId: id,
            });
          } catch (notificationError) {
            console.warn(
              `Comment ${id} was saved, but its email delivery was deferred`,
              notificationError,
            );
          }
        }
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
      let inserted = null;
      let candidateKey = payload.task_key;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        payload.task_key = candidateKey;
        if (payload.legacy_data) payload.legacy_data.id = candidateKey;
        try {
          inserted = await request('/rest/v1/tasks?select=id,task_key', {
            method: 'POST',
            headers: { Prefer: 'return=representation' },
            body: JSON.stringify(payload),
          });
          break;
        } catch (error) {
          if (error.status !== 409 && error.code !== '23505') throw error;
          candidateKey = incrementTaskKey(candidateKey);
        }
      }
      id = inserted?.[0]?.id;
      if (!id) throw new Error(`Task ${task.id} was not saved`);
      task.id = inserted[0].task_key;
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

      writeTaskCache(tasks);
      if (cache.retryTimer) {
        clearTimeout(cache.retryTimer);
        cache.retryTimer = null;
      }
      cache.retryDelay = 3000;
      window.dispatchEvent(new CustomEvent('shg:remote-saved', { detail: { changed: changed.length } }));
    } catch (error) {
      console.error('SHG remote sync failed', error);
      window.dispatchEvent(new CustomEvent('shg:remote-error', { detail: { message: error.message } }));
      if (!cache.retryTimer) {
        const retryIn = cache.retryDelay;
        cache.retryDelay = Math.min(cache.retryDelay * 2, 30000);
        cache.retryTimer = setTimeout(() => {
          cache.retryTimer = null;
          syncTasks(tasks, activity);
        }, retryIn);
      }
    } finally {
      cache.syncing = false;
      if (cache.queued) setTimeout(() => syncTasks(tasks, activity), 50);
    }
  }

  function queueSync(tasks, activity) {
    if (!cache.ready) {
      cache.queued = true;
      return;
    }
    clearTimeout(cache.timer);
    cache.timer = setTimeout(() => syncTasks(tasks, activity), 250);
  }

  async function saveUserSettings({ adminNames = [], approverName, spaceAccess = {} } = {}) {
    if (!enabled() || !cache.ready) throw new Error('The shared database is not ready');
    const approverId = profileId(approverName);
    if (!approverId) throw new Error('The selected Approver was not found');
    const adminIds = adminNames.map(profileId).filter(Boolean);
    const accessById = {};
    for (const [spaceKey, names] of Object.entries(spaceAccess || {})) {
      if (!cache.spaceIdsByKey.has(spaceKey)) continue;
      accessById[spaceKey] = (names || []).map(profileId).filter(Boolean);
    }
    await request('/rest/v1/rpc/save_user_settings', {
      method: 'POST',
      body: JSON.stringify({
        admin_user_ids: adminIds,
        selected_approver_id: approverId,
        shared_space_access: accessById,
      }),
    });
    await loadRemoteData();
    return true;
  }

  window.shgPrepareRemoteData = prepareRemoteData;
  window.shgQueueRemoteSync = queueSync;
  window.shgFlushRemoteSync = syncTasks;
  window.shgSafeLocalSet = safeLocalSet;
  window.shgWriteTaskCache = writeTaskCache;
  window.shgSaveUserSettings = saveUserSettings;
})();
