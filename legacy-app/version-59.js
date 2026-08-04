/* MAILO Version 59 — reliable Task Chat mentions and Victor-only Last Checked. */
(() => {
  const VICTOR = 'Victor Stavropoulos';
  const LAST_CHECK_CACHE_KEY = 'mailo-victor-last-checks-v59';
  const LAST_CHECK_COLUMN_WIDTH = 175;

  function authenticatedUser59() {
    return String(window.SHG_AUTH_USER_NAME || (typeof SESSION_USER !== 'undefined' ? SESSION_USER : '') || '').trim();
  }

  function isVictor59() {
    return authenticatedUser59() === VICTOR && CURRENT_USER === VICTOR;
  }

  function loadLastCheckCache59() {
    try {
      const value = JSON.parse(localStorage.getItem(LAST_CHECK_CACHE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function saveLastCheckCache59(value) {
    try { localStorage.setItem(LAST_CHECK_CACHE_KEY, JSON.stringify(value)); } catch {}
  }

  function validTime59(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function latestLastCheck59(task, cache = loadLastCheckCache59()) {
    const remote = task?.lastChecks?.[VICTOR] || '';
    const local = cache[task?.id] || '';
    return validTime59(local) > validTime59(remote) ? local : remote;
  }

  function mergeLastChecks59() {
    if (!isVictor59()) return false;
    const cache = loadLastCheckCache59();
    let changed = false;
    for (const task of state.tasks) {
      const latest = latestLastCheck59(task, cache);
      if (!latest || task.lastChecks?.[VICTOR] === latest) continue;
      task.lastChecks = { ...(task.lastChecks || {}), [VICTOR]: latest };
      changed = true;
    }
    return changed;
  }

  function ensureLastCheckedColumn59(unhide = false) {
    if (!isVictor59()) return;
    let changed = false;
    if (unhide && state.hiddenColumns.has('lastChecked')) {
      state.hiddenColumns.delete('lastChecked');
      changed = true;
    }
    if (!state.columnOrder.includes('lastChecked')) {
      state.columnOrder.push('lastChecked');
      changed = true;
    }
    if (!Number.isFinite(Number(state.columnWidths.lastChecked)) || Number(state.columnWidths.lastChecked) < 80) {
      state.columnWidths.lastChecked = LAST_CHECK_COLUMN_WIDTH;
      changed = true;
    }
    if (!changed) return;
    try {
      localStorage.setItem('shg-hidden-columns', JSON.stringify([...state.hiddenColumns]));
      localStorage.setItem('shg-column-order', JSON.stringify(state.columnOrder));
      localStorage.setItem('shg-column-widths', JSON.stringify(state.columnWidths));
    } catch {}
  }

  function recordLastCheck59(task) {
    if (!task || !isVictor59()) return '';
    const checkedAt = new Date().toISOString();
    const cache = loadLastCheckCache59();
    cache[task.id] = checkedAt;
    saveLastCheckCache59(cache);
    task.lastChecks = { ...(task.lastChecks || {}), [VICTOR]: checkedAt };
    return checkedAt;
  }

  ensureLastCheckedColumn59(true);
  mergeLastChecks59();

  const previousColumnVisible59 = isColumnVisible;
  isColumnVisible = function version59ColumnVisible(key) {
    if (key === 'lastChecked') return isVictor59() && !state.hiddenColumns.has('lastChecked');
    return previousColumnVisible59(key);
  };

  const previousRenderList59 = renderList;
  renderList = function version59RenderList() {
    ensureLastCheckedColumn59();
    mergeLastChecks59();
    return previousRenderList59();
  };

  const previousOpenTask59 = openTask;
  openTask = function version59OpenTask(id, preserveDirty = false) {
    const task = state.tasks.find(item => item.id === id);
    if (task && !preserveDirty && isVictor59()) {
      recordLastCheck59(task);
      save();
    }
    const result = previousOpenTask59(id, preserveDirty);
    if (task && !preserveDirty && isVictor59() && state.appSection === 'tasks') renderList();
    return result;
  };

  window.addEventListener('shg:remote-ready', () => {
    if (!isVictor59()) return;
    ensureLastCheckedColumn59();
    if (mergeLastChecks59()) save();
    if (state.appSection === 'tasks') renderList();
  });

  function chatMentionPeople59() {
    return [...PEOPLE].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  function closeChatMention59(form) {
    const menu = form?.querySelector('.task-chat-mention-menu59');
    if (menu) menu.replaceChildren();
  }

  function insertChatMention59(textarea, name) {
    const start = Number(textarea.dataset.mentionStart);
    if (!Number.isInteger(start) || start < 0) return;
    const caret = textarea.selectionStart;
    textarea.value = `${textarea.value.slice(0, start)}@${name} ${textarea.value.slice(caret)}`;
    const next = start + name.length + 2;
    textarea.setSelectionRange(next, next);
    textarea.focus();
    closeChatMention59(textarea.form);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function renderChatMentions59(textarea) {
    const form = textarea.form;
    const menu = form?.querySelector('.task-chat-mention-menu59');
    if (!menu) return;
    const before = textarea.value.slice(0, textarea.selectionStart);
    const at = before.lastIndexOf('@');
    if (at < 0 || /\n/.test(before.slice(at)) || before.length - at > 70) {
      closeChatMention59(form);
      return;
    }
    const prefix = at > 0 ? before[at - 1] : '';
    if (prefix && !/\s|[(\[{]/.test(prefix)) {
      closeChatMention59(form);
      return;
    }
    const query = before.slice(at + 1).trim().toLocaleLowerCase('el');
    const people = chatMentionPeople59().filter(person => !query || person.name.toLocaleLowerCase('el').includes(query));
    textarea.dataset.mentionStart = String(at);
    menu.replaceChildren();
    for (const [index, person] of people.entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = index === 0 ? 'mention-active' : '';
      button.innerHTML = `<i>${esc(person.initials || initials(person.name))}</i><span>${esc(person.name)}</span>`;
      button.addEventListener('mousedown', event => {
        event.preventDefault();
        insertChatMention59(textarea, person.name);
      });
      menu.appendChild(button);
    }
  }

  function handleChatMentionKey59(textarea, event) {
    const menu = textarea.form?.querySelector('.task-chat-mention-menu59');
    const buttons = [...(menu?.querySelectorAll('button') || [])];
    if (!buttons.length) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeChatMention59(textarea.form);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    const current = Math.max(0, buttons.findIndex(button => button.classList.contains('mention-active')));
    if (event.key === 'Enter') {
      insertChatMention59(textarea, buttons[current].querySelector('span')?.textContent || '');
      return;
    }
    buttons[current].classList.remove('mention-active');
    const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
    buttons[next].classList.add('mention-active');
    buttons[next].scrollIntoView({ block: 'nearest' });
  }

  function attachTaskChatMentions59() {
    const textarea = document.querySelector('#chatView .task-chat-composer textarea[name="message"]');
    const form = textarea?.form;
    if (!textarea || !form || textarea.dataset.mentions59 === 'true') return;
    textarea.dataset.mentions59 = 'true';
    const menu = document.createElement('div');
    menu.className = 'comment-mention-menu task-chat-mention-menu59';
    const composeRow = form.querySelector('.task-chat-compose-row');
    form.insertBefore(menu, composeRow || form.firstChild);
    textarea.addEventListener('input', () => renderChatMentions59(textarea));
    textarea.addEventListener('click', () => renderChatMentions59(textarea));
    textarea.addEventListener('keydown', event => handleChatMentionKey59(textarea, event));
    textarea.addEventListener('blur', () => setTimeout(() => closeChatMention59(form), 150));
  }

  const previousRenderTaskChat59 = window.renderTaskChat;
  window.renderTaskChat = function version59RenderTaskChat() {
    previousRenderTaskChat59?.();
    attachTaskChatMentions59();
  };

  const previousRender59 = render;
  render = function version59Render() {
    previousRender59();
    if (state.appSection === 'chat') attachTaskChatMentions59();
  };

  render();
})();
