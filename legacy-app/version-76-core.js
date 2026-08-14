/* MAILO Version 76 — personal privacy, Task hierarchy controls and personal stars. */
(() => {
  const VERSION = 76;
  const VICTOR = 'Victor Stavropoulos';

  function applyVersion76() {
    document.querySelectorAll('#versionBadge,.version-badge').forEach(node => {
      node.textContent = `Version ${VERSION}`;
    });
  }

  const authenticatedUser76 = () => String(
    window.SHG_AUTH_USER_NAME
    || (typeof SESSION_USER !== 'undefined' ? SESSION_USER : '')
    || '',
  ).trim();
  const knownUser76 = name => PEOPLE.some(person => person.name === name);
  const isPersonalProject76 = projectKey => isCentralPersonalSpace(projectKey) || isPersonalSpace(projectKey);
  const fixedPersonalOwner76 = projectKey => PERSONAL_SPACE_OWNERS[projectKey] || '';

  function personalOwner76(task) {
    if (!task || !isPersonalProject76(task.project)) return '';
    const fixedOwner = fixedPersonalOwner76(task.project);
    if (fixedOwner) return fixedOwner;
    const candidates = [task.personalOwner, task.creator, task.assignee, task.supervisor, task.approver];
    return candidates.find(name => knownUser76(String(name || '').trim())) || authenticatedUser76() || CURRENT_USER;
  }

  function lockPersonalTask76(task, requestedOwner = '') {
    if (!task || !isPersonalProject76(task.project)) return false;
    const owner = fixedPersonalOwner76(task.project)
      || (knownUser76(requestedOwner) ? requestedOwner : '')
      || personalOwner76(task);
    if (!owner) return false;
    const before = JSON.stringify([
      task.personalOwner, task.creator, task.assignee, task.supervisor, task.approver,
      task.personalAccessLocked,
    ]);
    task.personalOwner = owner;
    task.creator = owner;
    task.assignee = owner;
    task.supervisor = owner;
    task.approver = owner;
    task.personalAccessLocked = true;
    task.disableMainAdminReminders = true;
    const after = JSON.stringify([
      task.personalOwner, task.creator, task.assignee, task.supervisor, task.approver,
      task.personalAccessLocked,
    ]);
    return before !== after;
  }

  function normalizePersonalTasks76() {
    let changed = false;
    for (const task of state.tasks) changed = lockPersonalTask76(task) || changed;
    return changed;
  }

  function canAuthenticatedUserSeePersonalTask76(task, userName = CURRENT_USER) {
    const authenticated = authenticatedUser76();
    if (authenticated === VICTOR) return true;
    const owner = personalOwner76(task);
    // View As must not grant Personal access. The owner must be genuinely
    // authenticated and must still be viewing their own workspace.
    return Boolean(owner && authenticated === owner && userName === owner);
  }

  const previousProjectAccess76 = canCurrentUserAccessProject;
  canCurrentUserAccessProject = function version76ProjectAccess(projectKey) {
    if (isCentralPersonalSpace(projectKey)) return true;
    if (!isPersonalSpace(projectKey)) return previousProjectAccess76(projectKey);
    if (authenticatedUser76() === VICTOR) return true;
    const owner = fixedPersonalOwner76(projectKey);
    return authenticatedUser76() === owner && CURRENT_USER === owner;
  };

  const previousTaskAccess76 = canCurrentUserAccessTask;
  canCurrentUserAccessTask = function version76TaskAccess(task) {
    if (task && isPersonalProject76(task.project)) return canAuthenticatedUserSeePersonalTask76(task);
    return previousTaskAccess76(task);
  };

  const previousAccessReasons76 = taskAccessReasons;
  taskAccessReasons = function version76TaskAccessReasons(task, name) {
    if (!task || !isPersonalProject76(task.project)) return previousAccessReasons76(task, name);
    const owner = personalOwner76(task);
    if (name === owner) return ['Personal Space owner'];
    if (name === VICTOR) return ['Permanent Main Admin'];
    return [];
  };

  // Personal Tasks never produce browser-triggered email. Cover both the
  // central PER Space and the legacy per-user Personal Spaces so an older Task
  // cannot leak a notification while it is being migrated.
  const previousMentionEmails76 = sendMentionEmails;
  sendMentionEmails = function version76MentionEmails(task, ...args) {
    if (task && isPersonalProject76(task.project)) return;
    return previousMentionEmails76.call(this, task, ...args);
  };
  const previousTaskCreatedEmails76 = sendTaskCreatedEmails;
  sendTaskCreatedEmails = function version76TaskCreatedEmails(task, ...args) {
    if (task && isPersonalProject76(task.project)) return;
    return previousTaskCreatedEmails76.call(this, task, ...args);
  };
  const previousAssigneeEmail76 = sendAssigneeChangedEmail;
  sendAssigneeChangedEmail = function version76AssigneeEmail(task, ...args) {
    if (task && isPersonalProject76(task.project)) return;
    return previousAssigneeEmail76.call(this, task, ...args);
  };

  const previousSave76 = save;
  save = function version76Save(...args) {
    normalizePersonalTasks76();
    return previousSave76.apply(this, args);
  };

  const previousChangeTaskSpace76 = changeTaskSpace;
  changeTaskSpace = function version76ChangeTaskSpace(id, newProject) {
    const task = state.tasks.find(item => item.id === id);
    const previousProject = task?.project;
    const previousPersonalFields = task ? {
      personalOwner: task.personalOwner,
      creator: task.creator,
      assignee: task.assignee,
      supervisor: task.supervisor,
      approver: task.approver,
      personalAccessLocked: task.personalAccessLocked,
      disableMainAdminReminders: task.disableMainAdminReminders,
    } : null;
    if (task && isPersonalProject76(newProject) && !isPersonalProject76(previousProject)) {
      const owner = fixedPersonalOwner76(newProject) || CURRENT_USER;
      // The database locks the owner on the first write into Personal, so the
      // intended owner must be part of that write. Revert below if the base
      // handler rejects the move.
      Object.assign(task, {
        personalOwner: owner,
        creator: owner,
        assignee: owner,
        supervisor: owner,
        approver: owner,
        personalAccessLocked: true,
        disableMainAdminReminders: true,
      });
    }
    const result = previousChangeTaskSpace76(id, newProject);
    if (task && previousProject === task.project && previousPersonalFields) {
      Object.assign(task, previousPersonalFields);
    }
    return result;
  };

  const previousChangeSpaceDetails76 = changeTaskSpaceFromDetails;
  changeTaskSpaceFromDetails = function version76ChangeTaskSpace(id, newProject) {
    const result = previousChangeSpaceDetails76(id, newProject);
    if (taskDetailsDraft?.id === id && isPersonalProject76(newProject)) {
      const owner = fixedPersonalOwner76(newProject) || CURRENT_USER;
      taskDetailsDraft.assignee = owner;
      taskDetailsDraft.supervisor = owner;
      taskDetailsDraft.approver = owner;
      taskDetailsDraft.personalOwner = owner;
      // Keep the live Task untouched until Submit. Cancel must leave its
      // Creator and ownership exactly as they were before opening the editor.
      markTaskDetailsDirty(id);
      openTask(id, true);
    }
    return result;
  };

  const previousSubmitDetails76 = submitTaskDetails;
  submitTaskDetails = function version76SubmitTaskDetails(id) {
    const task = state.tasks.find(item => item.id === id);
    const draft = taskDetailsDraft;
    const shouldLockPersonal = Boolean(task && draft?.id === id && isPersonalProject76(draft.project));
    // Mirror the base validations that can reject before saving, so rejected
    // submissions never require even a temporary mutation of the live Task.
    if (shouldLockPersonal && (
      taskDetailsDirtyId !== id
      || !String(draft.title || '').trim()
      || (['blocked', 'cancelled'].includes(draft.status) && !String(draft.statusReason || '').trim())
      || (task.project !== draft.project && !canMoveTaskFromPersonalSpace(task))
    )) {
      return previousSubmitDetails76(id);
    }
    const owner = shouldLockPersonal
      ? fixedPersonalOwner76(draft.project)
        || (knownUser76(draft.personalOwner) ? draft.personalOwner : '')
        || (task.project !== draft.project ? CURRENT_USER : personalOwner76(task))
      : '';
    const previousPersonalFields = shouldLockPersonal ? {
      personalOwner: task.personalOwner,
      creator: task.creator,
      assignee: task.assignee,
      supervisor: task.supervisor,
      approver: task.approver,
      personalAccessLocked: task.personalAccessLocked,
      disableMainAdminReminders: task.disableMainAdminReminders,
    } : null;
    if (shouldLockPersonal) {
      // Only at the moment Submit is pressed: include the future Personal owner
      // in the same database write that changes Space. Cancel never touches it.
      Object.assign(task, {
        personalOwner: owner,
        creator: owner,
        assignee: owner,
        supervisor: owner,
        approver: owner,
        personalAccessLocked: true,
        disableMainAdminReminders: true,
      });
      draft.assignee = owner;
      draft.supervisor = owner;
      draft.approver = owner;
    }
    const result = previousSubmitDetails76(id);
    // A rejected validation leaves taskDetailsDraft open. Do not mutate the
    // live Task until the original submit has actually completed.
    if (shouldLockPersonal && taskDetailsDraft !== null && previousPersonalFields) {
      Object.assign(task, previousPersonalFields);
    } else if (shouldLockPersonal && taskDetailsDraft === null && isPersonalProject76(task.project)) {
      if (lockPersonalTask76(task, owner)) {
        save();
        render();
      }
    }
    return result;
  };

  // Personal stars live in the authenticated user's private preferences so
  // they survive browsers without becoming shared Task metadata.
  if (!LIST_COLUMNS.some(column => column.key === 'star')) {
    const codeIndex = LIST_COLUMNS.findIndex(column => column.key === 'code');
    LIST_COLUMNS.splice(codeIndex < 0 ? 0 : codeIndex, 0, { key: 'star', label: '★' });
  }
  state.columnWidths.star = Number(state.columnWidths.star) || 52;
  if (!state.columnOrder.includes('star')) {
    const codeIndex = state.columnOrder.indexOf('code');
    state.columnOrder.splice(codeIndex < 0 ? 0 : codeIndex, 0, 'star');
  }
  try {
    localStorage.setItem('shg-column-order', JSON.stringify(state.columnOrder));
    localStorage.setItem('shg-column-widths', JSON.stringify(state.columnWidths));
  } catch {}

  const isStarred76 = task => typeof window.shgIsTaskStarred === 'function'
    ? window.shgIsTaskStarred(task)
    : Boolean(task?._supabaseId && (window.SHG_PRIVATE_TASK_STARS || []).includes(String(task._supabaseId)));
  const starRequests76 = new Set();
  window.toggleTaskStar76 = async (taskId, event) => {
    event?.preventDefault();
    event?.stopPropagation();
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || !authenticatedUser76() || !canCurrentUserAccessTask(task) || starRequests76.has(taskId)) return;
    if (typeof window.shgSetTaskStar !== 'function') {
      toast('Your private Task preferences are not available yet');
      return;
    }
    const next = !isStarred76(task);
    starRequests76.add(taskId);
    try {
      await window.shgSetTaskStar(task, next);
      if (state.appSection === 'tasks') renderList();
      const detailButton = document.querySelector('.task-star-detail76');
      if (detailButton) {
        const active = isStarred76(task);
        detailButton.classList.toggle('active', active);
        detailButton.setAttribute('aria-pressed', String(active));
        detailButton.innerHTML = `${active ? '★' : '☆'} ${active ? 'Starred' : 'Add star'}`;
      }
      toast(next ? `${task.id} added to your Starred Tasks` : `${task.id} removed from your Starred Tasks`);
    } catch (error) {
      if (state.appSection === 'tasks') renderList();
      toast(error?.message || 'Your Starred Tasks could not be updated');
    } finally {
      starRequests76.delete(taskId);
    }
  };

  const previousListSourceRows76 = listSourceRows;
  listSourceRows = function version76ListSourceRows() {
    return previousListSourceRows76().map(row => {
      const task = state.tasks.find(item => item.id === row.id);
      return { ...row, star: isStarred76(task) ? 1 : 0 };
    });
  };

  const previousSortListRows76 = sortListRows;
  sortListRows = function version76SortListRows(rows) {
    const sort = state.listSort?.[0];
    if (sort?.key !== 'star') return previousSortListRows76(rows);
    const direction = sort.direction === 'desc' ? -1 : 1;
    return [...rows].sort((left, right) =>
      // The first click is the normal ascending state, but for a personal
      // boolean marker the useful order is starred Tasks first.
      (Number(right.star || 0) - Number(left.star || 0)) * direction
      || String(left.id || '').localeCompare(String(right.id || ''), 'en', { numeric: true }),
    );
  };

  const previousColumnHeader76 = columnHeader;
  columnHeader = function version76ColumnHeader(key, label) {
    if (key !== 'star') return previousColumnHeader76(key, label);
    const sort = state.listSort.find(item => item.key === 'star');
    const arrow = sort ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
    return `<th data-header="star" class="star-column76"><div class="column-header"><button class="filter-trigger" type="button" title="Personal Starred Tasks">★</button><button class="sort-arrow ${sort ? 'active' : ''}" type="button" title="Sort by your stars" onclick="event.stopPropagation();setListSort('star')">${arrow}</button></div><span class="column-resizer" title="Drag to resize" onmousedown="startColumnResize('star',event)"></span></th>`;
  };

  // Rebuild the final row renderer because Version 64 owns the current table
  // structure and unknown columns otherwise render without a matching cell.
  listRowHTML = function version76ListRowHTML(row) {
    const task = state.tasks.find(item => item.id === row.id);
    const status = task?.jiraStatus || row.status;
    const selected = state.selectedTasks.has(row.id);
    const isSubtask = Boolean(row.parent);
    const starred = isStarred76(task);
    const cells = {
      star: `<td class="star-cell76" onclick="event.stopPropagation()"><button type="button" class="task-star76 ${starred ? 'active' : ''}" aria-label="${starred ? 'Remove star from' : 'Star'} ${esc(row.id)}" aria-pressed="${starred}" onclick="toggleTaskStar76('${esc(row.id)}',event)">${starred ? '★' : '☆'}</button></td>`,
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

  window.makeTaskSubtaskFromDetails76 = taskId => {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    if (!canEditTaskFields(task)) {
      toast('Only an authorized Task editor can change its Parent Task');
      return;
    }
    if (taskDetailsDirtyId === taskId) {
      toast('Submit or discard the pending Task changes before choosing a Parent Task');
      return;
    }
    const typed = prompt(`Enter the code of the Parent Task for ${task.id}:`, '')?.trim().toUpperCase();
    if (!typed) return;
    const parent = state.tasks.find(item => item.id.toUpperCase() === typed || (item.formerIds || []).some(id => String(id).toUpperCase() === typed));
    if (!parent) { toast(`Task ${typed} was not found`); return; }
    if (!canEditTaskFields(parent)) { toast(`You do not have permission to change the hierarchy of ${parent.id}`); return; }
    if (!confirm(`Make ${task.id} a Subtask of ${parent.id} — ${parent.title}?`)) return;
    const convertedId = makeTaskSubtask(task.id, parent.id);
    if (!convertedId) return;
    closeModal(true);
    render();
    toast(`${convertedId} is now a Subtask of ${parent.id}`);
    setTimeout(() => openTask(convertedId), 0);
  };

  const previousMakeTaskSubtask76 = makeTaskSubtask;
  makeTaskSubtask = function version76MakeTaskSubtask(sourceId, parentId) {
    const source = state.tasks.find(item => item.id === sourceId);
    const parent = state.tasks.find(item => item.id === parentId);
    if (!source || !parent || !canEditTaskFields(source) || !canEditTaskFields(parent)) {
      toast('You do not have permission to change this Task relation');
      return false;
    }
    if (source === parent || source.parent === parent.id || state.tasks.some(item => item.parent === source.id && !isTaskDeleted(item))) {
      return previousMakeTaskSubtask76(sourceId, parentId);
    }
    const previousPersonalFields = {
      personalOwner: source.personalOwner,
      creator: source.creator,
      assignee: source.assignee,
      supervisor: source.supervisor,
      approver: source.approver,
      personalAccessLocked: source.personalAccessLocked,
      disableMainAdminReminders: source.disableMainAdminReminders,
    };
    if (source && parent && isPersonalProject76(parent.project)) {
      const owner = personalOwner76(parent) || fixedPersonalOwner76(parent.project) || CURRENT_USER;
      source.personalOwner = owner;
      source.creator = owner;
      source.assignee = owner;
      source.supervisor = owner;
      source.approver = owner;
      source.personalAccessLocked = true;
      source.disableMainAdminReminders = true;
    }
    const result = previousMakeTaskSubtask76(sourceId, parentId);
    if (!result) Object.assign(source, previousPersonalFields);
    return result;
  };

  function enhanceTaskDetails76(taskId) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    const title = document.getElementById('modalTitle');
    if (title && !document.querySelector('.task-star-detail76')) {
      const starred = isStarred76(task);
      title.insertAdjacentHTML('afterend', `<button type="button" class="task-star-detail76 ${starred ? 'active' : ''}" aria-pressed="${starred}" onclick="toggleTaskStar76('${esc(task.id)}',event)">${starred ? '★ Starred' : '☆ Add star'}</button>`);
    }
    const footer = document.querySelector('#taskDetailsFooter .task-footer-left');
    if (footer && canEditTaskFields(task) && !footer.querySelector('.make-subtask76')) {
      footer.insertAdjacentHTML('beforeend', `<button type="button" class="action-btn make-subtask76" onclick="makeTaskSubtaskFromDetails76('${esc(task.id)}')">↳ Make Subtask</button>`);
    }
  }

  const previousOpenTask76 = openTask;
  openTask = function version76OpenTask(id, preserveDirty = false) {
    const result = previousOpenTask76(id, preserveDirty);
    enhanceTaskDetails76(taskDetailsDraft?.id || id);
    return result;
  };

  const previousRender76 = render;
  render = function version76Render(...args) {
    const result = previousRender76.apply(this, args);
    applyVersion76();
    return result;
  };

  normalizePersonalTasks76();
  applyVersion76();
})();
