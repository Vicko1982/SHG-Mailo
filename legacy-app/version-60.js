/* MAILO Version 60/61 — fast permissions and stable realtime Task Chat delivery. */
(() => {
  window.SHG_USE_REALTIME_CHAT60 = true;
  if (window.SHG_TASK_CHAT_POLL58) {
    clearInterval(window.SHG_TASK_CHAT_POLL58);
    window.SHG_TASK_CHAT_POLL58 = null;
  }

  const commentIdentity60 = comment => String(comment?._supabaseId || comment?.id || '');

  function renderChatUpdate60() {
    if (state.appSection !== 'chat') {
      window.refreshUnreadBadge55?.();
      return;
    }
    const textarea = document.querySelector('#chatView .task-chat-composer textarea');
    const typed = textarea?.value || '';
    const selectionStart = textarea?.selectionStart || 0;
    const selectionEnd = textarea?.selectionEnd || selectionStart;
    const messages = document.getElementById('taskChatMessages');
    const previousScrollTop = messages?.scrollTop || 0;
    const wasAtBottom = messages ? messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80 : true;
    window.renderTaskChat?.();
    requestAnimationFrame(() => {
      const nextTextarea = document.querySelector('#chatView .task-chat-composer textarea');
      if (nextTextarea && typed) {
        nextTextarea.value = typed;
        nextTextarea.setSelectionRange(selectionStart, selectionEnd);
      }
      const nextMessages = document.getElementById('taskChatMessages');
      if (nextMessages && !wasAtBottom) nextMessages.scrollTop = previousScrollTop;
    });
  }

  function mergeComment60(task, incoming) {
    if (!task || !incoming) return false;
    task.comments = task.comments || [];
    const identity = commentIdentity60(incoming);
    const index = task.comments.findIndex(comment =>
      commentIdentity60(comment) === identity ||
      (incoming.id && comment.id === incoming.id),
    );
    if (index >= 0) {
      const local = task.comments[index];
      task.comments[index] = {
        ...local,
        ...incoming,
        deliveryStatus: local.author === CURRENT_USER ? 'sent' : undefined,
      };
    } else {
      task.comments.push(incoming);
    }
    task.comments.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    task.updated = new Date(incoming.createdAt || Date.now()).toISOString();
    return true;
  }

  function mergeCommentHistory60(remoteTasks) {
    if (!Array.isArray(remoteTasks)) return false;
    let changed = false;
    const remoteById = new Map(remoteTasks.map(task => [task.id, task]));
    for (const task of state.tasks) {
      const remote = remoteById.get(task.id);
      if (!remote) continue;
      const pending = (task.comments || []).filter(comment => !comment._supabaseId || ['sending', 'sent', 'failed'].includes(comment.deliveryStatus));
      const remoteComments = structuredClone(remote.comments || []);
      const known = new Set(remoteComments.map(commentIdentity60));
      task.comments = [...remoteComments, ...pending.filter(comment => !known.has(commentIdentity60(comment)))]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      changed = true;
    }
    return changed;
  }

  window.addEventListener('shg:comments-ready', event => {
    if (!mergeCommentHistory60(event.detail?.tasks)) return;
    writeTaskCache(state.tasks);
    renderChatUpdate60();
  });

  function applyCommentChange60(detail) {
    const { type, taskId, comment, remoteId } = detail || {};
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return false;
    if (type === 'DELETE') {
      const before = task.comments?.length || 0;
      task.comments = (task.comments || []).filter(item => item._supabaseId !== remoteId && item.id !== remoteId);
      if (task.comments.length === before) return false;
    } else if (!mergeComment60(task, comment)) {
      return false;
    }
    return true;
  }

  window.addEventListener('shg:comment-change', event => {
    if (!applyCommentChange60(event.detail)) return;
    writeTaskCache(state.tasks);
    renderChatUpdate60();
  });

  window.addEventListener('shg:comment-batch', event => {
    const changes = event.detail?.changes || [];
    let changed = false;
    for (const detail of changes) changed = applyCommentChange60(detail) || changed;
    if (!changed) return;
    // One cache write and one render for the entire fallback batch.
    writeTaskCache(state.tasks);
    renderChatUpdate60();
  });

  // Covers the race where the deferred history finished while version scripts
  // were still loading and its event was emitted before this listener existed.
  if (mergeCommentHistory60(window.SHG_REMOTE_BOOTSTRAP?.tasks)) {
    writeTaskCache(state.tasks);
    renderChatUpdate60();
  }
  // Realtime is started by remote-sync only after historical comments have
  // established a safe high-water mark. Starting it here would replay all
  // historical comments through the fallback path on a cold load.
})();
