/* MAILO Version 55 — reliable roles, drafts, mobile Tasks and richer Task Chat. */
(() => {
  const VICTOR = 'Victor Stavropoulos';
  const chatView = document.getElementById('chatView');
  const serverRoles = () => window.SHG_REMOTE_BOOTSTRAP?.roleByName || {};
  const currentServerRole = name => name === VICTOR ? 'main_admin' : (serverRoles()[name] || (state.admins.has(name) ? 'admin' : 'user'));
  let roleDraft = Object.fromEntries(PEOPLE.map(person => [person.name, currentServerRole(person.name)]));

  const previousCanAccessTask55 = canCurrentUserAccessTask;
  canCurrentUserAccessTask = function version55CanAccessTask(task) {
    if (!task) return false;
    if (['main_admin', 'admin'].includes(currentServerRole(CURRENT_USER))) return true;
    if ([task.creator, task.assignee, taskSupervisor(task), taskApprover(task)].includes(CURRENT_USER)) return true;
    if (isUserMentioned(task, CURRENT_USER)) return true;
    return previousCanAccessTask55(task);
  };

  function hydrateTaskState55(force = false) {
    const remote = window.SHG_REMOTE_BOOTSTRAP?.tasks;
    if (!Array.isArray(remote) || !remote.length) return false;
    if (force || !state.tasks.length || state.tasks.every(task => !task?._supabaseId)) {
      state.tasks = structuredClone(remote);
      writeTaskCache(state.tasks);
      return true;
    }
    return false;
  }
  hydrateTaskState55();

  window.reloadMobileTasks55 = async () => {
    const button = document.getElementById('mobileTaskRetry55');
    if (button) { button.disabled = true; button.textContent = 'Loading…'; }
    try {
      await window.shgEnsureFreshSession?.();
      const result = await window.shgPrepareRemoteData?.();
      if (!result?.remote || !Array.isArray(window.SHG_REMOTE_BOOTSTRAP?.tasks)) throw new Error('The shared task list was not returned.');
      hydrateTaskState55(true);
      state.project = 'all'; state.query = ''; state.taskPage = 1;
      render();
      toast(`${state.tasks.length} Tasks loaded`);
    } catch (error) {
      console.error('Mobile Task reload failed', error);
      const message = document.getElementById('mobileTaskLoadMessage55');
      if (message) message.textContent = error?.message || 'The Tasks could not be loaded. Please try again.';
      if (button) { button.disabled = false; button.textContent = 'Try again'; }
    }
  };

  function decorateMobileTaskRows55() {
    const table = document.getElementById('mainTaskTable');
    if (!table) return;
    const keys = [...table.querySelectorAll('thead th')].map(header => header.dataset.header || 'select');
    for (const row of table.querySelectorAll('tbody tr[data-task-row]')) {
      [...row.cells].forEach((cell, index) => {
        const key = keys[index] || '';
        cell.dataset.mobileKey = key;
        cell.dataset.mobileLabel = LIST_COLUMNS.find(column => column.key === key)?.label || '';
      });
      row.tabIndex = 0;
    }
  }

  const previousRenderList55 = renderList;
  renderList = function version55RenderList() {
    if (!state.tasks.length) hydrateTaskState55();
    previousRenderList55();
    decorateMobileTaskRows55();
    if (!document.querySelectorAll('#mainTaskTable tbody tr[data-task-row]').length && window.matchMedia('(max-width:850px)').matches) {
      const empty = document.querySelector('#mainTaskTable .empty-log');
      if (empty) empty.innerHTML = '<div class="mobile-task-empty55"><strong>No Tasks are visible yet</strong><span id="mobileTaskLoadMessage55">Check the shared list again or clear the current filters.</span><button id="mobileTaskRetry55" type="button" onclick="reloadMobileTasks55()">Try again</button></div>';
    }
  };

  const previousRenderUsers55 = renderUsers;
  function userNameFromRow55(row) {
    const person = row.querySelector('.table-person');
    if (!person) return '';
    const copy = person.cloneNode(true);
    copy.querySelector('i')?.remove();
    return copy.textContent.trim();
  }
  renderUsers = function version55RenderUsers() {
    previousRenderUsers55();
    requestAnimationFrame(() => {
      document.querySelectorAll('#usersTable tbody tr').forEach(row => {
        const name = userNameFromRow55(row), cell = row.children[3];
        if (!name || !cell) return;
        const role = name === VICTOR ? 'main_admin' : (roleDraft[name] || currentServerRole(name));
        cell.dataset.actualRole = role;
        if (name === VICTOR) { cell.innerHTML = '<span class="main-admin-badge">Main Admin</span>'; return; }
        let select = cell.querySelector('select');
        if (!select) { cell.innerHTML = `<select aria-label="Role for ${esc(name)}" onchange="setUserAdmin(${esc(JSON.stringify(name))},this.value)"></select>`; select = cell.querySelector('select'); }
        select.innerHTML = '<option value="user">User</option><option value="admin">Administrator</option><option value="main_admin">Main Admin</option>';
        select.value = role;
      });
    });
  };

  setUserAdmin = function version55SetUserRole(name, role) {
    if (!isMainAdmin()) { renderUsers(); toast('Only a Main Admin can manage roles'); return; }
    if (name === VICTOR) { toast('Victor must always remain a Main Admin'); renderUsers(); return; }
    if (!['user', 'admin', 'main_admin'].includes(role)) return;
    roleDraft[name] = role;
    const draft = ensureUsersDraft();
    role === 'user' ? draft.admins.delete(name) : draft.admins.add(name);
    markUsersDraftDirty(); renderUsers();
  };

  const previousSaveUsers55 = saveUsersChanges;
  saveUsersChanges = async function version55SaveUsers() {
    const draft = ensureUsersDraft();
    if (!draft.dirty || draft.saving) return;
    const before = { ...serverRoles() };
    await previousSaveUsers55();
    if (usersDraft?.dirty) return;
    try {
      for (const person of PEOPLE) {
        if (person.name === VICTOR || !person.id) continue;
        const wanted = roleDraft[person.name] || 'user', old = before[person.name] || 'user';
        if (wanted === old || (wanted !== 'main_admin' && old !== 'main_admin')) continue;
        await window.shgInvokeFunction('admin-set-user-role', { user_id: person.id, role: wanted });
      }
      const updated = { ...serverRoles(), ...roleDraft, [VICTOR]: 'main_admin' };
      window.SHG_REMOTE_BOOTSTRAP.roleByName = updated;
      window.SHG_REMOTE_BOOTSTRAP.mainAdminNames = Object.keys(updated).filter(name => updated[name] === 'main_admin');
      window.SHG_REMOTE_BOOTSTRAP.adminNames = Object.keys(updated).filter(name => ['admin', 'main_admin'].includes(updated[name]));
      state.admins = new Set(window.SHG_REMOTE_BOOTSTRAP.adminNames); state.admins.add(VICTOR); saveAdmins();
      roleDraft = Object.fromEntries(PEOPLE.map(person => [person.name, updated[person.name] || 'user']));
      render();
    } catch (error) { console.error('Role save failed', error); toast(error?.message || 'The role changes could not be saved'); }
  };

  const hasUnsavedUsers55 = () => Boolean(usersDraft?.dirty && !usersDraft?.saving);
  const discardUsers55 = () => { usersDraft = null; roleDraft = Object.fromEntries(PEOPLE.map(person => [person.name, currentServerRole(person.name)])); };
  document.addEventListener('click', event => {
    if (state.appSection !== 'users' || !hasUnsavedUsers55()) return;
    if (event.target.closest('#usersView,#modalBackdrop')) return;
    if (!event.target.closest('.main-nav .nav-item,.project-item,.mobile-bottom-nav button')) return;
    if (confirm('You have unsaved changes. Leave without saving them?')) { discardUsers55(); return; }
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  }, true);
  window.addEventListener('beforeunload', event => { if (hasUnsavedUsers55()) { event.preventDefault(); event.returnValue = ''; } });

  // Task Chat filters and audio messages.
  let showDoneChats = false, unreadOnlyChats = false, chatReply55 = null, pendingFiles55 = [], audioDraft55 = null;
  let mediaRecorder55 = null, mediaStream55 = null, audioChunks55 = [], audioStartedAt55 = 0;
  const participant55 = task => task.assignee === CURRENT_USER || taskSupervisor(task) === CURRENT_USER || isUserMentioned(task, CURRENT_USER);
  const readAt55 = task => new Date(task.chatReadBy?.[CURRENT_USER] || 0).getTime();
  const unread55 = task => (task.comments || []).filter(comment => comment.author !== CURRENT_USER && new Date(comment.createdAt).getTime() > readAt55(task)).length;
  const chatRows55 = () => state.tasks.filter(task => !isTaskDeleted(task) && canCurrentUserAccessTask(task) && participant55(task) && (showDoneChats || task.status !== 'done'));
  const formatDuration55 = seconds => `${Math.floor(seconds / 60)}:${String(Math.max(0, seconds % 60)).padStart(2, '0')}`;

  function matchingChatRows55() {
    const query = String(window.MAILO_CHAT_QUERY || '').trim().toLowerCase();
    return chatRows55().filter(task => !unreadOnlyChats || unread55(task) > 0).filter(task => !query || `${task.id} ${task.title}`.toLowerCase().includes(query)).sort((a, b) => new Date(b.comments?.[0]?.createdAt || b.updated) - new Date(a.comments?.[0]?.createdAt || a.updated));
  }
  function refreshUnreadBadge55() {
    const count = state.tasks.filter(task => !isTaskDeleted(task) && canCurrentUserAccessTask(task) && participant55(task)).reduce((total, task) => total + unread55(task), 0), badge = document.getElementById('chatUnreadBadge');
    if (!badge) return; badge.textContent = String(count); badge.title = `${count} unread message${count === 1 ? '' : 's'}`; badge.classList.toggle('hidden', count === 0);
  }
  function messageAssets55(comment) {
    const images = (comment.images || []).map(source => `<a class="task-chat-image" href="${source}" target="_blank" rel="noopener"><img src="${source}" alt="Comment attachment"></a>`).join('');
    const files = (comment.attachments || []).map(file => `<a class="task-chat-file" href="${file.data}" download="${esc(file.name)}">📎 ${esc(file.name)}</a>`).join('');
    const audio = comment.audioMessage?.data ? `<div class="task-chat-audio"><audio controls preload="metadata" src="${comment.audioMessage.data}"></audio><small>Voice message · ${formatDuration55(Number(comment.audioMessage.duration) || 0)}</small></div>` : '';
    return images + files + audio;
  }
  function messageHTML55(comment) {
    if (comment.system) return `<div class="task-chat-system"><span>${esc(comment.text || '')}</span><time>${formatDateTime(comment.createdAt)}</time></div>`;
    const reply = comment.replyTo ? `<div class="task-chat-quote"><strong>${esc(comment.replyTo.author)}</strong><span>${esc(comment.replyTo.text || '')}</span></div>` : '';
    return `<article class="task-chat-message ${comment.author === CURRENT_USER ? 'mine' : ''}"><div class="task-chat-avatar">${initials(comment.author || 'User')}</div><div class="task-chat-message-body"><header><strong>${esc(comment.author || 'User')}</strong><time>${formatDateTime(comment.createdAt)}</time><button type="button" class="task-chat-reply" onclick="replyInTaskChat('${comment.id}')">Reply</button></header><div class="task-chat-bubble">${reply}${comment.text ? `<p>${esc(comment.text)}</p>` : ''}${messageAssets55(comment)}</div></div></article>`;
  }
  function listHTML55(tasks) {
    return `<aside class="task-chat-list"><div class="task-chat-list-head"><div><p class="eyebrow">MAILO</p><h1>Task Chat</h1></div><div class="task-chat-head-actions"><button type="button" class="chat-filter-toggle ${showDoneChats ? 'active' : ''}" onclick="toggleDoneChats55()">Show Done</button><button type="button" class="chat-filter-toggle ${unreadOnlyChats ? 'active' : ''}" onclick="toggleUnreadChats55()">Unread</button><button type="button" class="chat-notification-button" onclick="enableTaskChatNotifications()" title="Enable notifications">◉</button></div></div><label class="task-chat-search">⌕<input value="${esc(window.MAILO_CHAT_QUERY || '')}" placeholder="Search Task Chats…" oninput="MAILO_CHAT_QUERY=this.value;renderTaskChat()"></label><div class="task-chat-threads">${tasks.length ? tasks.map(task => { const count = unread55(task), last = task.comments?.[0]; return `<button type="button" class="task-chat-thread ${window.MAILO_ACTIVE_CHAT === task.id ? 'active' : ''}" onclick="openTaskChat('${task.id}')"><span class="task-chat-thread-code">${esc(task.id)}</span><strong>${esc(task.title)}</strong><small>${last ? `${esc(last.author || 'System')}: ${esc(last.text || (last.audioMessage ? 'Voice message' : 'Attachment')).slice(0, 70)}` : 'No messages yet'}</small><footer><span class="table-status status-${task.status}">${esc(task.jiraStatus || task.status)}</span>${count ? `<b>${count}</b>` : ''}</footer></button>`; }).join('') : '<p class="task-chat-empty">No Task Chats match this view.</p>'}</div></aside>`;
  }
  function audioDraftHTML55() { return audioDraft55 ? `<div class="task-chat-audio-preview"><audio controls src="${audioDraft55.data}"></audio><span>${formatDuration55(audioDraft55.duration)}</span><button type="button" onclick="deleteTaskChatAudio55()">Delete</button></div>` : ''; }
  function conversationHTML55(task) {
    if (!task) return '<section class="task-chat-welcome"><div>◌</div><h2>Select a Task Chat</h2><p>Messages, mentions and Task changes will appear here.</p></section>';
    const comments = [...(task.comments || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const quote = chatReply55 ? `<div class="task-chat-compose-reply"><span>Replying to <strong>${esc(chatReply55.author)}</strong>: ${esc(chatReply55.text || '').slice(0, 110)}</span><button type="button" onclick="cancelTaskChatReply()">×</button></div>` : '';
    const files = pendingFiles55.length ? `<div class="task-chat-pending-files">${pendingFiles55.map(file => `<span>📎 ${esc(file.name)}</span>`).join('')}</div>` : '';
    return `<section class="task-chat-conversation"><header class="task-chat-conversation-head"><button class="task-chat-mobile-back" onclick="closeTaskChat()">‹</button><div><span>${esc(task.id)}</span><h2>${esc(task.title)}</h2></div><button type="button" onclick="openTask('${task.id}')">Open Task</button></header><div class="task-chat-summary"><span class="table-status status-${task.status}">${esc(task.jiraStatus || task.status)}</span><span><small>Assignee</small>${esc(task.assignee || 'Unassigned')}</span><span><small>Supervisor</small>${esc(taskSupervisor(task) || 'Unassigned')}</span><span><small>Due date</small>${task.dueDate ? esc(formatDate(task.dueDate).replace(/<[^>]+>/g, '')) : 'None'}</span></div><div id="taskChatMessages" class="task-chat-messages">${comments.length ? comments.map(messageHTML55).join('') : '<p class="task-chat-empty">No messages yet. Start the conversation below.</p>'}</div><form class="task-chat-composer" onsubmit="sendTaskChatMessage55('${task.id}',event)">${quote}${files}${audioDraftHTML55()}<div class="task-chat-compose-row"><label class="task-chat-attach" title="Attach files">＋<input type="file" multiple onchange="attachTaskChatFiles(this.files)"></label><button id="taskChatMic55" type="button" class="task-chat-mic ${mediaRecorder55?.state === 'recording' ? 'recording' : ''}" onclick="toggleTaskChatAudio55()" title="Record voice message">${mediaRecorder55?.state === 'recording' ? '■' : '🎙'}</button><textarea name="message" rows="1" placeholder="Write a comment… Use @ to mention"></textarea><button type="submit" aria-label="Send comment">➤</button></div></form></section>`;
  }

  window.renderTaskChat = () => {
    if (!chatView) return;
    const tasks = matchingChatRows55(), active = state.tasks.find(task => task.id === window.MAILO_ACTIVE_CHAT && participant55(task) && (showDoneChats || task.status !== 'done')) || null;
    chatView.innerHTML = `<div class="task-chat-layout ${active ? 'has-active-chat' : ''}">${listHTML55(tasks)}${conversationHTML55(active)}</div>`;
    refreshUnreadBadge55(); requestAnimationFrame(() => { const messages = document.getElementById('taskChatMessages'); if (messages) messages.scrollTop = messages.scrollHeight; });
  };
  window.toggleDoneChats55 = () => { showDoneChats = !showDoneChats; renderTaskChat(); };
  window.toggleUnreadChats55 = () => { unreadOnlyChats = !unreadOnlyChats; renderTaskChat(); };
  window.openTaskChat = id => { const task = state.tasks.find(item => item.id === id); if (!task || !participant55(task)) return; window.MAILO_ACTIVE_CHAT = id; chatReply55 = null; pendingFiles55 = []; audioDraft55 = null; const newest = Math.max(Date.now(), ...(task.comments || []).map(comment => new Date(comment.createdAt).getTime() || 0)); task.chatReadBy = { ...(task.chatReadBy || {}), [CURRENT_USER]: new Date(newest).toISOString() }; save(); renderTaskChat(); };
  window.closeTaskChat = () => { stopRecorder55(); window.MAILO_ACTIVE_CHAT = null; chatReply55 = null; pendingFiles55 = []; audioDraft55 = null; renderTaskChat(); };
  window.replyInTaskChat = id => { const task = state.tasks.find(item => item.id === window.MAILO_ACTIVE_CHAT), comment = task?.comments?.find(item => item.id === id); if (!comment) return; chatReply55 = { id: comment.id, author: comment.author || 'User', text: comment.text || (comment.audioMessage ? 'Voice message' : 'Attachment') }; renderTaskChat(); requestAnimationFrame(() => document.querySelector('.task-chat-composer textarea')?.focus()); };
  window.cancelTaskChatReply = () => { chatReply55 = null; renderTaskChat(); };
  window.attachTaskChatFiles = files => { Promise.all([...files].map(file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result }); reader.onerror = reject; reader.readAsDataURL(file); }))).then(items => { pendingFiles55.push(...items); renderTaskChat(); }).catch(() => toast('The selected file could not be attached')); };
  function stopRecorder55() { if (mediaRecorder55?.state === 'recording') mediaRecorder55.stop(); mediaStream55?.getTracks().forEach(track => track.stop()); mediaStream55 = null; }
  window.toggleTaskChatAudio55 = async () => {
    if (mediaRecorder55?.state === 'recording') { mediaRecorder55.stop(); return; }
    try {
      mediaStream55 = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'], mimeType = types.find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
      mediaRecorder55 = new MediaRecorder(mediaStream55, mimeType ? { mimeType } : undefined); audioChunks55 = []; audioStartedAt55 = Date.now();
      mediaRecorder55.ondataavailable = event => { if (event.data?.size) audioChunks55.push(event.data); };
      mediaRecorder55.onstop = () => {
        const duration = Math.max(1, Math.round((Date.now() - audioStartedAt55) / 1000)), type = mediaRecorder55.mimeType || audioChunks55[0]?.type || 'audio/webm', blob = new Blob(audioChunks55, { type });
        mediaStream55?.getTracks().forEach(track => track.stop()); mediaStream55 = null;
        if (blob.size > 8 * 1024 * 1024) { audioDraft55 = null; toast('The voice message is too large. Please keep it shorter.'); renderTaskChat(); return; }
        const reader = new FileReader(); reader.onload = () => { audioDraft55 = { data: reader.result, type, duration }; renderTaskChat(); }; reader.onerror = () => { toast('The voice message could not be prepared'); renderTaskChat(); }; reader.readAsDataURL(blob);
      };
      mediaRecorder55.start(); const mic = document.getElementById('taskChatMic55'); if (mic) { mic.classList.add('recording'); mic.textContent = '■'; mic.title = 'Stop recording'; } toast('Recording voice message… Tap the microphone again to stop.');
    } catch (error) { console.error('Task Chat microphone failed', error); toast('Microphone access is required to record a voice message'); }
  };
  window.deleteTaskChatAudio55 = () => { audioDraft55 = null; renderTaskChat(); };
  window.sendTaskChatMessage55 = (id, event) => {
    event.preventDefault(); const task = state.tasks.find(item => item.id === id), text = event.currentTarget.elements.message.value.trim();
    if (!task || (!text && !pendingFiles55.length && !audioDraft55)) return;
    const createdAt = new Date().toISOString(), images = pendingFiles55.filter(file => file.type?.startsWith('image/')).map(file => file.data), attachments = pendingFiles55.filter(file => !file.type?.startsWith('image/'));
    task.comments = task.comments || []; task.comments.unshift({ id: `comment-${Date.now()}`, author: CURRENT_USER, role: roleName(), text, images, attachments, audioMessage: audioDraft55, replyTo: chatReply55, createdAt, human: true });
    task.lastHumanActivityAt = createdAt; task.updated = createdAt; task.chatReadBy = { ...(task.chatReadBy || {}), [CURRENT_USER]: createdAt }; task.audit = task.audit || []; task.audit.unshift(`Chat comment added by ${CURRENT_USER}`);
    chatReply55 = null; pendingFiles55 = []; audioDraft55 = null; save(); renderTaskChat(); toast('Comment sent');
  };

  const previousRender55 = render;
  render = function version55Render() { previousRender55(); if (state.appSection === 'tasks') decorateMobileTaskRows55(); if (state.appSection === 'chat') renderTaskChat(); else refreshUnreadBadge55(); };
  window.addEventListener('shg:remote-ready', () => { if (hydrateTaskState55()) render(); });
  refreshUnreadBadge55(); render();
})();
