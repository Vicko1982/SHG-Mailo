/* MAILO Version 79 — durable personal read state and database-first Tasks. */
(() => {
  'use strict';

  let readOnlyOpenDepth79 = 0;
  const previousSave79 = save;
  save = function version79Save(...args) {
    if (readOnlyOpenDepth79 > 0) {
      writeTaskCache(state.tasks);
      return;
    }
    return previousSave79.apply(this, args);
  };

  const previousOpenTask79 = openTask;
  openTask = function version79OpenTask(id, preserveDirty = false) {
    const task = state.tasks.find(item => item.id === id);
    readOnlyOpenDepth79 += 1;
    let result;
    try {
      result = previousOpenTask79.call(this, id, preserveDirty);
    } finally {
      readOnlyOpenDepth79 -= 1;
    }
    if (task && !preserveDirty && isMainAdmin()) {
      const checkedAt = task.lastChecks?.[CURRENT_USER] || new Date().toISOString();
      task.lastChecks = { [CURRENT_USER]: checkedAt };
      window.shgRecordTaskLastCheck?.(task, checkedAt)?.catch(error => console.warn('Last Checked could not be saved', error));
      if (state.appSection === 'tasks') renderList();
    }
    return result;
  };

  const previousOpenTaskChat79 = window.openTaskChat;
  window.openTaskChat = function version79OpenTaskChat(id, ...args) {
    const task = state.tasks.find(item => item.id === id);
    readOnlyOpenDepth79 += 1;
    let result;
    try {
      result = previousOpenTaskChat79?.call(this, id, ...args);
    } finally {
      readOnlyOpenDepth79 -= 1;
    }
    if (task) {
      const newest = Math.max(Date.now(), ...(task.comments || []).map(comment => new Date(comment.createdAt || 0).getTime() || 0));
      const readAt = new Date(newest).toISOString();
      task.chatReadBy = { [CURRENT_USER]: readAt };
      window.shgRecordTaskChatRead?.(task, readAt)?.catch(error => console.warn('Task Chat read state could not be saved', error));
      window.renderTaskChat?.();
    }
    return result;
  };

  window.addEventListener('shg:remote-rollback', event => {
    const count = Number(event.detail?.count || 1);
    toast(`${count} change${count === 1 ? '' : 's'} could not be saved and ${count === 1 ? 'was' : 'were'} restored from the shared database`);
  });

  function applyVersion79() {
    document.querySelectorAll('#versionBadge,.version-badge').forEach(node => {
      node.textContent = 'Version 79';
    });
  }

  const previousRender79 = render;
  render = function version79Render(...args) {
    const result = previousRender79.apply(this, args);
    applyVersion79();
    return result;
  };

  applyVersion79();
})();
