/* MAILO Version 53 — mobile workspace, Task Chat and hierarchy reliability. */
(() => {
  const roleByName = window.SHG_REMOTE_BOOTSTRAP?.roleByName || {};
  const chatView = document.getElementById('chatView');
  let activeChatTaskId = null;
  let chatQuery = '';

  function actualRole(name) {
    const role = roleByName[name];
    if (role === 'main_admin') return 'Main Admin';
    if (role === 'admin') return 'Administrator';
    return 'User';
  }

  function isChatParticipant(task, name = CURRENT_USER) {
    return task.assignee === name || taskSupervisor(task) === name || isUserMentioned(task, name);
  }

  function chatTasks() {
    return state.tasks
      .filter(task => !isTaskDeleted(task) && canAppearInMainFilter(task) && isChatParticipant(task))
      .filter(task => !chatQuery || `${task.id} ${task.title}`.toLowerCase().includes(chatQuery))
      .sort((a, b) => new Date(b.comments?.[0]?.createdAt || b.updated) - new Date(a.comments?.[0]?.createdAt || a.updated));
  }

  function lastChatRead(task) {
    return new Date(task.chatReadBy?.[CURRENT_USER] || 0).getTime();
  }

  function unreadChatCount(task) {
    const readAt = lastChatRead(task);
    return (task.comments || []).filter(comment => comment.author !== CURRENT_USER && new Date(comment.createdAt).getTime() > readAt).length;
  }

  function updateChatBadge() {
    const count = chatTasks().reduce((sum, task) => sum + unreadChatCount(task), 0);
    const badge = document.getElementById('chatUnreadBadge');
    if (!badge) return;
    badge.textContent = String(Math.min(99, count));
    badge.classList.toggle('hidden', count === 0);
  }

  function markChatRead(task) {
    const newest = Math.max(Date.now(), ...(task.comments || []).map(comment => new Date(comment.createdAt).getTime() || 0));
    task.chatReadBy = { ...(task.chatReadBy || {}), [CURRENT_USER]: new Date(newest).toISOString() };
    save();
  }

  function chatCommentHTML(comment) {
    const mine = comment.author === CURRENT_USER;
    if (comment.system) {
      return `<div class="task-chat-system"><span>${esc(comment.text || '')}</span><time>${formatDateTime(comment.createdAt)}</time></div>`;
    }
    const attachmentHTML = [
      ...(comment.images || []).map(source => `<a class="task-chat-image" href="${source}" target="_blank"><img src="${source}" alt="Comment attachment"></a>`),
      ...(comment.attachments || []).map(file => `<a class="task-chat-file" href="${file.data}" download="${esc(file.name)}">📎 ${esc(file.name)}</a>`),
    ].join('');
    const reply = comment.replyTo ? `<div class="task-chat-quote"><strong>${esc(comment.replyTo.author)}</strong><span>${esc(comment.replyTo.text || '')}</span></div>` : '';
    return `<article class="task-chat-message ${mine ? 'mine' : ''}"><div class="task-chat-avatar">${initials(comment.author || 'User')}</div><div><header><strong>${esc(comment.author || 'User')}</strong><time>${formatDateTime(comment.createdAt)}</time></header><div class="task-chat-bubble">${reply}${comment.text ? `<p>${esc(comment.text)}</p>` : ''}${attachmentHTML}</div></div></article>`;
  }

  function chatListHTML(tasks) {
    return `<aside class="task-chat-list"><div class="task-chat-list-head"><div><p class="eyebrow">MAILO</p><h1>Task Chat</h1></div><button type="button" class="chat-notification-button" onclick="enableTaskChatNotifications()" title="Enable notifications">◉</button></div><label class="task-chat-search">⌕<input value="${esc(chatQuery)}" placeholder="Search Task Chats…" oninput="filterTaskChats(this.value)"></label><div class="task-chat-threads">${tasks.length ? tasks.map(task => { const unread = unreadChatCount(task), last = task.comments?.[0]; return `<button type="button" class="task-chat-thread ${activeChatTaskId === task.id ? 'active' : ''}" onclick="openTaskChat('${task.id}')"><span class="task-chat-thread-code">${esc(task.id)}</span><strong>${esc(task.title)}</strong><small>${last ? `${esc(last.author || 'System')}: ${esc(last.text || 'Attachment').slice(0, 70)}` : 'No messages yet'}</small><footer><span class="table-status status-${task.status}">${esc(task.jiraStatus || task.status)}</span>${unread ? `<b>${unread}</b>` : ''}</footer></button>`; }).join('') : '<p class="task-chat-empty">No Task Chats match this view.</p>'}</div></aside>`;
  }

  function chatConversationHTML(task) {
    if (!task) return `<section class="task-chat-welcome"><div>◌</div><h2>Select a Task Chat</h2><p>Messages, mentions and Task changes will appear here.</p></section>`;
    const comments = [...(task.comments || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return `<section class="task-chat-conversation"><header class="task-chat-conversation-head"><button class="task-chat-mobile-back" onclick="closeTaskChat()">‹</button><div><span>${esc(task.id)}</span><h2>${esc(task.title)}</h2></div><button type="button" onclick="openTask('${task.id}')">Open Task</button></header><div class="task-chat-summary"><span class="table-status status-${task.status}">${esc(task.jiraStatus || task.status)}</span><span><small>Assignee</small>${esc(task.assignee || 'Unassigned')}</span><span><small>Supervisor</small>${esc(taskSupervisor(task) || 'Unassigned')}</span><span><small>Due date</small>${task.dueDate ? esc(formatDate(task.dueDate).replace(/<[^>]+>/g, '')) : 'None'}</span></div><div id="taskChatMessages" class="task-chat-messages">${comments.length ? comments.map(chatCommentHTML).join('') : '<p class="task-chat-empty">No messages yet. Start the conversation below.</p>'}</div><form class="task-chat-composer" onsubmit="sendTaskChatMessage('${task.id}',event)"><textarea name="message" rows="1" placeholder="Write a comment… Use @ to mention" required></textarea><button type="submit" aria-label="Send comment">➤</button></form></section>`;
  }

  window.renderTaskChat = function renderTaskChat() {
    if (!chatView) return;
    const tasks = chatTasks();
    const active = tasks.find(task => task.id === activeChatTaskId) || null;
    chatView.innerHTML = `<div class="task-chat-layout ${active ? 'has-active-chat' : ''}">${chatListHTML(tasks)}${chatConversationHTML(active)}</div>`;
    updateChatBadge();
    requestAnimationFrame(() => { const messages = document.getElementById('taskChatMessages'); if (messages) messages.scrollTop = messages.scrollHeight; });
  };

  window.openTaskChat = id => {
    const task = state.tasks.find(item => item.id === id);
    if (!task || !isChatParticipant(task)) return;
    activeChatTaskId = id;
    markChatRead(task);
    renderTaskChat();
  };
  window.closeTaskChat = () => { activeChatTaskId = null; renderTaskChat(); };
  window.filterTaskChats = value => { chatQuery = String(value || '').trim().toLowerCase(); renderTaskChat(); };
  window.sendTaskChatMessage = (id, event) => {
    event.preventDefault();
    const task = state.tasks.find(item => item.id === id), text = event.currentTarget.elements.message.value.trim();
    if (!task || !text) return;
    const createdAt = new Date().toISOString();
    task.comments = task.comments || [];
    task.comments.unshift({ id: `comment-${Date.now()}`, author: CURRENT_USER, role: roleName(), text, images: [], createdAt, human: true });
    task.lastHumanActivityAt = createdAt;
    task.updated = createdAt;
    task.chatReadBy = { ...(task.chatReadBy || {}), [CURRENT_USER]: createdAt };
    task.audit = task.audit || [];
    task.audit.unshift(`Chat comment added by ${CURRENT_USER}`);
    save();
    renderTaskChat();
    toast('Comment sent');
  };
  window.enableTaskChatNotifications = async () => {
    if (!('Notification' in window)) { toast('Notifications are not supported by this browser'); return; }
    const permission = await Notification.requestPermission();
    toast(permission === 'granted' ? 'Task Chat notifications enabled' : 'Notifications were not enabled');
  };

  // Comments and mentions now use Task Chat/browser notifications, not email.
  sendMentionEmails = function version53NoCommentEmail() {};

  // New Backlog assignments notify Assignee and Supervisor immediately by email.
  const originalCreatedEmail = sendTaskCreatedEmails;
  sendTaskCreatedEmails = function version53AssignmentEmail(task) {
    const approver = task.approver;
    task.approver = 'Unassigned';
    originalCreatedEmail(task);
    task.approver = approver;
  };

  // Persist a Main Admin's exact viewing time immediately and independently of Submit.
  const previousOpenTask = openTask;
  openTask = function version53OpenTask(id, preserveDirty = false) {
    const task = state.tasks.find(item => item.id === id);
    if (task && isMainAdmin() && !preserveDirty) {
      task.lastChecks = { ...(task.lastChecks || {}), [CURRENT_USER]: new Date().toISOString() };
      save();
      if (state.appSection === 'tasks') renderList();
    }
    return previousOpenTask(id, preserveDirty);
  };

  // Every task can be dragged to any hierarchy level. Only parent changes.
  startTaskDrag = function version53StartTaskDrag(id, event) {
    if (event.target.closest('button,input,select,.cell-menu,.column-resizer')) { event.preventDefault(); return; }
    state.draggedTask = id;
    event.currentTarget.classList.add('dragging-task-row');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };
  makeTaskSubtask = function version53MakeSubtask(sourceId, parentId) {
    const task = state.tasks.find(item => item.id === sourceId), parent = state.tasks.find(item => item.id === parentId);
    if (!task || !parent || task === parent) return false;
    let cursor = parent;
    while (cursor) {
      if (cursor.id === task.id) { toast('A Task cannot be moved inside itself or one of its descendants'); return false; }
      cursor = cursor.parent ? state.tasks.find(item => item.id === cursor.parent) : null;
    }
    const previousParent = task.parent;
    task.parent = parent.id;
    task.issueType = task.isMiniTask ? 'Mini Task' : 'Sub-task';
    task.audit = task.audit || [];
    task.audit.unshift(`Moved under ${parent.id} by ${CURRENT_USER}; all Task fields preserved`);
    const row = (window.VICTOR_MAIN_FILTER || []).find(item => item.id === sourceId);
    if (row) { row.parent = parent.id; row.issueType = task.issueType; }
    state.expandedParents.add(parent.id);
    state.manualTaskOrder = state.manualTaskOrder.filter(id => id !== sourceId);
    safeLocalSet('shg-manual-task-order', JSON.stringify(state.manualTaskOrder));
    save();
    if (previousParent && previousParent !== parent.id) toast(`${sourceId} moved from ${previousParent} to ${parent.id}`);
    return sourceId;
  };
  const previousListRowHTML = listRowHTML;
  listRowHTML = function version53ListRowHTML(row) {
    return previousListRowHTML(row).replace('<tr ', `<tr draggable="true" ondragstart="startTaskDrag('${row.id}',event)" ondragover="dragOverTaskRow('${row.id}',event)" ondragleave="event.currentTarget.classList.remove('task-drop-before','task-drop-after')" ondrop="dropTaskRow('${row.id}',event)" ondragend="endTaskDrag()" `);
  };

  // Show actual database roles in the Users table and the signed-in footer.
  const previousRenderUsers = renderUsers;
  renderUsers = function version53RenderUsers() {
    previousRenderUsers();
    requestAnimationFrame(() => {
      document.querySelectorAll('#usersTable tbody tr').forEach(row => {
        const name = row.querySelector('.table-person')?.textContent?.trim();
        const cell = row.children[3];
        if (!name || !cell) return;
        const role = actualRole(name);
        cell.dataset.actualRole = role;
        if (role === 'Main Admin') cell.innerHTML = '<span class="main-admin-badge">Main Admin</span>';
        else if (cell.querySelector('select')) {
          const select = cell.querySelector('select');
          select.value = role === 'Administrator' ? 'admin' : 'user';
        }
      });
    });
  };
  const previousRoleName = roleName;
  roleName = function version53RoleName() { return actualRole(CURRENT_USER) || previousRoleName(); };

  // Extend the existing application renderer with Task Chat and mobile navigation.
  const previousRender = render;
  render = function version53Render() {
    previousRender();
    const inChat = state.appSection === 'chat';
    chatView?.classList.toggle('hidden', !inChat);
    document.getElementById('tasksContent')?.classList.toggle('hidden', inChat);
    document.querySelectorAll('.main-nav .nav-item').forEach(button => {
      if (button.dataset.view === 'chat') button.classList.toggle('active', inChat);
    });
    document.getElementById('roleLabel').textContent = roleName();
    if (inChat) renderTaskChat();
    else updateChatBadge();
  };

  const chatNav = document.querySelector('.main-nav .nav-item[data-view="chat"]');
  if (chatNav) chatNav.onclick = () => { state.appSection = 'chat'; render(); if (window.matchMedia('(max-width:850px)').matches) setSidebarState(true); };

  // Mobile bottom navigation is shared by iPhone and Android/PWA layouts.
  const bottomNav = document.createElement('nav');
  bottomNav.className = 'mobile-bottom-nav';
  bottomNav.innerHTML = `<button data-mobile-view="tasks">▦<span>Tasks</span></button><button data-mobile-view="chat">◌<span>Chat</span></button><button class="mobile-create" onclick="newTaskModal()">＋</button><button data-mobile-view="overview">⌂<span>Overview</span></button><button onclick="setSidebarState(false)">•••<span>More</span></button>`;
  document.body.appendChild(bottomNav);
  bottomNav.querySelectorAll('[data-mobile-view]').forEach(button => button.onclick = () => { state.appSection = button.dataset.mobileView; render(); });

  updateChatBadge();
  render();
})();
