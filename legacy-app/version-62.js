/* MAILO Version 62 — Task Chat hierarchy, reliable access, schedules and browser recovery. */
(() => {
  const VICTOR = 'Victor Stavropoulos';
  const isVictor = () => String(window.SHG_AUTH_USER_NAME || SESSION_USER || '') === VICTOR && CURRENT_USER === VICTOR;
  const serverRole = name => name === VICTOR ? 'main_admin' : (window.SHG_REMOTE_BOOTSTRAP?.roleByName?.[name] || (state.admins.has(name) ? 'admin' : 'user'));
  const isAdmin = () => serverRole(CURRENT_USER) === 'admin';
  const canDeleteContent = () => isMainAdmin() || isAdmin();
  const commentDrafts = new Map();
  const suppressDraftRestore = new Set();

  // Recover normal browser windows from the oversized stale cache that did
  // not exist in Private/Incognito windows. Authentication is not touched.
  if (localStorage.getItem('mailo-cache-migration-v62') !== 'done') {
    try {
      localStorage.removeItem('shg-tasks-v5');
      localStorage.removeItem('shg-last-workspace-state');
      localStorage.setItem('mailo-cache-migration-v62', 'done');
      if ('caches' in window) caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('shg-task-manager-') && key !== 'shg-task-manager-v262').map(key => caches.delete(key))));
    } catch (error) { console.warn('MAILO cache migration skipped', error); }
  }

  // Roles and Space visibility. Administrators can work on shared Tasks, but
  // cannot administer Spaces and can see only their own Personal Space.
  canChangeApprover = () => isMainAdmin() || isAdmin();
  const previousProjectAccess62 = canCurrentUserAccessProject;
  canCurrentUserAccessProject = function version62ProjectAccess(projectKey) {
    if (isMainAdmin()) return true;
    if (isCentralPersonalSpace(projectKey)) return true;
    if (isPersonalSpace(projectKey)) return PERSONAL_SPACE_OWNERS[projectKey] === CURRENT_USER;
    if (isAdmin()) return true;
    return previousProjectAccess62(projectKey);
  };

  const mentionedAfter62 = (task, name, at) => {
    const needle = `@${String(name).toLowerCase()}`;
    return (task.comments || []).some(comment => new Date(comment.createdAt || 0) > new Date(at || 0) && String(comment.text || '').toLowerCase().includes(needle));
  };
  function revoked62(task, name) {
    const revokedAt = task?.accessRevocations?.[name]?.at;
    return Boolean(revokedAt && !mentionedAfter62(task, name, revokedAt));
  }
  const previousTaskAccess62 = canCurrentUserAccessTask;
  canCurrentUserAccessTask = function version62TaskAccess(task) {
    if (!task || revoked62(task, CURRENT_USER)) return false;
    if (isMainAdmin()) return true;
    if (isAdmin()) {
      if (isCentralPersonalSpace(task.project)) return [task.creator, task.assignee, taskSupervisor(task), taskApprover(task)].includes(CURRENT_USER) || isUserMentioned(task, CURRENT_USER);
      if (isPersonalSpace(task.project)) return PERSONAL_SPACE_OWNERS[task.project] === CURRENT_USER || [task.creator, task.assignee, taskSupervisor(task), taskApprover(task)].includes(CURRENT_USER) || isUserMentioned(task, CURRENT_USER);
      return true;
    }
    return previousTaskAccess62(task);
  };

  const previousAccessReasons62 = taskAccessReasons;
  taskAccessReasons = function version62AccessReasons(task, name) {
    if (revoked62(task, name)) return [];
    const reasons = previousAccessReasons62(task, name);
    if (serverRole(name) === 'admin' && isPersonalSpace(task.project) && PERSONAL_SPACE_OWNERS[task.project] !== name) return reasons.filter(reason => reason !== 'Administrator');
    return reasons;
  };

  taskViewersTable = function version62TaskViewers(task) {
    const viewers = PEOPLE.map(person => ({ person, reasons: taskAccessReasons(task, person.name) })).filter(item => item.reasons.length);
    return `<details class="task-viewers task-collapsible"><summary><strong>Task access</strong><span>${viewers.length} user${viewers.length === 1 ? '' : 's'}</span></summary><div class="task-viewers-scroll"><table><thead><tr><th>User</th><th>Access via</th>${isVictor() ? '<th>Remove</th>' : ''}</tr></thead><tbody>${viewers.map(({ person, reasons }) => `<tr><td>${personCell(person.name)}</td><td>${reasons.map(reason => `<span>${esc(reason)}</span>`).join('')}</td>${isVictor() ? `<td>${person.name === VICTOR ? '' : `<button type="button" class="task-access-remove62" onclick="revokeTaskAccess62('${esc(task.id)}',${esc(JSON.stringify(person.name))})" aria-label="Remove ${esc(person.name)} from Task access">×</button>`}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>`;
  };

  window.revokeTaskAccess62 = (taskId, name) => {
    if (!isVictor()) return;
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || name === VICTOR || !confirm(`Remove ${name} from ${taskId} access?`)) return;
    const at = new Date().toISOString();
    task.accessRevocations = { ...(task.accessRevocations || {}), [name]: { at, by: VICTOR } };
    task.audit = task.audit || [];
    task.audit.unshift(`${name} removed from Task access by Victor Stavropoulos`);
    save(); openTask(task.id); toast(`${name} no longer has access to ${task.id}`);
  };

  const previousAssignmentComments62 = addAssignmentChangeComments;
  addAssignmentChangeComments = function version62AssignmentComments(task, previous, changedAt) {
    for (const field of ['assignee', 'supervisor']) {
      const next = field === 'assignee' ? task.assignee : taskSupervisor(task);
      if (previous?.[field] !== next && next && task.accessRevocations?.[next]) delete task.accessRevocations[next];
    }
    return previousAssignmentComments62(task, previous, changedAt);
  };

  // Alphabetical @mention suggestions everywhere.
  handleCommentMention = function version62CommentMention(textarea, taskId) {
    const before = textarea.value.slice(0, textarea.selectionStart), at = before.lastIndexOf('@'), menu = document.getElementById(`commentMention-${taskId}`);
    if (!menu) return;
    if (at < 0 || /\n/.test(before.slice(at))) { menu.innerHTML = ''; return; }
    const query = before.slice(at + 1).trim().toLowerCase();
    const matches = sortedPeople().filter(person => !query || person.name.toLowerCase().includes(query));
    if (!matches.length) { menu.innerHTML = ''; return; }
    textarea.dataset.mentionStart = String(at);
    menu.innerHTML = matches.map((person, index) => `<button type="button" class="${index === 0 ? 'mention-active' : ''}" onmousedown="event.preventDefault();insertCommentMention('${taskId}',${esc(JSON.stringify(person.name))})"><i>${person.initials}</i><span>${esc(person.name)}</span></button>`).join('');
    requestAnimationFrame(adjustDropdownDirections);
  };

  // Preserve a typed but unsent comment while any Task field rerenders.
  const previousOpenTask62 = openTask;
  openTask = function version62OpenTask(id, preserveDirty = false) {
    const current = document.querySelector(`#commentInput-${CSS.escape(String(id))}`);
    if (current && !suppressDraftRestore.has(id)) commentDrafts.set(id, current.value);
    previousOpenTask62(id, preserveDirty);
    const next = document.querySelector(`#commentInput-${CSS.escape(String(id))}`);
    if (next && !suppressDraftRestore.has(id) && commentDrafts.has(id)) next.value = commentDrafts.get(id);
    decorateTaskModal62(id);
  };
  const previousAddComment62 = addComment;
  addComment = function version62AddComment(id, event) {
    suppressDraftRestore.add(id); commentDrafts.delete(id);
    try { return previousAddComment62(id, event); }
    finally { setTimeout(() => suppressDraftRestore.delete(id), 0); }
  };

  // Scheduled comments remain visible, editable and actionable.
  function schedulesHTML62(task) {
    if (!isMainAdmin() || !(task.scheduledComments || []).length) return '';
    return `<section class="scheduled-comments62"><h4>Scheduled comments <span>${task.scheduledComments.length}</span></h4>${task.scheduledComments.map(item => `<article><div><strong>${esc(item.text)}</strong><small>${formatDateTime(item.scheduledAt)}${item.recurring ? ` · ${esc(item.recurring)}` : ''}${item.ifNoAnswer ? ` · If no answer after ${Number(item.noAnswerHours) || 24}h` : ''}</small></div><div><button type="button" onclick="editScheduledComment62('${task.id}','${item.id}')">Edit</button><button type="button" onclick="sendScheduledCommentNow62('${task.id}','${item.id}')">Send now</button><button type="button" class="danger" onclick="deleteScheduledComment62('${task.id}','${item.id}')">Delete</button></div></article>`).join('')}</section>`;
  }
  const previousCommentSection62 = commentSection;
  commentSection = function version62CommentSection(task) {
    return previousCommentSection62(task).replace('</section>', `${schedulesHTML62(task)}</section>`);
  };

  window.editScheduledComment62 = (taskId, scheduleId) => {
    const task = state.tasks.find(item => item.id === taskId), schedule = task?.scheduledComments?.find(item => item.id === scheduleId);
    if (!isMainAdmin() || !schedule) return;
    const localValue = new Date(new Date(schedule.scheduledAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('modalContent').innerHTML = `<p class="eyebrow">${esc(task.id)} / SCHEDULED COMMENT</p><h2 id="modalTitle">Edit scheduled comment</h2><form id="editScheduleForm62" class="task-form"><div class="field"><label>Comment</label><textarea name="text" required>${esc(schedule.text)}</textarea></div><div class="field"><label>Date & time</label><input name="scheduledAt" type="datetime-local" required value="${localValue}"></div><div class="form-row"><div class="field"><label>Recurring</label><select name="recurring"><option value="">No</option>${['daily','weekly','monthly'].map(value => `<option value="${value}" ${schedule.recurring === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div><div class="field"><label>Wait hours</label><input name="noAnswerHours" type="number" min="1" value="${Number(schedule.noAnswerHours) || 24}"></div></div><label><input name="ifNoAnswer" type="checkbox" ${schedule.ifNoAnswer ? 'checked' : ''}> If no answer, send scheduled comment</label><button class="primary-btn" type="submit">Save Changes</button></form>`;
    showModal();
    document.getElementById('editScheduleForm62').onsubmit = event => { event.preventDefault(); const data = new FormData(event.currentTarget); schedule.text = String(data.get('text')).trim(); schedule.scheduledAt = new Date(data.get('scheduledAt')).toISOString(); schedule.recurring = String(data.get('recurring') || ''); schedule.noAnswerHours = Number(data.get('noAnswerHours')) || 24; schedule.ifNoAnswer = data.get('ifNoAnswer') === 'on'; save(); openTask(task.id); toast('Scheduled comment updated'); };
  };
  window.deleteScheduledComment62 = (taskId, scheduleId) => { const task = state.tasks.find(item => item.id === taskId); if (!isMainAdmin() || !task || !confirm('Delete this scheduled comment?')) return; task.scheduledComments = (task.scheduledComments || []).filter(item => item.id !== scheduleId); save(); openTask(task.id); toast('Scheduled comment deleted'); };
  window.sendScheduledCommentNow62 = async (taskId, scheduleId) => {
    const task = state.tasks.find(item => item.id === taskId), schedule = task?.scheduledComments?.find(item => item.id === scheduleId);
    if (!isMainAdmin() || !task || !schedule) return;
    const comment = { id: `scheduled-now-${Date.now()}`, author: CURRENT_USER, role: roleName(), text: schedule.text, images: [], createdAt: new Date().toISOString(), human: true, scheduledByMainAdmin: true };
    task.comments = task.comments || []; task.comments.unshift(comment); task.scheduledComments = task.scheduledComments.filter(item => item.id !== scheduleId); task.updated = comment.createdAt; save();
    try { await window.shgSaveCommentImmediately?.(task, comment); } catch (error) { console.error(error); }
    openTask(task.id); toast('Scheduled comment sent');
  };

  // Victor can edit any comment. Administrators can delete Tasks/comments.
  window.editTaskComment62 = async (taskId, commentId) => {
    if (!isVictor()) return;
    const task = state.tasks.find(item => item.id === taskId), source = taskDetailsDraft?.id === taskId ? taskDetailsDraft.comments : task?.comments, comment = source?.find(item => String(item.id) === String(commentId));
    if (!comment) return;
    const text = prompt('Edit comment:', comment.text || '');
    if (text === null || !String(text).trim()) return;
    comment.text = String(text).trim(); comment.editedAt = new Date().toISOString(); comment.editedBy = VICTOR;
    task.audit = task.audit || []; task.audit.unshift(`Comment by ${comment.author || 'Unknown user'} edited by Victor Stavropoulos`);
    if (taskDetailsDraft?.id === taskId) { markTaskDetailsDirty(taskId); openTask(taskId, true); toast('Comment edited. Press Submit to save.'); return; }
    task.updated = comment.editedAt; save();
    try { await window.shgSaveCommentImmediately?.(task, comment); } catch (error) { console.error(error); }
    window.renderTaskChat?.(); toast('Comment edited');
  };

  deleteComment = function version62DeleteComment(taskId, commentId) {
    if (!canDeleteContent()) { toast('Only an Administrator can delete comments'); return; }
    const task = state.tasks.find(item => item.id === taskId), source = taskDetailsDraft?.id === taskId ? taskDetailsDraft.comments : task?.comments;
    const index = (source || []).findIndex(comment => String(comment.id) === String(commentId));
    if (!task || index < 0 || !confirm(`Delete this comment by ${source[index].author || 'Unknown user'}?`)) return;
    source.splice(index, 1); task.audit = task.audit || []; task.audit.unshift(`Comment deleted by ${CURRENT_USER}`);
    if (taskDetailsDraft?.id === taskId) { markTaskDetailsDirty(taskId); openTask(taskId, true); toast('Comment removed. Press Submit to save.'); }
    else { save(); window.renderTaskChat?.(); toast('Comment deleted'); }
  };

  deleteTaskFromContext = function version62DeleteTask(id) {
    if (!canDeleteContent()) { closeTaskContextMenu(); toast('Only an Administrator can delete Tasks'); return; }
    const task = state.tasks.find(item => item.id === id); if (!task) return;
    const ids = new Set([id]); let changed = true;
    while (changed) { changed = false; for (const child of state.tasks) if (child.parent && ids.has(child.parent) && !ids.has(child.id)) { ids.add(child.id); changed = true; } }
    const children = ids.size - 1; closeTaskContextMenu();
    if (!confirm(`Delete ${id}${children ? ` and its ${children} subtask${children === 1 ? '' : 's'}` : ''}?\n\nThis will delete it for every user.`)) return;
    closeModal(); logActivity('Deleted task', task); state.tasks = state.tasks.filter(item => !ids.has(item.id)); state.manualTaskOrder = state.manualTaskOrder.filter(taskId => !ids.has(taskId));
    for (const taskId of ids) { state.deletedTaskIds.add(taskId); state.selectedTasks.delete(taskId); state.expandedParents.delete(taskId); }
    safeLocalSet('shg-deleted-task-ids', JSON.stringify([...state.deletedTaskIds])); safeLocalSet('shg-manual-task-order', JSON.stringify(state.manualTaskOrder)); save(); render(); toast(`${id} deleted for all users`);
  };
  taskSubmitButton = task => `<div class="task-footer-left"><button class="action-btn" data-task-id="${task.id}" onclick="openSubtaskModal(this.dataset.taskId)">+ Create subtask</button>${canDeleteContent() ? `<button class="action-btn danger" data-task-id="${task.id}" onclick="deleteTaskFromContext(this.dataset.taskId)">Delete task</button>` : ''}</div><div class="task-footer-right"><button class="action-btn" type="button" onclick="closeModal()">Cancel</button><button class="primary-btn task-submit-btn" ${taskDetailsDirtyId === task.id ? '' : 'disabled'} onclick="submitTaskDetails('${task.id}')">Submit</button></div>`;

  taskDetailApproverControl = function version62ApproverControl(task) {
    const value = taskDetailsDraft?.approver || taskApprover(task) || 'Unassigned';
    if (!canChangeApprover()) return `<strong>${esc(value)}</strong>`;
    return `<select class="detail-select" onchange="changeTaskApproverFromDetails('${task.id}',this.value)"><option value="Unassigned" ${value === 'Unassigned' ? 'selected' : ''}>None</option>${personOptions(value)}</select>`;
  };
  cellOptions = function version62CellOptions(key) {
    if (key === 'assignee') return ['Unassigned', ...sortedPeople().map(person => person.name)];
    if (key === 'supervisor') return ['None', ...sortedPeople().map(person => person.name)];
    if (key === 'approver') return ['Unassigned', ...sortedPeople().map(person => person.name)];
    return ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
  };

  // Moving a Task updates one shared row; stale duplicates with the same
  // remote identity or former key are removed locally before the next sync.
  function dedupeMovedTask62(task, oldId) {
    if (!task) return;
    task.formerIds = [...new Set([...(task.formerIds || []), oldId].filter(Boolean))];
    state.tasks = state.tasks.filter(item => item === task || (task._supabaseId ? item._supabaseId !== task._supabaseId : item.id !== oldId));
    const rows = window.VICTOR_MAIN_FILTER || [], seen = new Set();
    window.VICTOR_MAIN_FILTER = rows.filter(row => { const key = row.id === oldId ? task.id : row.id; if (seen.has(key)) return false; seen.add(key); if (row.id === oldId) { row.id = task.id; row.projectKey = task.project; row.space = PROJECTS[task.project]?.name || task.project; } return true; });
  }
  const previousChangeSpace62 = changeTaskSpace;
  changeTaskSpace = function version62ChangeSpace(id, project) { const task = state.tasks.find(item => item.id === id); previousChangeSpace62(id, project); if (task && task.id !== id) { dedupeMovedTask62(task, id); save(); } };
  const previousSubmitDetails62 = submitTaskDetails;
  submitTaskDetails = function version62SubmitDetails(id) { const task = state.tasks.find(item => item.id === id), oldId = task?.id, oldProject = task?.project; const result = previousSubmitDetails62(id); if (task && oldProject !== task.project) { dedupeMovedTask62(task, oldId); save(); } return result; };

  // Reminders are opt-in from Version 62 onward.
  function applyReminderDefaults62() {
    let changed = false;
    for (const task of state.tasks) if (task.reminderDefaultPolicyVersion !== 62) { task.disableMainAdminReminders = true; task.reminderDefaultPolicyVersion = 62; changed = true; }
    if (changed) save();
  }

  function decorateTaskModal62(taskId) {
    const task = state.tasks.find(item => item.id === taskId); if (!task) return;
    const comments = taskDetailsDraft?.id === taskId ? taskDetailsDraft.comments || [] : task.comments || [];
    document.querySelectorAll('#modalContent .comment-list article.comment').forEach((article, index) => {
      const comment = comments[index]; if (!comment) return;
      const meta = article.querySelector('.comment-meta'); if (!meta) return;
      if (comment.editedAt && !meta.querySelector('.comment-edited62')) meta.insertAdjacentHTML('beforeend', `<small class="comment-edited62">Edited ${formatDateTime(comment.editedAt)}</small>`);
      if (isVictor() && !meta.querySelector('.edit-comment62')) meta.insertAdjacentHTML('beforeend', `<button type="button" class="edit-comment62" onclick="editTaskComment62('${taskId}','${comment.id}')">Edit</button>`);
      if (canDeleteContent() && !meta.querySelector('.delete-comment-btn')) meta.insertAdjacentHTML('beforeend', `<button type="button" class="delete-comment-btn" onclick="deleteComment('${taskId}','${comment.id}')">Delete</button>`);
    });
    const tools = document.querySelector('#modalContent .comment-tools');
    if (tools && !tools.querySelector('.mobile-comment-submit62')) tools.insertAdjacentHTML('beforeend', `<button type="button" class="primary-btn mobile-comment-submit62" onclick="submitTaskDetails('${taskId}')" ${taskDetailsDirtyId === taskId ? '' : 'disabled'}>Submit</button>`);
  }

  // Task Chat hierarchy: a converted Subtask keeps its full conversation but
  // is grouped under the parent instead of appearing as an independent chat.
  function unread62(task) { const readAt = new Date(task?.chatReadBy?.[CURRENT_USER] || 0); return (task?.comments || []).filter(comment => comment.author !== CURRENT_USER && new Date(comment.createdAt || 0) > readAt).length; }
  function enhanceTaskChat62() {
    const layout = document.querySelector('.task-chat-layout'); if (!layout) return;
    const threadButtons = [...layout.querySelectorAll('.task-chat-thread')], ids = new Set(threadButtons.map(button => button.getAttribute('onclick')?.match(/openTaskChat\('([^']+)'\)/)?.[1]).filter(Boolean));
    for (const button of threadButtons) {
      const id = button.getAttribute('onclick')?.match(/openTaskChat\('([^']+)'\)/)?.[1], task = state.tasks.find(item => item.id === id);
      if (!task?.parent || !ids.has(task.parent) || window.MAILO_ACTIVE_CHAT === task.id) continue;
      const parentButton = threadButtons.find(item => item.getAttribute('onclick')?.includes(`'${task.parent}'`));
      const badge = parentButton?.querySelector('footer b'), total = Number(badge?.textContent || 0) + unread62(task);
      if (parentButton && total) { if (badge) badge.textContent = String(total); else parentButton.querySelector('footer')?.insertAdjacentHTML('beforeend', `<b>${total}</b>`); }
      button.remove();
    }
    const active = state.tasks.find(item => item.id === window.MAILO_ACTIVE_CHAT), parent = active?.parent ? state.tasks.find(item => item.id === active.parent) : active;
    const children = parent ? state.tasks.filter(item => item.parent === parent.id && canCurrentUserAccessTask(item)) : [];
    const summary = layout.querySelector('.task-chat-summary');
    if (summary && parent && children.length && !layout.querySelector('.subtask-conversations62')) summary.insertAdjacentHTML('afterend', `<details class="subtask-conversations62"><summary>Subtask Conversations <span>${children.length}</span></summary><div>${children.sort((a,b) => String(a.title).localeCompare(String(b.title), 'el', { sensitivity:'base' })).map(child => `<button type="button" class="${child.id === active?.id ? 'active' : ''}" onclick="openTaskChat('${child.id}')"><strong>${esc(child.id)}</strong><span>${esc(child.title)}</span>${unread62(child) ? `<b>${unread62(child)}</b>` : ''}</button>`).join('')}</div></details>`);
    const human = [...(active?.comments || [])].filter(comment => !comment.system).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
    layout.querySelectorAll('.task-chat-message').forEach((article, index) => {
      const comment = human[index]; if (!comment) return; const header = article.querySelector('header');
      if (comment.editedAt && !header.querySelector('.comment-edited62')) header.insertAdjacentHTML('beforeend', `<small class="comment-edited62">Edited</small>`);
      if (isVictor() && !header.querySelector('.edit-comment62')) header.insertAdjacentHTML('beforeend', `<button type="button" class="edit-comment62" onclick="editTaskComment62('${active.id}','${comment.id}')">Edit</button>`);
      if (canDeleteContent() && !header.querySelector('.delete-comment-btn')) header.insertAdjacentHTML('beforeend', `<button type="button" class="delete-comment-btn" onclick="deleteComment('${active.id}','${comment.id}')">Delete</button>`);
    });
  }
  const previousRenderChat62 = window.renderTaskChat;
  window.renderTaskChat = function version62RenderTaskChat() { previousRenderChat62?.(); enhanceTaskChat62(); };

  // Remove Space administration from Administrators while retaining their
  // access to all Shared Spaces and only their own Personal Space.
  openSpaceAccessModal = function version62SpaceAccess(projectKey) {
    if (!isMainAdmin()) { toast('Only a Main Admin can manage Space access'); return; }
    const project = PROJECTS[projectKey], allowed = new Set(state.spaceAccess[projectKey] || []), allSelected = PEOPLE.every(person => allowed.has(person.name));
    document.getElementById('modalContent').innerHTML = `<p class="eyebrow">SPACE ACCESS</p><h2 id="modalTitle">${esc(project.name)}</h2><p class="modal-sub">Choose which users can view and access this Space.</p><form id="spaceAccessForm" class="space-access-form"><label class="space-access-all"><input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleAllSpaceUsers(this.checked)"><strong>Select All</strong></label><div class="space-user-list">${sortedPeople().map(person => `<label><input type="checkbox" name="spaceUser" value="${esc(person.name)}" ${allowed.has(person.name) ? 'checked' : ''}><span class="table-person"><i>${person.initials}</i>${esc(person.name)}</span></label>`).join('')}</div><button class="primary-btn space-access-apply" type="submit">Apply</button></form>`;
    showModal(); document.getElementById('spaceAccessForm').onsubmit = event => { event.preventDefault(); state.spaceAccess[projectKey] = [...event.currentTarget.querySelectorAll('input[name="spaceUser"]:checked')].map(input => input.value); saveSpaceAccess(); closeModal(); render(); toast(`Access updated for ${project.name}`); };
  };
  const previousRenderSpaces62 = renderSpaces;
  renderSpaces = function version62RenderSpaces() {
    previousRenderSpaces62();
    if (!isMainAdmin()) {
      document.querySelectorAll('#spacesTable tbody tr').forEach(row => { const key = row.cells[0]?.textContent.trim(); if (!canCurrentUserAccessProject(key)) row.remove(); else row.querySelector('.spaces-actions')?.replaceChildren(); });
      document.querySelector('#spacesView .subtitle')?.replaceChildren(document.createTextNode('Review the Shared Spaces and your own Personal Space.'));
    }
  };

  const previousRender62 = render;
  render = function version62Render() {
    previousRender62();
    document.querySelector('[data-view="spaces"]')?.classList.toggle('hidden', isAdmin() && !isMainAdmin());
    if (state.appSection === 'chat') enhanceTaskChat62();
  };

  // New Tasks inherit the opt-in reminder policy even when created by an
  // older form handler.
  document.addEventListener('submit', event => {
    if (!['taskForm','miniTaskForm','subtaskForm'].includes(event.target?.id)) return;
    setTimeout(() => { const task = state.tasks[0]; if (task && task.reminderDefaultPolicyVersion !== 62) { task.disableMainAdminReminders = true; task.reminderDefaultPolicyVersion = 62; save(); } }, 0);
  }, true);

  window.addEventListener('shg:remote-ready', () => { applyReminderDefaults62(); render(); });
  applyReminderDefaults62(); render();
})();
