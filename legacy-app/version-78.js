/* MAILO Version 78 — trustworthy views, protected updates and clearer Task tools. */
(() => {
  'use strict';

  const VERSION_78 = 78;
  const VICTOR_78 = 'Victor Stavropoulos';
  const OFFICE_EXTENSIONS_78 = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip']);

  const authenticatedUser78 = () => String(
    window.SHG_AUTH_USER_NAME
    || (typeof SESSION_USER !== 'undefined' ? SESSION_USER : '')
    || '',
  ).trim();
  const viewedUser78 = () => String(typeof CURRENT_USER !== 'undefined' ? CURRENT_USER : '').trim();
  const roleFor78 = name => {
    if (name === VICTOR_78) return 'main_admin';
    return window.SHG_REMOTE_BOOTSTRAP?.roleByName?.[name]
      || ((window.SHG_REMOTE_BOOTSTRAP?.mainAdminNames || []).includes(name) ? 'main_admin' : '')
      || (state.admins?.has(name) ? 'admin' : 'user');
  };
  const isAuthenticatedMainAdmin78 = () => roleFor78(authenticatedUser78()) === 'main_admin';
  const isPersonalTask78 = task => Boolean(task && (isCentralPersonalSpace(task.project) || isPersonalSpace(task.project)));
  const personalOwner78 = task => String(
    task?.personalOwner
    || PERSONAL_SPACE_OWNERS?.[task?.project]
    || task?.creator
    || '',
  ).trim();

  function applyVersion78() {
    document.querySelectorAll('#versionBadge,.version-badge').forEach(node => {
      node.textContent = `Version ${VERSION_78}`;
    });
  }

  /* 1. View As must reproduce the viewed user's Personal visibility. */
  const previousTaskAccess78 = canCurrentUserAccessTask;
  canCurrentUserAccessTask = function version78TaskAccess(task) {
    if (!isPersonalTask78(task)) return previousTaskAccess78(task);
    const authenticated = authenticatedUser78();
    const viewed = viewedUser78();
    const owner = personalOwner78(task);
    if (!authenticated || !viewed || !owner) return false;
    if (authenticated === viewed) return previousTaskAccess78(task);
    // Victor retains permanent database access, but View As is deliberately a
    // faithful preview and never leaks Victor's Personal Tasks into another
    // user's Tasks tab.
    if (authenticated === VICTOR_78) return owner === viewed;
    return false;
  };

  /* 3. Retire the two obsolete Task-toolbar actions. */
  const previousSavedFilterControls78 = savedFilterControls;
  function stripRetiredControls78(markup) {
    return String(markup || '')
      .replace(/<button[^>]*class="[^"]*create-folders-btn[^"]*"[^>]*>.*?<\/button>/giu, '');
  }
  savedFilterControls = function version78SavedFilterControls(...args) {
    return stripRetiredControls78(previousSavedFilterControls78.apply(this, args));
  };
  function removeRetiredToolbarActions78() {
    document.getElementById('rollOverdueBtn')?.remove();
    document.querySelectorAll('.create-folders-btn').forEach(button => button.remove());
  }

  /* 5. Excel/Office attachments show a visible selection before submission. */
  const previousPreviewFiles78 = previewCommentImages;
  previewCommentImages = function version78PreviewCommentFiles(input, taskId) {
    const preview = document.getElementById(`commentPreview-${taskId}`);
    const files = [...(input?.files || [])].slice(0, 4);
    if (!preview) return previousPreviewFiles78(input, taskId);
    preview.innerHTML = '';
    for (const file of files) {
      const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
      const isImage = String(file.type || '').startsWith('image/');
      if (!isImage) {
        const accepted = OFFICE_EXTENSIONS_78.has(extension);
        preview.insertAdjacentHTML('beforeend', `<div class="comment-file-preview78 ${accepted ? '' : 'invalid'}"><strong>📎 ${esc(file.name)}</strong><small>${accepted ? `${Math.ceil(file.size / 1024)} KB · Ready to attach` : 'Unsupported file type'}</small></div>`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => preview.insertAdjacentHTML('beforeend', `<img src="${reader.result}" alt="Selected image">`);
      reader.onerror = () => toast(`The file “${file.name}” could not be read`);
      reader.readAsDataURL(file);
    }
    if ((input?.files?.length || 0) > 4) toast('You can attach up to 4 files');
  };
  function decorateCommentFileInput78() {
    const taskId = taskDetailsDraft?.id;
    const input = document.querySelector('#modalContent .comment-form input[type="file"]');
    if (!input || !taskId) return;
    input.accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.setAttribute('aria-label', 'Attach photos, Excel, PDF or Office files');
  }

  /* 6. Shared blue marker for Tasks present in any Weekly list. */
  if (!LIST_COLUMNS.some(column => column.key === 'weekly')) {
    const starIndex = LIST_COLUMNS.findIndex(column => column.key === 'star');
    LIST_COLUMNS.splice(starIndex < 0 ? 0 : starIndex + 1, 0, { key: 'weekly', label: '●' });
  }
  state.columnWidths.weekly = Number(state.columnWidths.weekly) || 54;
  if (!state.columnOrder.includes('weekly')) {
    const starIndex = state.columnOrder.indexOf('star');
    state.columnOrder.splice(starIndex < 0 ? 0 : starIndex + 1, 0, 'weekly');
  }
  try {
    localStorage.setItem('shg-column-order', JSON.stringify(state.columnOrder));
    localStorage.setItem('shg-column-widths', JSON.stringify(state.columnWidths));
  } catch {}

  const previousListSourceRows78 = listSourceRows;
  listSourceRows = function version78ListSourceRows(...args) {
    let rows = previousListSourceRows78.apply(this, args).map(row => {
      const task = state.tasks.find(item => item.id === row.id);
      const weeklyUsers = Object.keys(task?.weeklyAssignments || {});
      return { ...row, weekly: weeklyUsers.length ? 1 : 0, weeklyUsers };
    });
    if (state.viewArchived) rows = rows.filter(row => state.tasks.find(task => task.id === row.id)?.status === 'archive');
    return rows;
  };

  const isStarred78 = task => typeof window.shgIsTaskStarred === 'function'
    ? window.shgIsTaskStarred(task)
    : Boolean(task?._supabaseId && (window.SHG_PRIVATE_TASK_STARS || []).includes(String(task._supabaseId)));

  const previousColumnHeader78 = columnHeader;
  columnHeader = function version78ColumnHeader(key, label) {
    if (key !== 'weekly') return previousColumnHeader78(key, label);
    return '<th data-header="weekly" class="weekly-column78"><div class="column-header"><button class="filter-trigger" type="button" title="Weekly Tasks indicator" aria-label="Weekly Tasks indicator">●</button></div><span class="column-resizer" title="Drag to resize" onmousedown="startColumnResize(\'weekly\',event)"></span></th>';
  };

  listRowHTML = function version78ListRowHTML(row) {
    const task = state.tasks.find(item => item.id === row.id);
    const status = task?.jiraStatus || row.status;
    const selected = state.selectedTasks.has(row.id);
    const isSubtask = Boolean(row.parent);
    const starred = isStarred78(task);
    const weeklyUsers = Object.keys(task?.weeklyAssignments || {});
    const weekly = weeklyUsers.length > 0;
    const cells = {
      star: `<td class="star-cell76" onclick="event.stopPropagation()"><button type="button" class="task-star76 ${starred ? 'active' : ''}" aria-label="${starred ? 'Remove star from' : 'Star'} ${esc(row.id)}" aria-pressed="${starred}" onclick="toggleTaskStar76('${esc(row.id)}',event)">${starred ? '★' : '☆'}</button></td>`,
      weekly: `<td class="weekly-cell78" title="${weekly ? `Weekly Tasks: ${esc(weeklyUsers.join(', '))}` : 'Not in any Weekly Tasks'}"><span class="${weekly ? 'active' : ''}" aria-label="${weekly ? 'Included in Weekly Tasks' : 'Not included in Weekly Tasks'}">${weekly ? '●' : '○'}</span></td>`,
      code: `<td class="code-cell"><strong class="key-link">${esc(row.id)}</strong></td>`,
      work: workCell(row),
      creator: `<td>${personCell(row.creator)}</td>`,
      space: editableCell(row, 'space', `<span class="space-cell">${esc(row.space)}</span>`),
      labels: editableCell(row, 'labels', labelCell(row.id, row.labels)),
      assignee: editableCell(row, 'assignee', personCell(row.assignee)),
      supervisor: editableCell(row, 'supervisor', personCell(row.supervisor)),
      approver: editableCell(row, 'approver', personCell(row.approver)),
      priority: editableCell(row, 'priority', `<span class="priority-text ${String(row.priority).toLowerCase()}">⌃ ${esc(row.priority)}</span>`),
      dueDate: editableCell(row, 'dueDate', formatDate(row.dueDate)),
      status: editableCell(row, 'status', `<span class="table-status status-${task?.status || 'todo'}">${esc(status)}</span>`),
      created: `<td>${row.created ? formatDateTime(row.created) : '<span class="none-value">Unknown</span>'}</td>`,
      updated: `<td>${formatDateTime(row.updated)}</td>`,
      lastChecked: `<td>${task?.lastChecks?.[CURRENT_USER] ? formatDateTime(task.lastChecks[CURRENT_USER]) : '<span class="none-value">Never checked</span>'}</td>`,
    };
    const drag = `draggable="true" ondragstart="startTaskDrag('${row.id}',event)" ondragover="dragOverTaskRow('${row.id}',event)" ondragleave="event.currentTarget.classList.remove('task-drop-before','task-drop-after')" ondrop="dropTaskRow('${row.id}',event)" ondragend="endTaskDrag()"`;
    return `<tr ${drag} oncontextmenu="openTaskContextMenu('${row.id}',event)" data-task-row="${row.id}" class="${selected ? 'selected-row ' : ''}${isSubtask ? 'subtask-row ' : ''}${task?.isMiniTask ? 'mini-task-row' : ''}"><td class="check-col" onclick="event.stopPropagation()"><input type="checkbox" aria-label="Select ${row.id}" ${selected ? 'checked' : ''} onchange="toggleTaskSelection('${row.id}',this.checked)"></td>${orderedColumns().filter(column => isColumnVisible(column.key)).map(column => cells[column.key] || '').join('')}</tr>`;
  };

  /* 7. Preserve the Task while changing only its Task/Mini Task type. */
  window.convertTaskType78 = taskId => {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || !canEditTaskFields(task)) {
      toast('You do not have permission to change this Task type');
      return;
    }
    if (taskDetailsDirtyId === taskId) {
      toast('Submit or discard the pending Task changes before converting its type');
      return;
    }
    const toMini = !task.isMiniTask;
    if (!confirm(`Convert ${task.id} to ${toMini ? 'Mini Task' : 'Task'}?`)) return;
    const actor = authenticatedUser78() || viewedUser78();
    const changedAt = new Date().toISOString();
    task.isMiniTask = toMini;
    task.issueType = toMini ? 'Mini Task' : (task.parent ? 'Sub-task' : 'Task');
    task.reminderProfile = toMini ? 'mini' : undefined;
    if (toMini && ['backlog', 'todo'].includes(task.status)) {
      task.status = 'progress';
      task.jiraStatus = 'In Progress';
      task.lastStatusChangedAt = changedAt;
    }
    task.updated = changedAt;
    task.audit = Array.isArray(task.audit) ? task.audit : [];
    task.audit.unshift(`${task.id} converted to ${toMini ? 'Mini Task' : 'Task'} by ${actor}`);
    save();
    closeModal(true);
    render();
    toast(`${task.id} converted to ${toMini ? 'Mini Task' : 'Task'}`);
    setTimeout(() => openTask(task.id), 0);
  };

  function decorateTaskTypeAction78(taskId) {
    const task = state.tasks.find(item => item.id === taskId);
    const actions = document.querySelector('#modalContent .modal-actions');
    if (!task || !actions || actions.querySelector('.convert-task-type78') || !canEditTaskFields(task)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-btn convert-task-type78';
    button.textContent = task.isMiniTask ? 'Convert to Task' : 'Convert to Mini Task';
    button.onclick = () => window.convertTaskType78(task.id);
    actions.append(button);
  }

  /* 8. View Archived becomes an explicit Archive view and clears status clashes. */
  function connectArchiveToggle78() {
    const checkbox = document.getElementById('viewArchived63');
    if (!checkbox || checkbox.dataset.version78 === 'true') return;
    checkbox.dataset.version78 = 'true';
    checkbox.checked = Boolean(state.viewArchived);
    checkbox.onchange = event => {
      state.viewArchived = event.target.checked;
      state.quickStatusView = null;
      state.columnFilters.status = new Set();
      state.taskPage = 1;
      render();
    };
  }
  const previousClearFilters78 = clearAllColumnFilters;
  const previousHasFilters78 = hasActiveTaskFilters;
  clearAllColumnFilters = function version78ClearFilters(...args) {
    const archivedOnly = Boolean(state.viewArchived) && !previousHasFilters78.apply(this, args);
    state.viewArchived = false;
    if (archivedOnly) {
      state.taskPage = 1;
      render();
      return;
    }
    return previousClearFilters78.apply(this, args);
  };
  hasActiveTaskFilters = function version78HasFilters(...args) {
    return Boolean(state.viewArchived) || previousHasFilters78.apply(this, args);
  };

  /* 9. Every Main Admin can target another user's Weekly list. */
  function sortedWeeklyTargets78() {
    return [...PEOPLE]
      .filter(person => person?.name)
      .sort((left, right) => left.name.localeCompare(right.name, 'el', { sensitivity: 'base' }));
  }
  function targetHasTaskAccess78(task, targetName) {
    if (!task || !targetName) return false;
    return taskAccessReasons(task, targetName).length > 0;
  }
  window.addSelectedWeekly78 = () => {
    if (!isAuthenticatedMainAdmin78()) {
      toast('Only a Main Admin can add Weekly Tasks for another user');
      return;
    }
    const select = document.getElementById('weeklyTarget78');
    const target = String(select?.value || '').trim();
    if (!target) { toast('Select a Weekly Tasks user'); return; }
    const selected = state.tasks.filter(task => state.selectedTasks.has(task.id) && task.status !== 'done');
    if (!selected.length) { toast('Select at least one active Task first'); return; }
    const actor = authenticatedUser78();
    const changedAt = new Date().toISOString();
    const weekStart = typeof window.MAILO_VERSION_77?.weekKey === 'function'
      ? window.MAILO_VERSION_77.weekKey(changedAt)
      : (() => { const date = new Date(changedAt); const day = date.getDay() || 7; date.setDate(date.getDate() - day + 1); return date.toISOString().slice(0, 10); })();
    let added = 0;
    let denied = 0;
    let existing = 0;
    for (const task of selected) {
      if (!targetHasTaskAccess78(task, target)) { denied += 1; continue; }
      if (task.weeklyAssignments?.[target]) { existing += 1; continue; }
      task.weeklyAssignments = {
        ...(task.weeklyAssignments || {}),
        [target]: { weekStart, assignedAt: changedAt, assignedBy: actor },
      };
      task.audit = Array.isArray(task.audit) ? task.audit : [];
      task.audit.unshift(`Added to ${target}'s Weekly Tasks by ${actor}`);
      task.updated = changedAt;
      added += 1;
    }
    state.selectedTasks.clear();
    if (added) save();
    render();
    const details = [
      `${added} added to ${target}'s Weekly Tasks`,
      denied ? `${denied} skipped without Task access` : '',
      existing ? `${existing} already included` : '',
    ].filter(Boolean).join(' · ');
    toast(details);
  };

  const previousWeeklyControls78 = savedFilterControls;
  savedFilterControls = function version78WeeklyControls(...args) {
    let controls = previousWeeklyControls78.apply(this, args);
    if (!isAuthenticatedMainAdmin78()) return controls;
    controls = controls
      .replace(/<button[^>]*onclick="addSelectedWeekly(?:64|77)\(\)"[^>]*>.*?<\/button>/giu, '')
      .replace(/<button[^>]*class="weekly-add-own77"[^>]*>.*?<\/button>/giu, '');
    const options = sortedWeeklyTargets78().map(person => `<option value="${esc(person.name)}" ${person.name === viewedUser78() ? 'selected' : ''}>${esc(person.name)} · ${roleFor78(person.name).replace('_', ' ')}</option>`).join('');
    return `${controls}<span class="weekly-target-controls78"><select id="weeklyTarget78" aria-label="Weekly Tasks user"><option value="">Add selected to…</option>${options}</select><button type="button" onclick="addSelectedWeekly78()">Add Selected</button></span>`;
  };

  const previousOpenTask78 = openTask;
  openTask = function version78OpenTask(id, preserveDirty = false) {
    const result = previousOpenTask78(id, preserveDirty);
    decorateCommentFileInput78();
    decorateTaskTypeAction78(id);
    return result;
  };

  const previousRender78 = render;
  render = function version78Render(...args) {
    const result = previousRender78.apply(this, args);
    applyVersion78();
    removeRetiredToolbarActions78();
    connectArchiveToggle78();
    return result;
  };

  window.MAILO_VERSION_78 = Object.freeze({
    authenticatedUser: authenticatedUser78,
    isAuthenticatedMainAdmin: isAuthenticatedMainAdmin78,
    targetHasTaskAccess: targetHasTaskAccess78,
  });

  applyVersion78();
  removeRetiredToolbarActions78();
  connectArchiveToggle78();
  render();
})();
