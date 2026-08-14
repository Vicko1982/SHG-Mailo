/* MAILO Version 54 — reliable navigation, Task Chat and true mobile layout. */
(() => {
  const VICTOR = 'Victor Stavropoulos';
  const chatView = document.getElementById('chatView');
  let chatReply = null;
  let pendingChatFiles = [];

  const isVictor = () => SESSION_USER === VICTOR && CURRENT_USER === VICTOR;
  const participant = task => task.assignee === CURRENT_USER || taskSupervisor(task) === CURRENT_USER || isUserMentioned(task, CURRENT_USER);
  const chatRows = () => state.tasks.filter(task => !isTaskDeleted(task) && canAppearInMainFilter(task) && participant(task));
  const readAt = task => new Date(task.chatReadBy?.[CURRENT_USER] || 0).getTime();
  const unread = task => (task.comments || []).filter(comment => comment.author !== CURRENT_USER && new Date(comment.createdAt).getTime() > readAt(task)).length;

  function newestCommentAt(task) {
    return Math.max(Date.now(), ...(task.comments || []).map(comment => new Date(comment.createdAt).getTime() || 0));
  }

  function persistRead(task) {
    task.chatReadBy = { ...(task.chatReadBy || {}), [CURRENT_USER]: new Date(newestCommentAt(task)).toISOString() };
    save();
  }

  function refreshUnreadBadge() {
    const count = chatRows().reduce((total, task) => total + unread(task), 0);
    const badge = document.getElementById('chatUnreadBadge');
    if (!badge) return;
    badge.textContent = String(count);
    badge.title = `${count} unread message${count === 1 ? '' : 's'}`;
    badge.classList.toggle('hidden', count === 0);
  }

  function chatAttachments(comment) {
    return [
      ...(comment.images || []).map(source => `<a class="task-chat-image" href="${source}" target="_blank" rel="noopener"><img src="${source}" alt="Comment attachment"></a>`),
      ...(comment.attachments || []).map(file => `<a class="task-chat-file" href="${file.data}" download="${esc(file.name)}">📎 ${esc(file.name)}</a>`),
    ].join('');
  }

  function messageHTML(comment) {
    if (comment.system) return `<div class="task-chat-system"><span>${esc(comment.text || '')}</span><time>${formatDateTime(comment.createdAt)}</time></div>`;
    const reply = comment.replyTo ? `<div class="task-chat-quote"><strong>${esc(comment.replyTo.author)}</strong><span>${esc(comment.replyTo.text || '')}</span></div>` : '';
    return `<article class="task-chat-message ${comment.author === CURRENT_USER ? 'mine' : ''}"><div class="task-chat-avatar">${initials(comment.author || 'User')}</div><div class="task-chat-message-body"><header><strong>${esc(comment.author || 'User')}</strong><time>${formatDateTime(comment.createdAt)}</time><button type="button" class="task-chat-reply" onclick="replyInTaskChat('${comment.id}')">Reply</button></header><div class="task-chat-bubble">${reply}${comment.text ? `<p>${esc(comment.text)}</p>` : ''}${chatAttachments(comment)}</div></div></article>`;
  }

  function matchingChatRows() {
    const query = String(window.MAILO_CHAT_QUERY || '').trim().toLowerCase();
    return chatRows().filter(task => !query || `${task.id} ${task.title}`.toLowerCase().includes(query)).sort((a, b) => new Date(b.comments?.[0]?.createdAt || b.updated) - new Date(a.comments?.[0]?.createdAt || a.updated));
  }

  function listHTML(tasks) {
    return `<aside class="task-chat-list"><div class="task-chat-list-head"><div><p class="eyebrow">MAILO</p><h1>Task Chat</h1></div><button type="button" class="chat-notification-button" onclick="enableTaskChatNotifications()" title="Enable notifications">◉</button></div><label class="task-chat-search">⌕<input value="${esc(window.MAILO_CHAT_QUERY || '')}" placeholder="Search Task Chats…" oninput="MAILO_CHAT_QUERY=this.value;renderTaskChat()"></label><div class="task-chat-threads">${tasks.length ? tasks.map(task => { const count = unread(task); const last = task.comments?.[0]; return `<button type="button" class="task-chat-thread ${window.MAILO_ACTIVE_CHAT === task.id ? 'active' : ''}" onclick="openTaskChat('${task.id}')"><span class="task-chat-thread-code">${esc(task.id)}</span><strong>${esc(task.title)}</strong><small>${last ? `${esc(last.author || 'System')}: ${esc(last.text || 'Attachment').slice(0, 70)}` : 'No messages yet'}</small><footer><span class="table-status status-${task.status}">${esc(task.jiraStatus || task.status)}</span>${count ? `<b>${count}</b>` : ''}</footer></button>`; }).join('') : '<p class="task-chat-empty">No Task Chats match this view.</p>'}</div></aside>`;
  }

  function conversationHTML(task) {
    if (!task) return '<section class="task-chat-welcome"><div>◌</div><h2>Select a Task Chat</h2><p>Messages, mentions and Task changes will appear here.</p></section>';
    const comments = [...(task.comments || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const quoted = chatReply ? `<div class="task-chat-compose-reply"><span>Replying to <strong>${esc(chatReply.author)}</strong>: ${esc(chatReply.text || '').slice(0, 110)}</span><button type="button" onclick="cancelTaskChatReply()">×</button></div>` : '';
    const files = pendingChatFiles.length ? `<div class="task-chat-pending-files">${pendingChatFiles.map(file => `<span>📎 ${esc(file.name)}</span>`).join('')}</div>` : '';
    return `<section class="task-chat-conversation"><header class="task-chat-conversation-head"><button class="task-chat-mobile-back" onclick="closeTaskChat()">‹</button><div><span>${esc(task.id)}</span><h2>${esc(task.title)}</h2></div><button type="button" onclick="openTask('${task.id}')">Open Task</button></header><div class="task-chat-summary"><span class="table-status status-${task.status}">${esc(task.jiraStatus || task.status)}</span><span><small>Assignee</small>${esc(task.assignee || 'Unassigned')}</span><span><small>Supervisor</small>${esc(taskSupervisor(task) || 'Unassigned')}</span><span><small>Due date</small>${task.dueDate ? esc(formatDate(task.dueDate).replace(/<[^>]+>/g, '')) : 'None'}</span></div><div id="taskChatMessages" class="task-chat-messages">${comments.length ? comments.map(messageHTML).join('') : '<p class="task-chat-empty">No messages yet. Start the conversation below.</p>'}</div><form class="task-chat-composer" onsubmit="sendTaskChatMessage54('${task.id}',event)">${quoted}${files}<div class="task-chat-compose-row"><label class="task-chat-attach" title="Attach files">＋<input type="file" multiple onchange="attachTaskChatFiles(this.files)"></label><textarea name="message" rows="1" placeholder="Write a comment… Use @ to mention"></textarea><button type="submit" aria-label="Send comment">➤</button></div></form></section>`;
  }

  window.renderTaskChat = () => {
    if (!chatView) return;
    const tasks = matchingChatRows();
    const task = tasks.find(item => item.id === window.MAILO_ACTIVE_CHAT) || null;
    chatView.innerHTML = `<div class="task-chat-layout ${task ? 'has-active-chat' : ''}">${listHTML(tasks)}${conversationHTML(task)}</div>`;
    refreshUnreadBadge();
    requestAnimationFrame(() => { const messages = document.getElementById('taskChatMessages'); if (messages) messages.scrollTop = messages.scrollHeight; });
  };

  window.openTaskChat = id => {
    const task = state.tasks.find(item => item.id === id);
    if (!task || !participant(task)) return;
    window.MAILO_ACTIVE_CHAT = id;
    chatReply = null;
    pendingChatFiles = [];
    persistRead(task);
    renderTaskChat();
  };
  window.closeTaskChat = () => { window.MAILO_ACTIVE_CHAT = null; chatReply = null; pendingChatFiles = []; renderTaskChat(); };
  window.replyInTaskChat = id => {
    const task = state.tasks.find(item => item.id === window.MAILO_ACTIVE_CHAT);
    const comment = task?.comments?.find(item => item.id === id);
    if (!comment) return;
    chatReply = { id: comment.id, author: comment.author || 'User', text: comment.text || 'Attachment' };
    renderTaskChat();
    requestAnimationFrame(() => document.querySelector('.task-chat-composer textarea')?.focus());
  };
  window.cancelTaskChatReply = () => { chatReply = null; renderTaskChat(); };
  window.attachTaskChatFiles = files => {
    Promise.all([...files].map(file => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    }))).then(items => { pendingChatFiles.push(...items); renderTaskChat(); }).catch(() => toast('The selected file could not be attached'));
  };
  window.sendTaskChatMessage54 = (id, event) => {
    event.preventDefault();
    const task = state.tasks.find(item => item.id === id);
    const text = event.currentTarget.elements.message.value.trim();
    if (!task || (!text && !pendingChatFiles.length)) return;
    const createdAt = new Date().toISOString();
    const images = pendingChatFiles.filter(file => file.type?.startsWith('image/')).map(file => file.data);
    const attachments = pendingChatFiles.filter(file => !file.type?.startsWith('image/'));
    task.comments = task.comments || [];
    task.comments.unshift({ id: `comment-${Date.now()}`, author: CURRENT_USER, role: roleName(), text, images, attachments, replyTo: chatReply, createdAt, human: true });
    task.lastHumanActivityAt = createdAt;
    task.updated = createdAt;
    task.chatReadBy = { ...(task.chatReadBy || {}), [CURRENT_USER]: createdAt };
    task.audit = task.audit || [];
    task.audit.unshift(`Chat comment added by ${CURRENT_USER}`);
    chatReply = null;
    pendingChatFiles = [];
    save();
    renderTaskChat();
    toast('Comment sent');
  };

  // Last Checked is a private Victor-only field, but its value is saved with the shared Task.
  const priorColumnVisible = isColumnVisible;
  isColumnVisible = key => key === 'lastChecked' ? isVictor() : priorColumnVisible(key);
  const priorSortListRows = sortListRows;
  sortListRows = function version54SortListRows(rows) {
    if (!state.listSort.some(sort => sort.key === 'lastChecked')) return priorSortListRows(rows);
    const otherSorts = state.listSort.filter(sort => sort.key !== 'lastChecked');
    const lastSort = state.listSort.find(sort => sort.key === 'lastChecked');
    const savedSorts = state.listSort;
    state.listSort = otherSorts;
    const base = otherSorts.length ? priorSortListRows(rows) : [...rows];
    state.listSort = savedSorts;
    return base.sort((a, b) => {
      const av = new Date(state.tasks.find(task => task.id === a.id)?.lastChecks?.[VICTOR] || 0).getTime();
      const bv = new Date(state.tasks.find(task => task.id === b.id)?.lastChecks?.[VICTOR] || 0).getTime();
      return lastSort.direction === 'asc' ? av - bv : bv - av;
    });
  };
  const priorOpenTask = openTask;
  openTask = function version54OpenTask(id, preserveDirty = false) {
    const task = state.tasks.find(item => item.id === id);
    const previousNonVictorValue = !isVictor() ? task?.lastChecks?.[CURRENT_USER] : undefined;
    if (task && isVictor() && !preserveDirty) {
      task.lastChecks = { ...(task.lastChecks || {}), [VICTOR]: new Date().toISOString() };
      save();
      if (state.appSection === 'tasks') renderList();
    }
    const result = priorOpenTask(id, preserveDirty);
    if (task && !isVictor()) {
      task.lastChecks = { ...(task.lastChecks || {}) };
      if (previousNonVictorValue) task.lastChecks[CURRENT_USER] = previousNonVictorValue;
      else delete task.lastChecks[CURRENT_USER];
      save();
    }
    return result;
  };

  // Correct every section's visibility. Version 53 previously kept Tasks visible behind every non-chat section.
  const priorRender = render;
  render = function version54Render() {
    priorRender();
    const section = state.appSection;
    const views = { tasks: 'tasksContent', chat: 'chatView', users: 'usersView', spaces: 'spacesView', overview: 'overviewView', activity: 'activityView' };
    Object.entries(views).forEach(([name, id]) => document.getElementById(id)?.classList.toggle('hidden', section !== name));
    document.querySelectorAll('.main-nav .nav-item').forEach(button => {
      const name = button.dataset.view === 'board' ? 'tasks' : button.dataset.view;
      button.classList.toggle('active', name === section);
    });
    document.querySelectorAll('.mobile-bottom-nav [data-mobile-view]').forEach(button => button.classList.toggle('active', button.dataset.mobileView === section));
    if (section === 'chat') renderTaskChat(); else refreshUnreadBadge();
  };

  // Compact mobile controls, with Filters collapsed by default.
  const toolbar = document.querySelector('#tasksContent .toolbar');
  if (toolbar && !document.getElementById('mobileFiltersToggle')) {
    const toggle = document.createElement('button');
    toggle.id = 'mobileFiltersToggle';
    toggle.className = 'mobile-filters-toggle';
    toggle.type = 'button';
    toggle.innerHTML = '<span>☷</span> Filters <b>0</b>';
    toggle.onclick = () => { toolbar.classList.toggle('mobile-filters-open'); toggle.setAttribute('aria-expanded', String(toolbar.classList.contains('mobile-filters-open'))); };
    toolbar.parentNode.insertBefore(toggle, toolbar);
    const refreshFilterCount = () => { toggle.querySelector('b').textContent = String(toolbar.querySelectorAll('input:checked').length); };
    toolbar.addEventListener('change', refreshFilterCount);
    refreshFilterCount();
  }
  document.getElementById('mobileMenuButton')?.addEventListener('click', () => setSidebarState(false));

  refreshUnreadBadge();
  render();
})();
