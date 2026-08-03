/* Mailo Version 51 enhancements. Loaded after app.js. */
(() => {
  const MAIN_ADMIN_NAME = 'Victor Stavropoulos';
  const mainAdminNames = new Set([MAIN_ADMIN_NAME, ...(window.SHG_REMOTE_BOOTSTRAP?.mainAdminNames || [])]);
  const isMain = () => mainAdminNames.has(CURRENT_USER);
  isMainAdmin = isMain;
  let includeMiniTasks = Boolean(state.viewMiniTasks);
  const humanComment = comment => !comment?.system;
  const activeScheduledTasks = () => state.tasks.filter(task => task.scheduledFor && new Date(task.scheduledFor) > new Date());

  // Normal Tasks are the default. “Include Mini Tasks” adds Mini Tasks.
  const baseListSourceRows = listSourceRows;
  listSourceRows = function version51ListSourceRows() {
    return baseListSourceRows().filter(row => {
      const task = state.tasks.find(item => item.id === row.id);
      if (!task || (task.scheduledFor && new Date(task.scheduledFor) > new Date())) return false;
      return includeMiniTasks || !task.isMiniTask;
    });
  };

  // The legacy checkbox meant “show only Mini Tasks”. Version 51 changes it to
  // an additive filter while preserving saved-filter compatibility.
  const baseRenderList = renderList;
  renderList = function version51RenderList() {
    const savedValue = state.viewMiniTasks;
    state.viewMiniTasks = false;
    baseRenderList();
    state.viewMiniTasks = savedValue;
    const checkbox = document.getElementById('viewMiniTasksFilter');
    if (checkbox) checkbox.checked = includeMiniTasks;
    const heading = document.querySelector('#listView .list-heading strong');
    if (heading && includeMiniTasks) heading.textContent += ' · Including Mini Tasks';
  };
  const miniFilter = document.getElementById('viewMiniTasksFilter');
  if (miniFilter) {
    const label = miniFilter.closest('label');
    if (label) label.lastChild.textContent = ' Include Mini Tasks';
    miniFilter.checked = includeMiniTasks;
    miniFilter.onchange = event => {
      includeMiniTasks = event.target.checked;
      state.viewMiniTasks = includeMiniTasks;
      state.taskPage = 1;
      renderList();
    };
  }

  // Opening Tasks always clears the selected Space.
  document.querySelector('.main-nav [data-view="board"]')?.addEventListener('click', () => {
    state.project = 'all';
    state.taskPage = 1;
    const crumb = document.getElementById('projectCrumb');
    if (crumb) crumb.textContent = 'ALL SPACES';
  }, true);

  function lastCheckFor(task) {
    return task?.lastChecks?.[CURRENT_USER] || null;
  }

  const baseIsColumnVisible = isColumnVisible;
  isColumnVisible = function version51ColumnVisible(key) {
    if (key === 'lastChecked' && !isMain()) return false;
    return baseIsColumnVisible(key);
  };

  const baseListRowHTML = listRowHTML;
  listRowHTML = function version51ListRowHTML(row) {
    let html = baseListRowHTML(row);
    if (isMain() && isColumnVisible('lastChecked')) {
      const task = state.tasks.find(item => item.id === row.id);
      const value = lastCheckFor(task);
      html = html.replace('</tr>', `<td>${value ? formatDateTime(value) : '<span class="none-value">Never checked</span>'}</td></tr>`);
    }
    return html;
  };

  // Add Creator and Last Check to Task details and record each Main Admin visit.
  const baseOpenTask = openTask;
  openTask = function version51OpenTask(id, preserveDirty = false) {
    const task = state.tasks.find(item => item.id === id);
    if (task && isMain() && !preserveDirty) {
      task.lastChecks = { ...(task.lastChecks || {}), [CURRENT_USER]: new Date().toISOString() };
      save();
    }
    baseOpenTask(id, preserveDirty);
    if (!task || taskDetailsDraft?.id !== id) return;
    if (!Object.hasOwn(taskDetailsDraft, 'creator')) taskDetailsDraft.creator = task.creator || 'Unknown';
    const grid = document.querySelector('#modalContent .detail-grid');
    if (grid && !grid.querySelector('.detail-creator-item')) {
      const options = sortedPeople().map(person => `<option value="${esc(person.name)}" ${person.name === taskDetailsDraft.creator ? 'selected' : ''}>${esc(person.name)}</option>`).join('');
      grid.insertAdjacentHTML('afterbegin', `<div class="detail-item detail-creator-item"><span>Creator</span>${isMain() ? `<select class="detail-select" onchange="changeTaskCreatorFromDetails('${esc(id)}',this.value)">${options}</select>` : `<strong>${esc(taskDetailsDraft.creator)}</strong>`}</div>`);
    }
    const description = document.querySelector('#modalContent > .description');
    if (description && !description.previousElementSibling?.classList.contains('description-heading')) {
      description.insertAdjacentHTML('beforebegin', '<h4 class="description-heading">Description</h4>');
    }
    if (isMain()) {
      const eyebrow = document.querySelector('#modalContent .eyebrow');
      const checkedAt = lastCheckFor(task);
      eyebrow?.insertAdjacentHTML('afterend', `<div class="last-check-detail"><strong>Last Check</strong><span>${checkedAt ? formatDateTime(checkedAt) : 'Never checked'}</span></div>`);
    }
    requestAnimationFrame(linkifyTaskReferences);
  };

  window.changeTaskCreatorFromDetails = (id, name) => {
    if (!isMain() || taskDetailsDraft?.id !== id) return;
    taskDetailsDraft.creator = name;
    markTaskDetailsDirty(id);
  };

  const baseSubmitTaskDetails = submitTaskDetails;
  submitTaskDetails = function version51SubmitTaskDetails(id) {
    const task = state.tasks.find(item => item.id === id);
    const oldCreator = task?.creator || 'Unknown';
    const newCreator = taskDetailsDraft?.creator || oldCreator;
    const changed = isMain() && oldCreator !== newCreator;
    if (changed && task) {
      task.creator = newCreator;
      addSystemComment(task, `Ο Creator άλλαξε από @${oldCreator} σε @${newCreator}. Η αλλαγή έγινε από ${CURRENT_USER} (Main Admin).`, new Date().toISOString(), 'creator-change');
      task.audit.unshift(`Creator changed from ${oldCreator} to ${newCreator} by ${CURRENT_USER}`);
    }
    baseSubmitTaskDetails(id);
  };

  const baseApproverControl = taskDetailApproverControl;
  taskDetailApproverControl = function version51ApproverControl(task) {
    if (!isMain()) return baseApproverControl(task);
    const value = taskDetailsDraft?.approver || task.approver || 'None';
    const choices = [...new Set(['None', value, DEFAULT_APPROVER, ...state.approvers, ...sortedPeople().map(person => person.name)])];
    return `<select class="detail-select" onchange="changeTaskApproverFromDetails('${task.id}',this.value)">${choices.map(name => `<option value="${esc(name)}" ${name === value ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
  };
  const baseCellOptions = cellOptions;
  cellOptions = function version51CellOptions(key) {
    if (key === 'approver' && isMain()) return [...new Set(['None', DEFAULT_APPROVER, ...state.approvers])];
    return baseCellOptions(key);
  };

  // Unsaved creation forms receive the same protection as edited Tasks.
  let creationFormDirty = false;
  const baseShowModal = showModal;
  showModal = function version51ShowModal(taskDetails = false) {
    baseShowModal(taskDetails);
    if (!taskDetails) {
      creationFormDirty = false;
      const form = document.querySelector('#modalContent form.task-form');
      form?.addEventListener('input', () => { creationFormDirty = true; });
      form?.addEventListener('change', () => { creationFormDirty = true; });
    }
  };
  const baseCloseModal = closeModal;
  closeModal = function version51CloseModal(discard = false) {
    if (!discard && creationFormDirty && !document.querySelector('#modalBackdrop .task-details-modal')) {
      if (!confirm('You have unsaved changes. Leave without saving them?')) return false;
    }
    creationFormDirty = false;
    return baseCloseModal(discard);
  };

  // Clear image preview inside the application instead of opening a broken new tab.
  window.openCommentImagePreview = src => {
    let overlay = document.getElementById('commentImagePreview');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'commentImagePreview';
      overlay.className = 'comment-image-preview hidden';
      overlay.innerHTML = '<button type="button" aria-label="Close image preview">×</button><img alt="Comment attachment preview">';
      overlay.addEventListener('click', event => { if (event.target === overlay || event.target.tagName === 'BUTTON') overlay.classList.add('hidden'); });
      document.body.appendChild(overlay);
    }
    overlay.querySelector('img').src = src;
    overlay.classList.remove('hidden');
  };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') document.getElementById('commentImagePreview')?.classList.add('hidden'); });
  document.addEventListener('click', event => {
    const image = event.target.closest('.comment-images img');
    if (!image) return;
    event.preventDefault();
    openCommentImagePreview(image.src);
  });

  function linkifyTaskReferences() {
    const roots = document.querySelectorAll('#modalContent .comment p, #modalContent .description');
    const pattern = /\b([A-Z]{2,4}-\d+)\b/g;
    for (const root of roots) {
      if (root.dataset.linkified === 'true') continue;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        if (!pattern.test(node.nodeValue || '')) continue;
        pattern.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const match of node.nodeValue.matchAll(pattern)) {
          fragment.append(node.nodeValue.slice(cursor, match.index));
          const exists = state.tasks.some(task => task.id === match[1] && canAppearInMainFilter(task));
          if (exists) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'inline-task-link'; button.textContent = match[1];
            button.onclick = () => openTask(match[1]); fragment.append(button);
          } else fragment.append(match[1]);
          cursor = match.index + match[1].length;
        }
        fragment.append(node.nodeValue.slice(cursor));
        node.replaceWith(fragment);
      }
      root.dataset.linkified = 'true';
    }
  }

  function businessMilliseconds(start, end) {
    let cursor = new Date(start), finish = new Date(end), total = 0;
    if (!(cursor < finish)) return 0;
    while (cursor < finish) {
      const next = new Date(Math.min(finish, new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1).getTime()));
      if (![0, 6].includes(cursor.getDay())) total += next - cursor;
      cursor = next;
    }
    return total;
  }
  const duration = ms => ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))}m` : ms < 86400000 ? `${(ms / 3600000).toFixed(1)}h` : `${(ms / 86400000).toFixed(1)}d`;
  function mentionResponseRows() {
    const rows = [];
    for (const task of state.tasks) {
      const comments = [...(task.comments || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      for (let i = 0; i < comments.length; i++) {
        const source = comments[i];
        for (const person of PEOPLE) {
          if (!new RegExp(`@${person.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(source.text || '')) continue;
          const reply = comments.slice(i + 1).find(comment => humanComment(comment) && comment.author === person.name);
          rows.push({ person: person.name, task, source, reply, ms: reply ? businessMilliseconds(source.createdAt, reply.createdAt) : null });
        }
      }
    }
    return rows;
  }
  function overviewEnhancements() {
    const view = document.getElementById('overviewView');
    if (!view || view.querySelector('.version51-overview')) return;
    const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
    const progress = state.tasks.flatMap(task => (task.progressLog || []).map(entry => ({ task, ...entry }))).filter(entry => new Date(entry.at) >= monthAgo && (isMain() || entry.assignee === CURRENT_USER));
    const progressRows = progress.map(entry => `<tr class="overview-clickable-task" onclick="openTask('${entry.task.id}')"><td><strong>${esc(entry.task.id)}</strong> ${esc(entry.task.title)}</td><td>${esc(entry.assignee)}</td><td>${formatDateTime(entry.at)}</td></tr>`).join('');
    let adminPanels = '';
    if (isMain()) {
      const responseRows = mentionResponseRows();
      const grouped = sortedPeople().map(person => {
        const records = responseRows.filter(row => row.person === person.name), answered = records.filter(row => row.ms !== null);
        const average = answered.length ? answered.reduce((sum, row) => sum + row.ms, 0) / answered.length : null;
        return `<tr><td>${personCell(person.name)}</td><td>${answered.length}</td><td>${records.length - answered.length}</td><td>${average === null ? '—' : duration(average)}</td></tr>`;
      }).join('');
      const transitionRows = sortedPeople().map(person => {
        const owned = state.tasks.filter(task => (task.progressLog || []).some(entry => entry.assignee === person.name));
        const starts = owned.flatMap(task => (task.progressLog || []).filter(entry => entry.assignee === person.name).map(entry => new Date(entry.at) - new Date(task.lastStatusChangedAt || task.created))).filter(ms => ms >= 0);
        const reviews = owned.flatMap(task => (task.statusHistory || []).filter(entry => entry.from === 'progress' && entry.to === 'review' && entry.assignee === person.name).map(entry => entry.durationMs)).filter(ms => Number.isFinite(ms));
        return `<tr><td>${personCell(person.name)}</td><td>${starts.length ? duration(starts.reduce((a,b)=>a+b,0)/starts.length) : '—'}</td><td>${reviews.length ? duration(reviews.reduce((a,b)=>a+b,0)/reviews.length) : '—'}</td></tr>`;
      }).join('');
      adminPanels = `<section class="overview-panel"><h2>Response Rate</h2><p>Business-time response to mentions; weekends are excluded.</p><div class="managed-table-scroll"><table class="managed-table"><thead><tr><th>User</th><th>Answered</th><th>Unanswered</th><th>Average response</th></tr></thead><tbody>${grouped}</tbody></table></div></section><section class="overview-panel"><h2>Task Flow Time</h2><p>Average time per Assignee.</p><div class="managed-table-scroll"><table class="managed-table"><thead><tr><th>User</th><th>To Do → In Progress</th><th>In Progress → In Review</th></tr></thead><tbody>${transitionRows}</tbody></table></div></section>`;
    }
    view.insertAdjacentHTML('beforeend', `<div class="version51-overview">${adminPanels}<section class="overview-panel"><h2>Moved to In Progress · Last month</h2><p>${progress.length} Task${progress.length === 1 ? '' : 's'}</p><div class="managed-table-scroll"><table class="managed-table"><thead><tr><th>Task</th><th>Assignee</th><th>Date & time</th></tr></thead><tbody>${progressRows || '<tr><td colspan="3">No Tasks in this period.</td></tr>'}</tbody></table></div></section></div>`);
  }
  const baseRenderOverview = renderOverview;
  renderOverview = function version51Overview() { baseRenderOverview(); overviewEnhancements(); };

  // Track status transitions with the Assignee at the time of the change.
  const baseAddStatusChangeComment = addStatusChangeComment;
  addStatusChangeComment = function version51StatusHistory(task, from, to, changedAt) {
    task.statusHistory = task.statusHistory || [];
    const previous = task.statusHistory.at(-1);
    task.statusHistory.push({ from, to, at: changedAt, assignee: task.assignee || 'Unassigned', durationMs: previous ? new Date(changedAt) - new Date(previous.at) : new Date(changedAt) - new Date(task.created) });
    return baseAddStatusChangeComment(task, from, to, changedAt);
  };

  // Scheduled Main Admin comments. They remain server-synced as Task metadata.
  const baseCommentSection = commentSection;
  commentSection = function version51CommentSection(task) {
    let html = baseCommentSection(task);
    if (!isMain()) return html;
    const controls = `<fieldset class="comment-schedule"><legend>Schedule comment</legend><label><input type="checkbox" name="scheduleEnabled"> Date & time</label><input type="datetime-local" name="scheduledAt"><label>Recurring<select name="recurring"><option value="">No</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label><input type="checkbox" name="ifNoAnswer"> If no answer, send scheduled comment</label><label>Wait hours<input type="number" name="noAnswerHours" min="1" value="24"></label></fieldset>`;
    return html.replace('<div class="comment-tools">', `${controls}<div class="comment-tools">`);
  };
  const baseAddComment = addComment;
  addComment = async function version51AddComment(id, event) {
    const form = event.currentTarget;
    if (!isMain() || !form.elements.scheduleEnabled?.checked) return baseAddComment(id, event);
    event.preventDefault();
    const text = form.elements.comment.value.trim(), scheduledAt = form.elements.scheduledAt.value;
    if (!text || !scheduledAt || new Date(scheduledAt) <= new Date()) { toast('Enter a comment and a future date and time'); return; }
    const task = state.tasks.find(item => item.id === id);
    task.scheduledComments = task.scheduledComments || [];
    task.scheduledComments.push({ id: `scheduled-${Date.now()}`, text, scheduledAt: new Date(scheduledAt).toISOString(), recurring: form.elements.recurring.value, ifNoAnswer: form.elements.ifNoAnswer.checked, noAnswerHours: Number(form.elements.noAnswerHours.value || 24), createdAt: new Date().toISOString(), createdBy: CURRENT_USER });
    save(); openTask(id); toast('Comment scheduled');
  };

  function processSchedules() {
    const now = new Date(); let changed = false;
    for (const task of state.tasks) {
      for (const schedule of task.scheduledComments || []) {
        if (schedule.sent || new Date(schedule.scheduledAt) > now) continue;
        const cutoff = new Date(new Date(schedule.scheduledAt).getTime() - schedule.noAnswerHours * 3600000);
        const answered = schedule.ifNoAnswer && (task.comments || []).some(comment => humanComment(comment) && new Date(comment.createdAt) > cutoff);
        if (!answered) {
          task.comments.unshift({ id: `comment-${Date.now()}-${Math.random().toString(36).slice(2)}`, author: schedule.createdBy, role: 'Main Admin', text: schedule.text, images: [], createdAt: now.toISOString(), human: true, scheduled: true });
          task.lastHumanActivityAt = now.toISOString();
        }
        if (schedule.recurring) {
          const next = new Date(schedule.scheduledAt);
          if (schedule.recurring === 'daily') next.setDate(next.getDate() + 1);
          if (schedule.recurring === 'weekly') next.setDate(next.getDate() + 7);
          if (schedule.recurring === 'monthly') next.setMonth(next.getMonth() + 1);
          schedule.scheduledAt = next.toISOString();
        } else schedule.sent = true;
        changed = true;
      }
      if (task.scheduledFor && new Date(task.scheduledFor) <= now) { delete task.scheduledFor; sendTaskCreatedEmails(task); changed = true; }
    }
    if (changed) { save(); render(); }
  }
  setInterval(processSchedules, 60000); processSchedules();

  function addTaskScheduleControl() {
    if (!isMain()) return;
    const form = document.querySelector('#modalContent form.task-form');
    if (!form || form.querySelector('[name="scheduledFor"]')) return;
    form.querySelector('button[type="submit"]')?.insertAdjacentHTML('beforebegin', '<div class="field scheduled-task-field"><label>Schedule creation (optional)</label><input type="datetime-local" name="scheduledFor"><small>The Task will become visible and notifications will be sent at this time.</small></div>');
    const baseSubmit = form.onsubmit;
    form.onsubmit = event => {
      const value = form.elements.scheduledFor?.value;
      if (!value) return baseSubmit(event);
      if (new Date(value) <= new Date()) { event.preventDefault(); toast('Choose a future date and time'); return; }
      const before = new Set(state.tasks);
      const originalEmailSender = sendTaskCreatedEmails;
      sendTaskCreatedEmails = () => {};
      try { baseSubmit(event); } finally { sendTaskCreatedEmails = originalEmailSender; }
      const created = state.tasks.find(task => !before.has(task));
      if (created) { created.scheduledFor = new Date(value).toISOString(); save(); render(); toast(`${created.id} scheduled for ${formatDateTime(created.scheduledFor)}`); }
    };
  }
  const baseNewTaskModal = newTaskModal;
  newTaskModal = function version51NewTask() { baseNewTaskModal(); addTaskScheduleControl(); };
  const baseMiniTaskModal = miniTaskModal;
  miniTaskModal = function version51MiniTask() { baseMiniTaskModal(); addTaskScheduleControl(); };
  document.getElementById('newTaskBtn').onclick = newTaskModal;
  document.getElementById('miniTaskBtn').onclick = miniTaskModal;
  document.getElementById('mobileNewTaskBtn').onclick = newTaskModal;

  // Main Admin role management. Victor is immutable.
  const baseRenderUsers = renderUsers;
  renderUsers = function version51Users() {
    baseRenderUsers();
    if (!isMain()) return;
    document.querySelectorAll('#usersTable tbody tr').forEach(row => {
      const name = row.querySelector('.table-person')?.textContent?.trim();
      const select = row.querySelector('td:nth-child(4) select');
      if (!select || name === MAIN_ADMIN_NAME) return;
      if (![...select.options].some(option => option.value === 'main_admin')) select.insertAdjacentHTML('beforeend', `<option value="main_admin" ${mainAdminNames.has(name) ? 'selected' : ''}>Main Admin</option>`);
      select.value = mainAdminNames.has(name) ? 'main_admin' : (state.admins.has(name) ? 'admin' : 'user');
    });
  };
  const baseSetUserAdmin = setUserAdmin;
  setUserAdmin = async function version51SetUserRole(name, role) {
    if (role !== 'main_admin') return baseSetUserAdmin(name, role);
    if (!isMain()) return;
    const person = PEOPLE.find(item => item.name === name);
    if (!person?.id) { toast('This user must be synchronized before editing'); return; }
    try {
      await window.shgInvokeFunction('admin-set-user-role', { user_id: person.id, role: 'main_admin' });
      mainAdminNames.add(name); state.admins.add(name); saveAdmins(); render(); toast(`${name} is now a Main Admin`);
    } catch (error) { toast(error?.message || 'The role could not be changed'); }
  };

  render();
})();
