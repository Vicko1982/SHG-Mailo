/* MAILO Version 58 — fluid Task details, compact Chat information and live messages. */
(() => {
  let chatInfoOpen58 = false;
  let lastChatId58 = null;
  let refreshingChat58 = false;

  function collapseChatInformation58() {
    const summary = document.querySelector('#chatView .task-chat-summary');
    if (!summary || summary.closest('.task-chat-info58')) return;
    const details = document.createElement('details');
    details.className = 'task-chat-info58';
    details.open = chatInfoOpen58;
    details.innerHTML = '<summary><span>Task information</span><small>Assignee, Supervisor, Due Date and Access</small></summary>';
    summary.before(details);
    details.appendChild(summary);
    details.addEventListener('toggle', () => { chatInfoOpen58 = details.open; });
  }

  const previousRenderTaskChat58 = window.renderTaskChat;
  window.renderTaskChat = function version58RenderTaskChat() {
    const currentChatId = window.MAILO_ACTIVE_CHAT || null;
    const existing = document.querySelector('#chatView .task-chat-info58');
    if (currentChatId !== lastChatId58) chatInfoOpen58 = false;
    else if (existing) chatInfoOpen58 = existing.open;
    previousRenderTaskChat58?.();
    collapseChatInformation58();
    lastChatId58 = currentChatId;
  };

  function isoFromTypedDate58(value) {
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const digits = text.replace(/\D/g, '');
    if (digits.length !== 8) return '';
    const iso = `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
    const date = new Date(`${iso}T00:00:00`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? '' : iso;
  }

  function displayDate58(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }

  function addCalendarPicker58(formId) {
    const input = document.querySelector(`#${formId} input[name="dueDate"]`);
    if (!input || input.closest('.keyboard-date58')) return;
    const wrapper = document.createElement('span');
    wrapper.className = 'keyboard-date58';
    input.before(wrapper);
    wrapper.appendChild(input);
    const picker = document.createElement('input');
    picker.type = 'date';
    picker.className = 'native-date-picker58';
    picker.setAttribute('aria-label', 'Choose Due Date from calendar');
    picker.title = 'Choose date';
    picker.value = isoFromTypedDate58(input.value);
    picker.addEventListener('change', () => {
      input.value = displayDate58(picker.value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    input.addEventListener('blur', () => { picker.value = isoFromTypedDate58(input.value); });
    wrapper.appendChild(picker);
  }

  const previousNewTaskModal58 = newTaskModal;
  newTaskModal = function version58NewTaskModal() {
    previousNewTaskModal58();
    addCalendarPicker58('taskForm');
  };
  const previousMiniTaskModal58 = miniTaskModal;
  miniTaskModal = function version58MiniTaskModal() {
    previousMiniTaskModal58();
    addCalendarPicker58('miniTaskForm');
  };
  const newTaskButton58 = document.getElementById('newTaskBtn');
  const mobileNewTaskButton58 = document.getElementById('mobileNewTaskBtn');
  const miniTaskButton58 = document.getElementById('miniTaskBtn');
  if (newTaskButton58) newTaskButton58.onclick = newTaskModal;
  if (mobileNewTaskButton58) mobileNewTaskButton58.onclick = newTaskModal;
  if (miniTaskButton58) miniTaskButton58.onclick = miniTaskModal;

  const commentKey58 = comment => String(comment.id || `${comment.author || ''}|${comment.createdAt || ''}|${comment.text || ''}`);
  async function refreshTaskChat58() {
    if (window.SHG_USE_REALTIME_CHAT60) return;
    if (refreshingChat58 || state.appSection !== 'chat' || document.visibilityState !== 'visible' || (typeof window.shgFetchRemoteComments !== 'function' && typeof window.shgPrepareRemoteData !== 'function')) return;
    refreshingChat58 = true;
    try {
      let remoteTasks;
      if (typeof window.shgFetchRemoteComments === 'function') {
        const entries = await window.shgFetchRemoteComments();
        const commentsByTask = new Map();
        for (const entry of entries) {
          if (!commentsByTask.has(entry.taskId)) commentsByTask.set(entry.taskId, []);
          commentsByTask.get(entry.taskId).push(entry.comment);
        }
        remoteTasks = [...commentsByTask].map(([id, comments]) => ({ id, comments }));
      } else {
        await window.shgPrepareRemoteData();
        remoteTasks = window.SHG_REMOTE_BOOTSTRAP?.tasks;
      }
      if (!Array.isArray(remoteTasks)) return;
      let changed = false;
      const remoteById = new Map(remoteTasks.map(task => [task.id, task]));
      for (const localTask of state.tasks) {
        const remoteTask = remoteById.get(localTask.id);
        if (!remoteTask) continue;
        const localComments = localTask.comments || [], known = new Set(localComments.map(commentKey58));
        const incoming = (remoteTask.comments || []).filter(comment => !known.has(commentKey58(comment)));
        if (!incoming.length) continue;
        localTask.comments = [...incoming, ...localComments].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        localTask.updated = remoteTask.updated || incoming.reduce((latest, comment) => new Date(comment.createdAt || 0) > new Date(latest || 0) ? comment.createdAt : latest, localTask.updated);
        changed = true;
      }
      if (!changed) return;
      const composer = document.querySelector('#chatView .task-chat-composer textarea');
      const typedMessage = composer?.value || '';
      renderTaskChat();
      const nextComposer = document.querySelector('#chatView .task-chat-composer textarea');
      if (nextComposer && typedMessage) nextComposer.value = typedMessage;
    } catch (error) {
      console.warn('Task Chat live refresh skipped', error);
    } finally {
      refreshingChat58 = false;
    }
  }

  window.refreshTaskChat58 = refreshTaskChat58;
  window.SHG_TASK_CHAT_POLL58 = setInterval(refreshTaskChat58, 8000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshTaskChat58(); });
  setTimeout(refreshTaskChat58, 2500);

  render();
})();
