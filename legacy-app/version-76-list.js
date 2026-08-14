/* MAILO Version 76 — focused Task-list, label and drag/sort improvements. */
(() => {
  const DUPLICATE_THRESHOLD_76 = 0.48;
  const DUPLICATE_BATCH_SIZE_76 = 700;
  const PLACEHOLDER_LABELS_76 = new Set([
    '__create_new_label__',
    'create new label',
    '+ create new label',
  ]);
  const VICTOR_76 = 'Victor Stavropoulos';

  const cleanLabel76 = value => String(value || '').trim();
  const isRealLabel76 = value => !PLACEHOLDER_LABELS_76.has(cleanLabel76(value).toLowerCase());
  const uniqueLabels76 = values => [...new Set((values || []).map(cleanLabel76).filter(isRealLabel76))];
  const authenticatedUser76 = () => String(
    window.SHG_AUTH_USER_NAME
    || (typeof SESSION_USER !== 'undefined' ? SESSION_USER : '')
    || '',
  ).trim();
  const canManageGlobalLabels76 = () => authenticatedUser76() === VICTOR_76;
  const priorRenameLabel63 = window.renameLabel63;
  window.renameLabel63 = (...args) => {
    if (!canManageGlobalLabels76()) { toast('Only Victor can rename global Labels'); return; }
    return priorRenameLabel63?.(...args);
  };
  const priorDeleteLabel63 = window.deleteLabel63;
  window.deleteLabel63 = (...args) => {
    if (!canManageGlobalLabels76()) { toast('Only Victor can delete global Labels'); return; }
    return priorDeleteLabel63?.(...args);
  };
  const nextFrame76 = () => new Promise(resolve => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(resolve, { timeout: 80 });
    } else {
      window.setTimeout(resolve, 0);
    }
  });

  /*
   * Find Duplicates
   *
   * Version 64 ranked duplicate branches and then opened a second modal. The
   * Version 76 workflow keeps users in the Tasks table and filters that table
   * to the matching Tasks. Pair comparison yields between small batches so an
   * older laptop remains responsive while a large workspace is checked.
   */
  const baseListSourceRows76 = listSourceRows;

  function unfilteredSourceRows76() {
    const duplicateMode = Boolean(state.duplicateMode64);
    state.duplicateMode64 = false;
    try {
      return baseListSourceRows76();
    } finally {
      state.duplicateMode64 = duplicateMode;
    }
  }

  listSourceRows = function version76ListSourceRows() {
    const rows = baseListSourceRows76();
    if (!state.duplicateMode64) return rows;
    const matches = state.duplicateScores64 instanceof Map ? state.duplicateScores64 : new Map();
    return rows.filter(row => matches.has(row.id));
  };

  function normaliseDuplicateText76(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('el')
      .replace(/[^a-z0-9α-ω]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const duplicateStopWords76 = new Set([
    'και', 'να', 'το', 'τη', 'την', 'του', 'της', 'των', 'στο', 'στη', 'σε',
    'με', 'για', 'απο', 'που', 'the', 'and', 'for', 'with', 'from', 'task',
  ]);

  function duplicateFingerprint76(task) {
    const title = normaliseDuplicateText76(task?.title || task?.summary);
    const text = normaliseDuplicateText76(`${title} ${task?.description || ''}`);
    return {
      title,
      tokens: new Set(text.split(' ').filter(word => word.length > 2 && !duplicateStopWords76.has(word))),
    };
  }

  function duplicateScore76(left, right) {
    if (!left.tokens.size || !right.tokens.size) return 0;
    let shared = 0;
    const smaller = left.tokens.size <= right.tokens.size ? left.tokens : right.tokens;
    const larger = smaller === left.tokens ? right.tokens : left.tokens;
    for (const token of smaller) if (larger.has(token)) shared += 1;
    const unionSize = left.tokens.size + right.tokens.size - shared;
    const tokenScore = shared / Math.max(1, unionSize);
    const containment = left.title.length > 12
      && right.title.length > 12
      && (left.title.includes(right.title) || right.title.includes(left.title))
      ? 0.92
      : 0;
    return Math.max(tokenScore, containment);
  }

  function setDuplicateButtonProgress76(label, busy = true) {
    const button = document.querySelector('.find-duplicates64');
    if (!button) return;
    button.disabled = busy;
    button.classList.toggle('is-searching76', busy);
    button.textContent = label;
  }

  let duplicateRun76 = 0;
  window.openDuplicateFinder64 = async function version76OpenDuplicateFinder() {
    const run = ++duplicateRun76;
    state.duplicateMode64 = false;
    state.duplicateScores64 = new Map();
    const rows = unfilteredSourceRows76().filter(row => {
      const task = state.tasks.find(item => item.id === row.id);
      return task && !isTaskDeleted(task) && canAppearInMainFilter(task);
    });
    const candidates = rows.map(row => {
      const task = state.tasks.find(item => item.id === row.id);
      return { id: row.id, task, fingerprint: duplicateFingerprint76(task || row) };
    });
    const pairTotal = candidates.length * Math.max(0, candidates.length - 1) / 2;
    if (!pairTotal) {
      renderList();
      toast('No possible duplicate Tasks were found');
      return;
    }

    setDuplicateButtonProgress76('Finding duplicates… 0%');
    toast('Checking Tasks for possible duplicates…');
    let compared = 0;
    let leftIndex = 0;
    let rightIndex = 1;
    while (leftIndex < candidates.length - 1) {
      if (run !== duplicateRun76) return;
      let batch = 0;
      while (leftIndex < candidates.length - 1 && batch < DUPLICATE_BATCH_SIZE_76) {
        const left = candidates[leftIndex];
        const right = candidates[rightIndex];
        const score = duplicateScore76(left.fingerprint, right.fingerprint);
        if (score >= DUPLICATE_THRESHOLD_76) {
          state.duplicateScores64.set(left.id, Math.max(state.duplicateScores64.get(left.id) || 0, score));
          state.duplicateScores64.set(right.id, Math.max(state.duplicateScores64.get(right.id) || 0, score));
        }
        compared += 1;
        batch += 1;
        rightIndex += 1;
        if (rightIndex >= candidates.length) {
          leftIndex += 1;
          rightIndex = leftIndex + 1;
        }
      }
      setDuplicateButtonProgress76(`Finding duplicates… ${Math.min(99, Math.round(compared / pairTotal * 100))}%`);
      await nextFrame76();
    }

    if (run !== duplicateRun76) return;
    state.duplicateMode64 = state.duplicateScores64.size > 0;
    state.taskPage = 1;
    renderList();
    if (state.duplicateMode64) {
      toast(`${state.duplicateScores64.size} possible duplicate Tasks are shown in the table`);
    } else {
      toast('No possible duplicate Tasks were found');
    }
  };

  const baseClearDuplicateFinder76 = window.clearDuplicateFinder64;
  window.clearDuplicateFinder64 = function version76ClearDuplicateFinder() {
    duplicateRun76 += 1;
    state.duplicateMode64 = false;
    state.duplicateScores64 = new Map();
    state.taskPage = 1;
    if (typeof baseClearDuplicateFinder76 === 'function') {
      baseClearDuplicateFinder76();
    } else {
      renderList();
      toast('Duplicate filter cleared');
    }
  };

  /* Single-column sort: new column replaces the prior column; same column
     cycles ascending, descending, and unsorted. */
  function normaliseSingleSort76() {
    if (!Array.isArray(state.listSort)) state.listSort = [];
    if (state.listSort.length > 1) state.listSort = [state.listSort[0]];
  }

  setListSort = function version76SetListSort(key) {
    state.supervisedFirst = false;
    const current = state.listSort?.[0];
    if (!current || current.key !== key) {
      state.listSort = [{ key, direction: 'asc' }];
    } else if (current.direction === 'asc') {
      state.listSort = [{ key, direction: 'desc' }];
    } else {
      state.listSort = [];
    }
    state.taskPage = 1;
    renderList();
  };

  columnHeader = function version76ColumnHeader(key, label) {
    normaliseSingleSort76();
    const sort = state.listSort[0];
    const active = sort?.key === key;
    const arrow = active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
    const count = columnFilterCount(key);
    const open = state.openColumnMenu === key;
    const nextAction = !active ? 'ascending' : sort.direction === 'asc' ? 'descending' : 'off';
    return `<th data-header="${key}" draggable="true" ondragstart="startColumnDrag('${key}',event)" ondragover="dragOverColumn('${key}',event)" ondragleave="event.currentTarget.classList.remove('drop-before','drop-after')" ondrop="dropColumn('${key}',event)" ondragend="endColumnDrag(event)"><div class="column-header"><span class="drag-handle" title="Drag to reorder">⋮⋮</span><button class="filter-trigger ${count ? 'filtered' : ''}" onclick="toggleColumnMenu('${key}',event)">${label}${count ? `<b>${count}</b>` : ''}<i>▾</i></button><button class="sort-arrow ${active ? 'active' : ''}" title="Set ${label} sort ${nextAction}" aria-label="Set ${label} sort ${nextAction}" onclick="event.stopPropagation();setListSort('${key}')">${arrow}</button>${open ? columnMenu(key) : ''}</div><span class="column-resizer" title="Drag to resize · Double-click to fit content" onmousedown="startColumnResize('${key}',event)" ondblclick="autoSizeColumn('${key}',event)"></span></th>`;
  };

  /* Task-detail Labels use the label text stored on the checkbox itself. This
     avoids the old index lookup changing after a re-render or label sort. */
  function allLabels76(selected = []) {
    return uniqueLabels76([
      ...state.tasks.flatMap(task => task.labels || []),
      ...selected,
    ]).sort((a, b) => a.localeCompare(b, 'el', { sensitivity: 'base', numeric: true }));
  }

  window.toggleTaskDetailLabel76 = function version76ToggleTaskDetailLabel(input) {
    const details = input?.closest('.label-manager76');
    const id = details?.dataset.taskId76;
    const label = cleanLabel76(input?.dataset.label76);
    const task = state.tasks.find(item => item.id === id);
    if (!task || !label || !isRealLabel76(label) || taskDetailsDraft?.id !== id || !canEditTaskLabels(task)) return;
    const current = uniqueLabels76(taskDetailsDraft.labels || []);
    taskDetailsDraft.labels = input.checked
      ? uniqueLabels76([...current, label])
      : current.filter(value => value !== label);
    markTaskDetailsDirty(id);
    openTask(id, true);
  };

  window.renameTaskDetailLabel76 = button => {
    if (!canManageGlobalLabels76()) {
      toast('Only Victor can rename global Labels');
      return;
    }
    const label = button?.closest('[data-label76]')?.dataset.label76;
    if (!label) return;
    const next = prompt(`Rename label “${label}”`, label)?.trim();
    if (!next || next === label) return;
    for (const task of state.tasks) {
      task.labels = uniqueLabels76((task.labels || []).map(value => value === label ? next : value));
    }
    if (taskDetailsDraft?.id) {
      taskDetailsDraft.labels = uniqueLabels76((taskDetailsDraft.labels || []).map(value => value === label ? next : value));
      markTaskDetailsDirty(taskDetailsDraft.id);
    }
    save();
    if (taskDetailsDraft?.id) openTask(taskDetailsDraft.id, true); else render();
    toast(`Label renamed to ${next}`);
  };

  window.deleteTaskDetailLabel76 = button => {
    if (!canManageGlobalLabels76()) {
      toast('Only Victor can delete global Labels');
      return;
    }
    const label = button?.closest('[data-label76]')?.dataset.label76;
    if (!label || !confirm(`Delete label “${label}” from every Task?`)) return;
    for (const task of state.tasks) task.labels = (task.labels || []).filter(value => value !== label);
    if (taskDetailsDraft?.id) {
      taskDetailsDraft.labels = (taskDetailsDraft.labels || []).filter(value => value !== label);
      markTaskDetailsDirty(taskDetailsDraft.id);
    }
    save();
    if (taskDetailsDraft?.id) openTask(taskDetailsDraft.id, true); else render();
    toast(`Label “${label}” deleted`);
  };

  taskDetailLabelsControl = function version76TaskDetailLabelsControl(task) {
    const selected = uniqueLabels76(taskDetailsDraft?.id === task.id ? taskDetailsDraft.labels : task.labels);
    if (!canEditTaskLabels(task)) {
      return selected.length
        ? `<span class="detail-label-chips">${selected.map(label => `<b>${esc(label)}</b>`).join('')}</span>`
        : '<strong>None</strong>';
    }
    const values = allLabels76(selected);
    const createControl = canCreateTaskLabels(task)
      ? `<form onsubmit="createTaskDetailLabel('${task.id}',event)"><input name="label" maxlength="60" placeholder="Create new label…"><button type="submit">Add</button></form>`
      : '';
    const globalActions = canManageGlobalLabels76()
      ? `<button type="button" onclick="event.preventDefault();renameTaskDetailLabel76(this)">Edit</button><button type="button" class="danger" onclick="event.preventDefault();deleteTaskDetailLabel76(this)">×</button>`
      : '';
    return `<details class="detail-labels-control label-manager63 label-manager76" data-task-id76="${esc(task.id)}"><summary>${selected.length ? selected.map(esc).join(', ') : 'No labels'} <span>▾</span></summary><div><input class="label-search63" placeholder="Search labels…" oninput="filterLabels63(this)">${values.map(label => `<label data-label="${esc(label)}" data-label76="${esc(label)}"><input type="checkbox" data-label76="${esc(label)}" ${selected.includes(label) ? 'checked' : ''} onchange="toggleTaskDetailLabel76(this)"><span>${esc(label)}</span>${globalActions}</label>`).join('')}${createControl}</div></details>`;
  };

  /* Preserve an active sort during relation changes. A manual before/after row
     position has no visible meaning while a column sort is active, so that
     action is explicitly rejected instead of silently saving a hidden order. */
  const baseDropTaskRow76 = dropTaskRow;
  dropTaskRow = function version76DropTaskRow(targetId, event) {
    normaliseSingleSort76();
    if (!state.listSort.length) return baseDropTaskRow76(targetId, event);

    event.preventDefault();
    event.stopPropagation();
    const sourceId = state.draggedTask || event.dataTransfer?.getData('text/plain');
    const activeSort = state.listSort.map(item => ({ ...item }));
    if (!sourceId || sourceId === targetId) {
      endTaskDrag();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
    const inside = ratio >= 0.25 && ratio <= 0.75;

    if (inside) {
      const source = state.tasks.find(task => task.id === sourceId);
      const target = state.tasks.find(task => task.id === targetId);
      const confirmed = confirm(`Are you sure you want ${sourceId}${source?.title ? ` — ${source.title}` : ''} to become a subtask of ${targetId}${target?.title ? ` — ${target.title}` : ''}?`);
      if (!confirmed) {
        endTaskDrag();
        renderList();
        toast('Subtask creation cancelled; sorting remains active');
        return;
      }
      const convertedId = makeTaskSubtask(sourceId, targetId);
      state.listSort = activeSort;
      endTaskDrag();
      render();
      if (convertedId) toast(`${convertedId} is now a subtask of ${targetId}; sorting remains active`);
      return;
    }

    const source = state.tasks.find(task => task.id === sourceId);
    if (source?.parent) {
      const detached = detachSubtask(sourceId);
      state.listSort = activeSort;
      if (detached) save();
      endTaskDrag();
      renderList();
      toast(detached
        ? `${sourceId} is now a main Task; sorting remains active`
        : 'The Task relation was not changed');
      return;
    }

    state.listSort = activeSort;
    endTaskDrag();
    renderList();
    toast('This column is sorted, so manual row order was not changed. Clear the sort to reorder Tasks manually.');
  };

  const baseRenderList76 = renderList;
  renderList = function version76RenderList(...args) {
    normaliseSingleSort76();
    return baseRenderList76.apply(this, args);
  };

  // Version 64 used duplicate scores as a second hidden ranking layer. In
  // Version 76 duplicates are only a filter, so the visible column sort must
  // remain the single source of ordering.
  const baseHierarchicalListRows76 = hierarchicalListRows;
  hierarchicalListRows = function version76HierarchicalListRows(rows) {
    if (!state.duplicateMode64) return baseHierarchicalListRows76(rows);
    const duplicateMode = state.duplicateMode64;
    state.duplicateMode64 = false;
    try {
      return baseHierarchicalListRows76(rows);
    } finally {
      state.duplicateMode64 = duplicateMode;
    }
  };

  const style76 = document.createElement('style');
  style76.textContent = `
    .find-duplicates64.is-searching76{cursor:progress;opacity:.78}
    .label-manager76>div>label{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:8px}
    .label-manager76>div>label>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  `;
  document.head.appendChild(style76);

  normaliseSingleSort76();
})();
