(() => {
  const TASK_KEY = 'shg-tasks-v5';
  const ACTIVITY_KEY = 'shg-activity-log';
  const SHARED_SPACES_KEY = 'shg-shared-space-definitions';
  const SPACE_ACCESS_KEY = 'shg-space-access';
  const ADMIN_KEY = 'shg-administrators';
  const APPROVER_KEY = 'shg-approvers';
  const ROLE_CACHE_KEY = 'mailo-role-by-name';
  const DELETED_TASKS_KEY = 'shg-deleted-task-ids';
  const REMOTE_TIMEOUT = 20000;
  const COMMENT_FALLBACK_INTERVAL = 15000;

  const cache = {
    tasks: new Map(),
    taskHashes: new Map(),
    comments: new Map(),
    commentHashes: new Map(),
    profiles: new Map(),
    profileIdsByName: new Map(),
    rolesByProfileId: new Map(),
    spaces: new Map(),
    spaceIdsByKey: new Map(),
    taskCreatedByIds: new Map(),
    taskCreatorNames: new Map(),
    taskUpdatedAts: new Map(),
    activityIds: new Set(),
    ready: false,
    syncing: false,
    queued: false,
    timer: null,
    retryTimer: null,
    retryDelay: 3000,
  };
  let prepareRetryTimer = null;
  let realtimeClient = null;
  let realtimeChannel = null;
  let realtimeReconnectTimer = null;
  let realtimeReconnectDelay = 2000;
  let realtimeConnected = false;
  let realtimeStarting = false;
  let commentHistoryReady = false;
  let commentFallbackTimer = null;
  let commentFallbackRunning = false;
  let lastCommentSyncAt = '';
  let privatePreferences = {};
  const privateTaskStars = new Set();

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
    if (!task?._supabaseId) {
      const clone = safeClone(task) || {};
      delete clone.starredBy;
      return clone;
    }
    const { comments = [], ...withoutComments } = task;
    const clone = safeClone(withoutComments) || {};
    delete clone.starredBy;
    // The shared database is the source of truth for synced comments. Keeping
    // thousands of them (and their attachments) in localStorage made normal
    // browser profiles stall while a clean Private/Incognito profile worked.
    // Retain only comments which have not reached the shared database yet.
    clone.comments = comments
      .filter(comment => !comment?._supabaseId)
      .map(comment => safeClone(comment) || {});
    for (const comment of clone.comments) {
      if (!Array.isArray(comment.images)) continue;
      comment.images = comment.images.filter(source => !String(source || '').startsWith('data:'));
      comment.attachments = (comment.attachments || []).filter(file => !String(file?.data || '').startsWith('data:'));
      if (String(comment.audioMessage?.data || '').startsWith('data:')) delete comment.audioMessage;
    }
    return clone;
  }

  function writeTaskCache(tasks) {
    const cachedTasks = (tasks || []).map(taskForLocalCache);
    let payload = JSON.stringify(cachedTasks);
    if (payload.length > 1200000) {
      // Production always reloads synchronized tasks from Supabase. When the
      // fallback cache grows too large, retain only unsynchronized work rather
      // than filling browser storage and preventing authentication persistence.
      payload = JSON.stringify(cachedTasks.filter(task => !task._supabaseId));
    }
    return safeLocalSet(TASK_KEY, payload);
  }

  function headers(extra = {}, accessToken = session()?.access_token || '') {
    return {
      apikey: window.SHG_SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Mailo-Version': '78',
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
        const rawMessage = body?.message || body?.error_description || body?.hint || `Database request failed (${response.status})`;
        const readableMessage = body?.code === '42501' && path.includes('/tasks')
          ? 'This Task could not be saved because your current account does not have permission for the requested change. Refresh the page and try again.'
          : rawMessage;
        const error = new Error(readableMessage);
        error.status = response.status;
        error.code = body?.code || '';
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timeout);
    }
  }

  const yieldToBrowser = () => new Promise(resolve => setTimeout(resolve, 0));

  async function fetchAll(table, select = '*', extra = '', options = {}) {
    const rows = [];
    const size = Number(options.pageSize) || 1000;
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
      if (options.yieldBetweenPages) await yieldToBrowser();
    }
  }

  function normalizedName(value) {
    return String(value || '').trim().toLocaleLowerCase('en');
  }

  function safeClone(value) {
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function publicTask(task) {
    // Comments live in task_comments. Excluding them here prevents every chat
    // message from duplicating the full history in tasks.legacy_data and from
    // making the whole Task appear changed.
    const { comments, ...metadata } = task || {};
    const clone = safeClone(metadata) || {};
    delete clone._supabaseId;
    // Stars are private user preferences. Never copy another user's star map
    // into the shared Task row or browser Task cache.
    delete clone.starredBy;
    return clone;
  }

  function hydratePrivatePreferences(preferences) {
    privatePreferences = preferences && typeof preferences === 'object'
      ? safeClone(preferences) || {}
      : {};
    privateTaskStars.clear();
    const savedStars = privatePreferences.mailo_starred_tasks;
    if (savedStars && typeof savedStars === 'object') {
      for (const [taskId, value] of Object.entries(savedStars)) {
        if (value) privateTaskStars.add(taskId);
      }
    }
    window.SHG_PRIVATE_TASK_STARS = [...privateTaskStars];
  }

  function taskHash(task) {
    // Keep comments out of legacy_data, but retain a lightweight signature so a
    // comment-only Save still triggers syncComments without hashing attachments.
    const comments = (task?.comments || []).map(comment => [
      comment?._supabaseId || comment?.id || '',
      comment?.createdAt || '',
      comment?.editedAt || comment?.updatedAt || '',
      comment?.text || '',
      Boolean(comment?.pending),
      (comment?.images || []).length,
      (comment?.attachments || []).map(file => [file?.name || '', file?.size || 0, file?.type || '']),
      comment?.audioMessage ? [comment.audioMessage.duration || 0, String(comment.audioMessage.url || '').slice(-80), String(comment.audioMessage.data || '').length] : null,
      comment?.scheduledAt || '',
      comment?.scheduleStatus || '',
    ]);
    return JSON.stringify({ task: publicTask(task), comments });
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
    delete task.starredBy;
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

  function latestTimestamp(current, candidate) {
    if (!candidate) return current || '';
    if (!current) return candidate;
    return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
  }

  function emitCommentChange(type, row, dispatch = true) {
    if (!row) return;
    const remoteTask = cache.tasks.get(row.task_id);
    const taskId = remoteTask?.id || '';
    if (!taskId) return;
    const comment = type === 'DELETE' ? null : commentFromRow(row);
    if (type === 'DELETE') {
      cache.comments.delete(row.id);
      cache.commentHashes.delete(row.id);
    } else {
      cache.comments.set(row.id, { ...row, localId: comment.id });
      cache.commentHashes.set(row.id, commentHash(comment));
      lastCommentSyncAt = latestTimestamp(lastCommentSyncAt, row.updated_at || row.created_at);
    }
    const detail = { type, taskId, comment, remoteId: row.id };
    if (dispatch) window.dispatchEvent(new CustomEvent('shg:comment-change', { detail }));
    return detail;
  }

  async function hydrateRemoteComments(tasks) {
    const requestedAt = Date.now();
    const rows = await fetchAll(
      'task_comments',
      'id,task_id,author_id,content,created_at,updated_at,legacy_data',
      '',
      { pageSize: 200, yieldBetweenPages: true },
    );
    const byTask = new Map();
    cache.comments.clear();
    cache.commentHashes.clear();
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const comment = commentFromRow(row);
      if (!byTask.has(row.task_id)) byTask.set(row.task_id, []);
      byTask.get(row.task_id).push(comment);
      cache.comments.set(row.id, { ...row, localId: comment.id });
      cache.commentHashes.set(row.id, commentHash(comment));
      lastCommentSyncAt = latestTimestamp(lastCommentSyncAt, row.updated_at || row.created_at);
      if (index > 0 && index % 200 === 0) await yieldToBrowser();
    }
    for (const comments of byTask.values()) {
      comments.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }
    for (let index = 0; index < tasks.length; index += 1) {
      const task = tasks[index];
      const remote = byTask.get(task._supabaseId) || [];
      const known = new Set(remote.map(comment => comment.id));
      const locallyNew = (task.comments || []).filter(comment => {
        if (known.has(comment.id)) return false;
        if (!comment._supabaseId) return true;
        return new Date(comment.createdAt || 0).getTime() >= requestedAt - 1000;
      });
      task.comments = [...remote, ...locallyNew]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      if (task._supabaseId) cache.taskHashes.set(task._supabaseId, taskHash(task));
      if (index > 0 && index % 100 === 0) await yieldToBrowser();
    }
    commentHistoryReady = true;
    writeTaskCache(tasks);
    window.dispatchEvent(new CustomEvent('shg:comments-ready', {
      detail: { tasks, comments: rows.length },
    }));
    return rows;
  }

  let deferredHistoryScheduled = false;

  async function hydrateRemoteActivity() {
    const rows = await fetchAll(
      'activity_log',
      'id,user_id,action,task_id,task_title,metadata,created_at,legacy_data,task:tasks(task_key)',
      '',
      { pageSize: 200, yieldBetweenPages: true },
    );
    const deferredActivity = [];
    for (let index = 0; index < rows.length; index += 1) {
      deferredActivity.push(activityFromRow(rows[index]));
      if (index > 0 && index % 200 === 0) await yieldToBrowser();
    }
    window.SHG_REMOTE_BOOTSTRAP.activity = deferredActivity;
    // Keep the complete history in memory for the Activity tab, but only a
    // compact fallback in browser storage. Supabase remains the source of truth.
    safeLocalSet(ACTIVITY_KEY, JSON.stringify(deferredActivity.slice(0, 250)));
    cache.activityIds = new Set(deferredActivity.map(entry => entry.id));
    window.dispatchEvent(new CustomEvent('shg:activity-ready', { detail: deferredActivity }));
  }

  function scheduleDeferredHistory(tasks) {
    if (deferredHistoryScheduled) return;
    deferredHistoryScheduled = true;
    const start = () => {
      hydrateRemoteComments(tasks)
        .catch(error => {
          console.warn('Task Chat history unavailable', error);
          // Start from now when the historical request is temporarily unavailable.
          // This prevents a fallback reconnect from replaying the whole table.
          lastCommentSyncAt = new Date().toISOString();
          commentHistoryReady = true;
        })
        .finally(() => startRealtimeComments());
      const startActivity = () => hydrateRemoteActivity()
        .catch(error => console.warn('Activity history unavailable', error));
      if ('requestIdleCallback' in window) requestIdleCallback(startActivity, { timeout: 5000 });
      else setTimeout(startActivity, 750);
    };
    if (window.SHG_APP_LOADED) start();
    else window.addEventListener('shg:app-ready', start, { once: true });
  }

  async function loadRemoteData() {
    if (!enabled()) return { remote: false };
    commentHistoryReady = false;
    let rawLocalTasks = [];
    let rawPendingLocalTasks = [];
    let deletedTaskKeys = new Set();
    try {
      rawLocalTasks = JSON.parse(localStorage.getItem(TASK_KEY)) || [];
      for (const task of rawLocalTasks) if (task && typeof task === 'object') delete task.starredBy;
      rawPendingLocalTasks = rawLocalTasks.filter(task => task && !task._supabaseId);
    } catch {}
    try {
      deletedTaskKeys = new Set(JSON.parse(localStorage.getItem(DELETED_TASKS_KEY)) || []);
    } catch {}

    const profilesRequest = fetchAll('profiles', 'id,full_name,email,initials,is_active,last_login,voice_names,aliases');
    const rolesRequest = fetchAll('user_roles', 'user_id,role');
    const spacesRequest = fetchAll('spaces', 'id,key,name,color,type,owner_id');
    const membersRequest = fetchAll('space_members', 'space_id,user_id');
    const tasksRequest = fetchAll('tasks', 'id,task_key,title,space_id,status,jira_status,priority,assignee_id,supervisor_id,approver_id,description,issue_type,parent_id,created_at,updated_at,due_date,target_start_date,unblocking_date,disable_main_admin_reminders,last_human_activity_at,last_status_changed_at,labels,cancellation_reason,created_by_id,audit,is_mini_task,manual_order,legacy_data');
    Promise.all([profilesRequest, rolesRequest]).then(([earlyProfiles, earlyRoles]) => {
      const names = new Map(earlyProfiles.map(profile => [profile.id, profile.full_name || '']));
      const earlyRoleByName = Object.fromEntries(earlyRoles.map(row => [names.get(row.user_id), row.role]).filter(([name]) => Boolean(name)));
      safeLocalSet(ROLE_CACHE_KEY, JSON.stringify(earlyRoleByName));
      const currentName = names.get(session()?.user?.id) || '';
      const role = currentName === 'Victor Stavropoulos' ? 'main_admin' : earlyRoleByName[currentName];
      const roleElement = document.getElementById('roleLabel');
      if (currentName) window.SHG_AUTH_USER_NAME = currentName;
      if (roleElement && role) roleElement.textContent = role === 'main_admin' ? 'Main Admin' : role === 'admin' ? 'Admin' : 'User';
    }).catch(() => {});
    const core = await Promise.all([profilesRequest, rolesRequest, spacesRequest, membersRequest, tasksRequest]);
    const optional = await Promise.allSettled([
      fetchAll('app_settings', 'current_approver_id', 'id=eq.true'),
      fetchAll('user_preferences', 'user_id,preferences,updated_at', `user_id=eq.${encodeURIComponent(session()?.user?.id || '')}`),
    ]);
    const [profiles, roles, spaces, members, tasks] = core;
    const settings = optional[0].status === 'fulfilled' ? optional[0].value : [];
    const preferenceRows = optional[1].status === 'fulfilled' ? optional[1].value : [];
    for (const result of optional) {
      if (result.status === 'rejected') console.warn('Optional shared data unavailable', result.reason);
    }

    cache.profiles.clear();
    cache.profileIdsByName.clear();
    for (const profile of profiles) {
      cache.profiles.set(profile.id, profile);
      if (profile.full_name) cache.profileIdsByName.set(normalizedName(profile.full_name), profile.id);
    }
    cache.rolesByProfileId.clear();
    const roleRank = { user: 1, admin: 2, main_admin: 3 };
    for (const row of roles) {
      const current = cache.rolesByProfileId.get(row.user_id);
      if ((roleRank[row.role] || 0) >= (roleRank[current] || 0)) {
        cache.rolesByProfileId.set(row.user_id, row.role);
      }
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
    for (const localTask of rawLocalTasks) {
      if (!localTask?._supabaseId || !Array.isArray(localTask.comments)) continue;
      commentsByTask.set(localTask._supabaseId, localTask.comments);
      for (const comment of localTask.comments) {
        if (!comment?._supabaseId) continue;
        cache.comments.set(comment._supabaseId, { id: comment._supabaseId, task_id: localTask._supabaseId, localId: comment.id });
        cache.commentHashes.set(comment._supabaseId, commentHash(comment));
      }
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
      const pendingSpaceId = cache.spaceIdsByKey.get(task.project);
      if (!pendingSpaceId) continue;
      const requestedCreatorId = profileId(task.creator);
      const authenticatedId = session()?.user?.id || null;
      const mayResumeViewAsCreation = authenticatedCanCreateForOthers()
        && requestedCreatorId
        && (!isPersonalSpaceId(pendingSpaceId) || currentProfileName === 'Victor Stavropoulos');
      if (requestedCreatorId !== authenticatedId && !mayResumeViewAsCreation) continue;
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
    cache.taskCreatedByIds.clear();
    cache.taskCreatorNames.clear();
    cache.taskUpdatedAts.clear();
    for (const [index, task] of allRemoteTasks.entries()) {
      if (!task._supabaseId) continue;
      const row = tasks[index];
      cache.tasks.set(task._supabaseId, task);
      cache.taskHashes.set(task._supabaseId, taskHash(task));
      cache.taskCreatedByIds.set(task._supabaseId, row?.created_by_id || null);
      cache.taskCreatorNames.set(task._supabaseId, task.creator || '');
      cache.taskUpdatedAts.set(task._supabaseId, row?.updated_at || task.updated || null);
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
    const roleByName = Object.fromEntries(roles.map(row => [profileName(row.user_id), row.role]).filter(([name]) => Boolean(name)));
    safeLocalSet(ROLE_CACHE_KEY, JSON.stringify(roleByName));
    const localActivity = [];
    const currentApproverName = profileName(settings[0]?.current_approver_id) ||
      [...new Set(localTasks.map(task => task.approver).filter(Boolean))][0] ||
      '';
    const approverNames = currentApproverName ? [currentApproverName] : [];
    hydratePrivatePreferences(preferenceRows[0]?.preferences || {});

    window.SHG_REMOTE_BOOTSTRAP = {
      profiles: profiles.filter(profile => profile.is_active !== false).map(profile => ({id:profile.id,name:profile.full_name,email:profile.email||'',initials:profile.initials||'',voiceNames:profile.voice_names||[],aliases:profile.aliases||[]})),
      tasks: localTasks,
      activity: localActivity,
      sharedSpaces: sharedDefinitions,
      spaceAccess: access,
      adminNames,
      mainAdminNames,
      roleByName,
      approverNames,
      currentApproverName,
      privatePreferences,
      privateTaskStars: [...privateTaskStars],
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
      detail: { tasks: localTasks.length, comments: 'loading', spaces: spaces.length },
    }));
    // Full comment and activity history starts only after the interactive shell
    // has painted, and yields between small batches to keep clicks responsive.
    scheduleDeferredHistory(localTasks);
    if (pendingLocalTasks.length || tombstonedRemoteTasks.length) {
      setTimeout(() => syncTasks(localTasks, localActivity), 0);
    }
    return { remote: true, tasks: localTasks.length, comments: 'loading', spaces: spaces.length };
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

  async function fetchRemoteComments(since = '') {
    if (!enabled() || !cache.ready) return [];
    const extra = since ? `updated_at=gt.${encodeURIComponent(since)}&order=updated_at.asc` : '';
    const rows = await fetchAll('task_comments', 'id,task_id,author_id,content,created_at,updated_at,legacy_data', extra);
    return rows.map(row => ({
      taskId: cache.tasks.get(row.task_id)?.id || '',
      comment: commentFromRow(row),
      row,
    })).filter(item => item.taskId);
  }

  async function pollRecentComments() {
    if (commentFallbackRunning || !commentHistoryReady || !enabled() || !cache.ready || document.visibilityState !== 'visible') return;
    commentFallbackRunning = true;
    try {
      const entries = await fetchRemoteComments(lastCommentSyncAt);
      const changes = [];
      for (const entry of entries) {
        const detail = emitCommentChange(cache.comments.has(entry.row.id) ? 'UPDATE' : 'INSERT', entry.row, false);
        if (detail) changes.push(detail);
      }
      if (changes.length) {
        window.dispatchEvent(new CustomEvent('shg:comment-batch', { detail: { changes } }));
      }
    } catch (error) {
      if (!realtimeConnected) console.warn('Task Chat fallback sync unavailable', error);
    } finally {
      commentFallbackRunning = false;
    }
  }

  function scheduleRealtimeReconnect() {
    if (realtimeReconnectTimer || !enabled()) return;
    realtimeReconnectTimer = setTimeout(() => {
      realtimeReconnectTimer = null;
      startRealtimeComments();
    }, realtimeReconnectDelay);
    realtimeReconnectDelay = Math.min(realtimeReconnectDelay * 2, 30000);
  }

  async function startRealtimeComments() {
    if (!commentHistoryReady || realtimeStarting) return;
    if (!enabled() || !cache.ready || !window.supabase?.createClient) {
      if (!commentFallbackTimer) commentFallbackTimer = setInterval(pollRecentComments, COMMENT_FALLBACK_INTERVAL);
      return;
    }
    if (!commentFallbackTimer) commentFallbackTimer = setInterval(pollRecentComments, COMMENT_FALLBACK_INTERVAL);
    realtimeStarting = true;
    try {
      const activeSession = await window.shgEnsureFreshSession?.(60 * 1000) || session();
      if (!activeSession?.access_token) throw new Error('No active Task Chat session');
      if (!realtimeClient) {
        realtimeClient = window.supabase.createClient(window.SHG_SUPABASE_URL, window.SHG_SUPABASE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          realtime: { params: { eventsPerSecond: 20 } },
        });
      }
      await realtimeClient.realtime.setAuth(activeSession.access_token);
      if (realtimeChannel) await realtimeClient.removeChannel(realtimeChannel).catch(() => {});
      realtimeChannel = realtimeClient
        .channel('mailo-task-comments-v60')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, payload => {
          emitCommentChange(payload.eventType, payload.eventType === 'DELETE' ? payload.old : payload.new);
        })
        .subscribe(status => {
          realtimeConnected = status === 'SUBSCRIBED';
          window.dispatchEvent(new CustomEvent('shg:chat-connection', { detail: { status } }));
          if (realtimeConnected) {
            realtimeReconnectDelay = 2000;
            if (realtimeReconnectTimer) clearTimeout(realtimeReconnectTimer);
            realtimeReconnectTimer = null;
            pollRecentComments();
          } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
            scheduleRealtimeReconnect();
          }
        });
    } catch (error) {
      realtimeConnected = false;
      console.warn('Task Chat Realtime unavailable; fallback sync remains active', error);
      scheduleRealtimeReconnect();
    } finally {
      realtimeStarting = false;
    }
  }

  function incrementTaskKey(taskKey) {
    const match = String(taskKey || '').match(/^(.*?)-(\d+)$/);
    if (!match) return `${taskKey}-2`;
    return `${match[1]}-${Number(match[2]) + 1}`;
  }

  function isPersonalSpaceId(spaceId) {
    const space = cache.spaces.get(spaceId);
    return Boolean(space && (space.key === 'PER' || space.type === 'personal'));
  }

  function authenticatedCanCreateForOthers() {
    const userId = session()?.user?.id || '';
    return cache.rolesByProfileId.get(userId) === 'main_admin'
      || profileName(userId) === 'Victor Stavropoulos';
  }

  function creatorIdForTaskPayload(task, spaceId, isInsert) {
    const authenticatedId = session()?.user?.id || null;
    const authenticatedName = profileName(authenticatedId);
    const requestedId = profileId(task.creator);
    const canCreateForOthers = authenticatedCanCreateForOthers();
    const isPersonal = isPersonalSpaceId(spaceId);
    const isVictor = authenticatedName === 'Victor Stavropoulos';

    if (!isInsert) {
      const hasPreviousId = cache.taskCreatedByIds.has(task._supabaseId);
      const previousId = cache.taskCreatedByIds.get(task._supabaseId) || null;
      const previousName = cache.taskCreatorNames.get(task._supabaseId) || '';
      const creatorChanged = normalizedName(task.creator) !== normalizedName(previousName);

      if (!creatorChanged) return hasPreviousId ? previousId : (requestedId || authenticatedId);
      if (canCreateForOthers && requestedId && (!isPersonal || isVictor)) return requestedId;

      // A regular Task edit must never silently rewrite the Creator because a
      // stale View As identity or an old local cache supplied another name.
      // Restore the server-backed display value and keep its authority UUID.
      task.creator = previousName || authenticatedName || task.creator;
      return previousId || authenticatedId;
    }

    const mayUseRequestedCreator = requestedId
      && (requestedId === authenticatedId || (canCreateForOthers && (!isPersonal || isVictor)));
    if (mayUseRequestedCreator) return requestedId;

    // RLS binds ordinary creation to the authenticated Supabase account. This
    // also repairs stale CURRENT_USER/View As values instead of repeatedly
    // retrying an insert which the database must reject.
    if (authenticatedName) task.creator = authenticatedName;
    return authenticatedId;
  }

  function taskPayload(task, isInsert = false) {
    const spaceId = cache.spaceIdsByKey.get(task.project);
    return {
      task_key: task.id,
      title: String(task.title || task.id),
      space_id: spaceId,
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
      created_by_id: creatorIdForTaskPayload(task, spaceId, isInsert),
      audit: Array.isArray(task.audit) ? task.audit : [],
      is_mini_task: Boolean(task.isMiniTask),
      manual_order: null,
      created_at: task.created || new Date().toISOString(),
      updated_at: task.updated || new Date().toISOString(),
      legacy_data: publicTask(task),
    };
  }

  function commentPayload(taskId, comment, isInsert = false) {
    const authenticatedId = session()?.user?.id || null;
    const knownRow = comment?._supabaseId ? cache.comments.get(comment._supabaseId) : null;
    const authorId = isInsert
      ? authenticatedId
      : (knownRow?.author_id || profileId(comment.author) || authenticatedId);
    if (isInsert && profileName(authenticatedId)) comment.author = profileName(authenticatedId);
    return {
      task_id: taskId,
      author_id: authorId,
      content: String(comment.text || ' '),
      created_at: comment.createdAt || new Date().toISOString(),
      // Edits must advance updated_at so Realtime and fallback polling deliver
      // the new text to already-open Task Chats.
      updated_at: comment.editedAt || comment.updatedAt || comment.createdAt || new Date().toISOString(),
      legacy_data: (() => {
        const clone = safeClone(comment) || {};
        delete clone._supabaseId;
        delete clone.pending;
        delete clone.deliveryStatus;
        return clone;
      })(),
    };
  }

  async function saveCommentImmediately(task, comment) {
    if (!task || !comment) throw new Error('The Task Chat message is incomplete');
    if (!cache.ready) throw new Error('The shared Task Chat is still connecting');
    if (!task._supabaseId) {
      await upsertTask(task);
      return comment;
    }
    const isInsert = !comment._supabaseId;
    const payload = commentPayload(task._supabaseId, comment, isInsert);
    if (comment._supabaseId) {
      await request(`/rest/v1/task_comments?id=eq.${comment._supabaseId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(payload),
      });
      cache.commentHashes.set(comment._supabaseId, commentHash(comment));
      return comment;
    }
    const inserted = await request('/rest/v1/task_comments?select=id,task_id,author_id,content,created_at,updated_at,legacy_data', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const row = inserted?.[0];
    if (!row?.id) throw new Error('The Task Chat message was not confirmed by the shared database');
    comment._supabaseId = row.id;
    comment.author = profileName(row.author_id) || comment.author;
    cache.comments.set(row.id, { ...row, localId: comment.id });
    cache.commentHashes.set(row.id, commentHash(comment));
    lastCommentSyncAt = latestTimestamp(lastCommentSyncAt, row.updated_at || row.created_at);
    return comment;
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
      const isInsert = !comment._supabaseId;
      const payload = commentPayload(taskId, comment, isInsert);
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
      const inserted = await request('/rest/v1/task_comments?select=id,task_id,author_id,content,created_at,updated_at,legacy_data', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });
      const id = inserted?.[0]?.id;
      if (id) {
        const row = inserted[0];
        comment._supabaseId = id;
        comment.author = profileName(row.author_id) || comment.author;
        cache.comments.set(id, { ...row, localId: comment.id });
        cache.commentHashes.set(id, commentHash(comment));
        // Version 53: comments and @mentions use Task Chat/browser
        // notifications. Email remains reserved for critical workflows.
      }
    }
  }

  async function upsertTask(task) {
    const isInsert = !task._supabaseId;
    const payload = taskPayload(task, isInsert);
    if (!payload.space_id) throw new Error(`Unknown Space for task ${task.id}`);
    let id = task._supabaseId;
    if (id) {
      const knownUpdatedAt = cache.taskUpdatedAts.get(id);
      const concurrencyFilter = knownUpdatedAt ? `&updated_at=eq.${encodeURIComponent(knownUpdatedAt)}` : '';
      const updated = await request(`/rest/v1/tasks?id=eq.${id}${concurrencyFilter}&select=id,task_key,created_by_id,audit,legacy_data,updated_at`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(payload),
      });
      const row = updated?.[0];
      if (!row) {
        throw new Error(`Task ${task.id} changed in another browser. Refresh before saving so newer assignments are not overwritten.`);
      }
      id = row?.id || id;
      if (Array.isArray(row?.audit)) task.audit = row.audit;
      if (row?.legacy_data?.creator) task.creator = row.legacy_data.creator;
      if (row?.created_by_id) payload.created_by_id = row.created_by_id;
      cache.taskUpdatedAts.set(id, row.updated_at || task.updated || null);
    } else {
      let inserted = null;
      let candidateKey = payload.task_key;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        payload.task_key = candidateKey;
        if (payload.legacy_data) payload.legacy_data.id = candidateKey;
        try {
          inserted = await request('/rest/v1/tasks?select=id,task_key,created_by_id,audit,legacy_data,updated_at', {
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
      if (Array.isArray(inserted[0].audit)) task.audit = inserted[0].audit;
      if (inserted[0].legacy_data?.creator) task.creator = inserted[0].legacy_data.creator;
      if (inserted[0].created_by_id) payload.created_by_id = inserted[0].created_by_id;
      cache.taskUpdatedAts.set(id, inserted[0].updated_at || task.updated || null);
    }
    cache.tasks.set(id, task);
    await syncComments(task);
    cache.taskHashes.set(id, taskHash(task));
    cache.taskCreatedByIds.set(id, payload.created_by_id || null);
    cache.taskCreatorNames.set(id, task.creator || '');
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
          cache.taskCreatedByIds.delete(id);
          cache.taskCreatorNames.delete(id);
          cache.taskUpdatedAts.delete(id);
        }
      }

      const changed = tasks.filter(task => (
        !task._supabaseId || cache.taskHashes.get(task._supabaseId) !== taskHash(task)
      ));
      for (const task of changed) await upsertTask(task);

      const idByKey = new Map(tasks.map(task => [task.id, task._supabaseId]).filter(([, id]) => id));
      for (const task of changed) {
        const desiredParentId = task.parent ? idByKey.get(task.parent) || null : null;
        const knownUpdatedAt = cache.taskUpdatedAts.get(task._supabaseId);
        const concurrencyFilter = knownUpdatedAt ? `&updated_at=eq.${encodeURIComponent(knownUpdatedAt)}` : '';
        const parentRows = await request(`/rest/v1/tasks?id=eq.${task._supabaseId}${concurrencyFilter}&select=updated_at`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ parent_id: desiredParentId }),
        });
        if (!parentRows?.[0]) {
          throw new Error(`Task ${task.id} changed in another browser. Refresh before changing its hierarchy.`);
        }
        cache.taskUpdatedAts.set(task._supabaseId, parentRows[0].updated_at || knownUpdatedAt || null);
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

  function isTaskStarred(task) {
    return Boolean(task?._supabaseId && privateTaskStars.has(String(task._supabaseId)));
  }

  async function setTaskStar(task, starred) {
    if (!enabled() || !cache.ready) throw new Error('Your private Task preferences are still connecting');
    if (!task) throw new Error('The Task was not found');
    if (!task._supabaseId) await upsertTask(task);
    const taskId = String(task._supabaseId || '');
    if (!taskId) throw new Error('The Task must finish saving before it can be starred');

    const wasStarred = privateTaskStars.has(taskId);
    starred ? privateTaskStars.add(taskId) : privateTaskStars.delete(taskId);
    window.SHG_PRIVATE_TASK_STARS = [...privateTaskStars];
    window.dispatchEvent(new CustomEvent('shg:task-stars-changed', { detail: { taskId, starred: Boolean(starred) } }));
    try {
      const preferences = await request('/rest/v1/rpc/set_task_star', {
        method: 'POST',
        body: JSON.stringify({ _task_id: taskId, _starred: Boolean(starred) }),
      });
      hydratePrivatePreferences(preferences || {});
      window.SHG_REMOTE_BOOTSTRAP.privatePreferences = privatePreferences;
      window.SHG_REMOTE_BOOTSTRAP.privateTaskStars = [...privateTaskStars];
      window.dispatchEvent(new CustomEvent('shg:task-stars-changed', { detail: { taskId, starred: isTaskStarred(task) } }));
      return isTaskStarred(task);
    } catch (error) {
      wasStarred ? privateTaskStars.add(taskId) : privateTaskStars.delete(taskId);
      window.SHG_PRIVATE_TASK_STARS = [...privateTaskStars];
      window.dispatchEvent(new CustomEvent('shg:task-stars-changed', { detail: { taskId, starred: wasStarred } }));
      throw error;
    }
  }

  window.shgPrepareRemoteData = prepareRemoteData;
  window.shgFetchRemoteComments = fetchRemoteComments;
  window.shgSaveCommentImmediately = saveCommentImmediately;
  window.shgStartRealtimeComments = startRealtimeComments;
  window.shgQueueRemoteSync = queueSync;
  window.shgFlushRemoteSync = syncTasks;
  window.shgSafeLocalSet = safeLocalSet;
  window.shgWriteTaskCache = writeTaskCache;
  window.shgSaveUserSettings = saveUserSettings;
  window.shgIsTaskStarred = isTaskStarred;
  window.shgSetTaskStar = setTaskStar;
  window.addEventListener('shg:auth-session', () => startRealtimeComments());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      pollRecentComments();
      if (!realtimeConnected) startRealtimeComments();
    }
  });
})();
