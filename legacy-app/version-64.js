/* MAILO Version 64 — duplicate finder, Main Admin last checks, weekly tasks and creation date. */
(() => {
  const VERSION = 64;
  const VICTOR = 'Victor Stavropoulos';

  const authenticatedUser64 = () => String(window.SHG_AUTH_USER_NAME || (typeof SESSION_USER !== 'undefined' ? SESSION_USER : '') || '').trim();
  const roleFor64 = name => window.SHG_REMOTE_BOOTSTRAP?.roleByName?.[name] || (name === VICTOR ? 'main_admin' : 'user');
  const isMainAdmin64 = name => name === VICTOR || roleFor64(name) === 'main_admin' || (window.SHG_REMOTE_BOOTSTRAP?.mainAdminNames || []).includes(name);
  const canManageWeekly64 = () => isMainAdmin64(authenticatedUser64());
  const canRecordLastCheck64 = () => authenticatedUser64() === CURRENT_USER && isMainAdmin64(CURRENT_USER);

  function applyVersion64() {
    const label = `Version ${VERSION}`;
    document.querySelectorAll('#versionBadge,.version-badge').forEach(node => {
      if (node.textContent !== label) node.textContent = label;
    });
  }

  // Date of Creation is a first-class list column and uses the immutable task.created value.
  if (!LIST_COLUMNS.some(column => column.key === 'created')) {
    const updatedIndex = LIST_COLUMNS.findIndex(column => column.key === 'updated');
    LIST_COLUMNS.splice(updatedIndex < 0 ? LIST_COLUMNS.length : updatedIndex, 0, { key: 'created', label: 'Date of Creation' });
  }
  state.columnWidths.created = Number(state.columnWidths.created) || 165;
  if (!state.columnOrder.includes('created')) {
    const updatedIndex = state.columnOrder.indexOf('updated');
    state.columnOrder.splice(updatedIndex < 0 ? state.columnOrder.length : updatedIndex, 0, 'created');
  }
  if (!Object.hasOwn(state.columnFilters, 'created')) state.columnFilters.created = new Set();
  try {
    localStorage.setItem('shg-column-order', JSON.stringify(state.columnOrder));
    localStorage.setItem('shg-column-widths', JSON.stringify(state.columnWidths));
  } catch {}

  state.weeklyMode64 = false;
  state.duplicateMode64 = false;
  state.duplicateScores64 = new Map();

  function monday64(value = new Date()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date;
  }
  const weekKey64 = value => monday64(value).toISOString().slice(0, 10);
  function weekLabel64(value) {
    const start = monday64(value), end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.toLocaleDateString('en-GB')} – ${end.toLocaleDateString('en-GB')}`;
  }

  function rollWeeklyTasks64() {
    const currentWeek = weekKey64(), changedAt = new Date().toISOString();
    let changed = false;
    for (const task of state.tasks) {
      const assignments = task.weeklyAssignments || {};
      for (const [name, assignment] of Object.entries(assignments)) {
        if (!assignment?.weekStart || assignment.weekStart >= currentWeek) continue;
        const oldWeek = assignment.weekStart;
        assignments[name] = { ...assignment, weekStart: currentWeek, carriedAt: changedAt };
        task.comments = task.comments || [];
        task.comments.unshift({
          id: `weekly-rollover-${task.id}-${name}-${currentWeek}`,
          author: 'System', role: 'System', system: true, automationType: 'weekly-rollover',
          text: `Weekly Task for ${name} moved from ${weekLabel64(oldWeek)} to ${weekLabel64(currentWeek)}.`,
          images: [], createdAt: changedAt,
        });
        task.audit = task.audit || [];
        task.audit.unshift(`Weekly Task for ${name} carried into ${weekLabel64(currentWeek)}`);
        task.updated = changedAt;
        changed = true;
      }
      task.weeklyAssignments = assignments;
    }
    if (changed) save();
  }

  function weeklyForCurrentUser64(task) {
    return Boolean(task?.weeklyAssignments?.[CURRENT_USER]);
  }

  const priorListSourceRows64 = listSourceRows;
  listSourceRows = function version64ListSourceRows() {
    let rows = priorListSourceRows64().map(row => {
      const task = state.tasks.find(item => item.id === row.id);
      return { ...row, created: task?.created || row.created || task?.updated || row.updated || null };
    });
    if (state.weeklyMode64) rows = rows.filter(row => weeklyForCurrentUser64(state.tasks.find(task => task.id === row.id)));
    return rows;
  };

  // Main Admins see and sort their own personal Last Checked values.
  const priorColumnVisible64 = isColumnVisible;
  isColumnVisible = function version64ColumnVisible(key) {
    if (key === 'lastChecked') return isMainAdmin64(CURRENT_USER) && !state.hiddenColumns.has('lastChecked');
    return priorColumnVisible64(key);
  };

  const priorSortRows64 = sortListRows;
  sortListRows = function version64SortRows(rows) {
    const special = state.listSort.find(sort => ['lastChecked', 'created'].includes(sort.key));
    if (!special) return priorSortRows64(rows);
    const remaining = state.listSort.filter(sort => sort !== special), saved = state.listSort;
    state.listSort = remaining;
    const base = remaining.length ? priorSortRows64(rows) : [...rows];
    state.listSort = saved;
    const value = row => {
      const task = state.tasks.find(item => item.id === row.id);
      return new Date(special.key === 'lastChecked' ? task?.lastChecks?.[CURRENT_USER] || 0 : task?.created || row.created || 0).getTime() || 0;
    };
    return base.sort((a, b) => special.direction === 'asc' ? value(a) - value(b) : value(b) - value(a));
  };

  const priorOpenTask64 = openTask;
  openTask = function version64OpenTask(id, preserveDirty = false) {
    const task = state.tasks.find(item => item.id === id);
    if (task && !preserveDirty && canRecordLastCheck64()) {
      task.lastChecks = { ...(task.lastChecks || {}), [CURRENT_USER]: new Date().toISOString() };
      save();
    }
    const result = priorOpenTask64(id, preserveDirty);
    if (task && !preserveDirty && canRecordLastCheck64() && state.appSection === 'tasks') renderList();
    return result;
  };

  // Rebuild the list row so Date of Creation stays aligned with every other managed column.
  listRowHTML = function version64ListRowHTML(row) {
    const task = state.tasks.find(item => item.id === row.id), status = task?.jiraStatus || row.status;
    const selected = state.selectedTasks.has(row.id), isSubtask = Boolean(row.parent);
    const cells = {
      code: `<td class="code-cell"><strong class="key-link">${esc(row.id)}</strong></td>`,
      work: workCell(row), creator: `<td>${personCell(row.creator)}</td>`,
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
    const drag = isSubtask ? '' : `draggable="true" ondragstart="startTaskDrag('${row.id}',event)" ondragover="dragOverTaskRow('${row.id}',event)" ondragleave="event.currentTarget.classList.remove('task-drop-before','task-drop-after')" ondrop="dropTaskRow('${row.id}',event)" ondragend="endTaskDrag()"`;
    return `<tr ${drag} oncontextmenu="openTaskContextMenu('${row.id}',event)" data-task-row="${row.id}" class="${selected ? 'selected-row ' : ''}${isSubtask ? 'subtask-row ' : ''}${task?.isMiniTask ? 'mini-task-row' : ''}"><td class="check-col" onclick="event.stopPropagation()"><input type="checkbox" aria-label="Select ${row.id}" ${selected ? 'checked' : ''} onchange="toggleTaskSelection('${row.id}',this.checked)"></td>${orderedColumns().filter(column => isColumnVisible(column.key)).map(column => cells[column.key] || '').join('')}</tr>`;
  };

  function normalise64(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9α-ω]+/gi, ' ').replace(/\s+/g, ' ').trim();
  }
  function tokenSet64(value) {
    const stop = new Set(['και','να','το','τη','την','του','της','των','στο','στη','σε','με','για','απο','που','the','and','for','with','from','task']);
    return new Set(normalise64(value).split(' ').filter(word => word.length > 2 && !stop.has(word)));
  }
  function duplicateScore64(a, b) {
    const left = tokenSet64(`${a.title} ${a.description || ''}`), right = tokenSet64(`${b.title} ${b.description || ''}`);
    if (!left.size || !right.size) return 0;
    const shared = [...left].filter(word => right.has(word)).length;
    const tokenScore = shared / Math.max(1, new Set([...left, ...right]).size);
    const leftTitle = normalise64(a.title), rightTitle = normalise64(b.title);
    const containment = leftTitle.length > 12 && rightTitle.length > 12 && (leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) ? 0.92 : 0;
    return Math.max(tokenScore, containment);
  }
  function duplicatePairs64() {
    const tasks = state.tasks.filter(task => !isTaskDeleted(task) && canAppearInMainFilter(task));
    const pairs = [];
    for (let i = 0; i < tasks.length; i += 1) for (let j = i + 1; j < tasks.length; j += 1) {
      const score = duplicateScore64(tasks[i], tasks[j]);
      if (score >= 0.48) pairs.push({ first: tasks[i], second: tasks[j], score });
    }
    return pairs.sort((a, b) => b.score - a.score);
  }

  window.openDuplicateFinder64 = () => {
    const pairs = duplicatePairs64();
    state.duplicateScores64 = new Map();
    for (const pair of pairs) for (const task of [pair.first, pair.second]) state.duplicateScores64.set(task.id, Math.max(state.duplicateScores64.get(task.id) || 0, pair.score));
    state.duplicateMode64 = pairs.length > 0;
    if (state.appSection === 'tasks') renderList();
    document.getElementById('modalContent').innerHTML = `<p class="eyebrow">DUPLICATE REVIEW</p><h2 id="modalTitle">Possible duplicate Tasks</h2><p class="modal-sub">${pairs.length ? `${pairs.length} possible pair${pairs.length === 1 ? '' : 's'} found. The strongest matches now appear first in Tasks.` : 'No sufficiently similar Tasks were found.'}</p><div class="duplicate-pairs64">${pairs.slice(0, 100).map(pair => `<article><strong>${Math.round(pair.score * 100)}% match</strong><button type="button" onclick="closeModal(true);openTask('${pair.first.id}')"><b>${esc(pair.first.id)}</b>${esc(pair.first.title)}</button><button type="button" onclick="closeModal(true);openTask('${pair.second.id}')"><b>${esc(pair.second.id)}</b>${esc(pair.second.title)}</button></article>`).join('')}</div>`;
    showModal();
  };
  window.clearDuplicateFinder64 = () => { state.duplicateMode64 = false; state.duplicateScores64 = new Map(); renderList(); toast('Duplicate ranking cleared'); };

  const priorHierarchy64 = hierarchicalListRows;
  hierarchicalListRows = function version64Hierarchy(rows) {
    const output = priorHierarchy64(rows);
    if (!state.duplicateMode64) return output;
    return [...output].sort((a, b) => (state.duplicateScores64.get(b.id) || 0) - (state.duplicateScores64.get(a.id) || 0));
  };

  window.toggleWeeklyTasks64 = () => { state.weeklyMode64 = !state.weeklyMode64; state.taskPage = 1; render(); };
  window.addSelectedWeekly64 = () => {
    if (!canManageWeekly64()) return toast('Only a Main Admin can manage Weekly Tasks');
    const selected = state.tasks.filter(task => state.selectedTasks.has(task.id));
    if (!selected.length) return toast('Select at least one Task first');
    const changedAt = new Date().toISOString(), weekStart = weekKey64();
    for (const task of selected) {
      task.weeklyAssignments = { ...(task.weeklyAssignments || {}), [CURRENT_USER]: { weekStart, assignedAt: changedAt, assignedBy: authenticatedUser64() } };
      task.audit = task.audit || []; task.audit.unshift(`Added to ${CURRENT_USER}'s Weekly Tasks by ${authenticatedUser64()}`);
    }
    state.selectedTasks.clear(); save(); render(); toast(`${selected.length} Task${selected.length === 1 ? '' : 's'} added to ${CURRENT_USER}'s week`);
  };
  window.removeSelectedWeekly64 = () => {
    if (!canManageWeekly64()) return toast('Only a Main Admin can manage Weekly Tasks');
    const selected = state.tasks.filter(task => state.selectedTasks.has(task.id) && task.weeklyAssignments?.[CURRENT_USER]);
    if (!selected.length) return toast('Select Weekly Tasks to remove');
    for (const task of selected) {
      const assignments = { ...(task.weeklyAssignments || {}) }; delete assignments[CURRENT_USER]; task.weeklyAssignments = assignments;
      task.audit = task.audit || []; task.audit.unshift(`Removed from ${CURRENT_USER}'s Weekly Tasks by ${authenticatedUser64()}`);
    }
    state.selectedTasks.clear(); save(); render(); toast(`${selected.length} Task${selected.length === 1 ? '' : 's'} removed from the week`);
  };

  const priorSavedControls64 = savedFilterControls;
  savedFilterControls = function version64SavedControls() {
    const duplicate = state.duplicateMode64 ? '<button type="button" class="find-duplicates64 active" onclick="clearDuplicateFinder64()">Clear Duplicates</button>' : '<button type="button" class="find-duplicates64" onclick="openDuplicateFinder64()">Find Duplicates</button>';
    const manager = canManageWeekly64() ? `<button type="button" onclick="addSelectedWeekly64()">Add selected to ${esc(CURRENT_USER)} Weekly</button>${state.weeklyMode64 ? '<button type="button" onclick="removeSelectedWeekly64()">Remove selected from Weekly</button>' : ''}` : '';
    return `${priorSavedControls64()}${duplicate}${manager}`;
  };

  function ensureWeeklyTab64() {
    const toolbar = document.getElementById('taskToolbarFilters');
    if (!toolbar || document.getElementById('weeklyTasksTab64')) return;
    const button = document.createElement('button');
    button.id = 'weeklyTasksTab64'; button.type = 'button'; button.dataset.filterKey = 'weeklyTasks'; button.className = 'filter-btn weekly-tab64';
    button.onclick = window.toggleWeeklyTasks64; toolbar.appendChild(button);
  }

  const priorRender64 = render;
  render = function version64Render() {
    applyVersion64(); ensureWeeklyTab64();
    const button = document.getElementById('weeklyTasksTab64');
    if (button) { button.textContent = `Weekly Tasks · ${CURRENT_USER}`; button.classList.toggle('active', state.weeklyMode64); }
    const result = priorRender64();
    applyVersion64();
    return result;
  };

  const style = document.createElement('style');
  style.textContent = `.weekly-tab64.active,.find-duplicates64.active{background:#173b74;color:#fff;border-color:#173b74}.duplicate-pairs64{display:grid;gap:12px;max-height:55vh;overflow:auto}.duplicate-pairs64 article{border:1px solid #dce4ef;border-radius:12px;padding:12px;display:grid;gap:7px}.duplicate-pairs64 article>strong{color:#2563eb}.duplicate-pairs64 button{text-align:left;border:0;background:#f5f8fc;border-radius:8px;padding:9px;display:flex;gap:10px}.duplicate-pairs64 button b{color:#2563eb;min-width:72px}.list-heading-actions>button{white-space:nowrap}`;
  document.head.appendChild(style);

  ensureWeeklyTab64(); rollWeeklyTasks64(); applyVersion64(); render();
  window.addEventListener('shg:remote-ready', () => { rollWeeklyTasks64(); applyVersion64(); render(); });
})();
