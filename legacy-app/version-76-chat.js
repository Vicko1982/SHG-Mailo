/* MAILO Version 76 — dependable mobile search, Task Chat mentions and safe links. */
(() => {
  const CHAT_MENTION_SELECTOR = '.task-chat-mention-menu59,.task-chat-mention-menu63,.task-chat-mention-menu76';
  const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+/giu;
  const TRAILING_URL_PUNCTUATION = /[),.;:!?}\]]+$/u;

  function sortedMentionPeople76() {
    const unique = new Map();
    for (const person of typeof PEOPLE !== 'undefined' && Array.isArray(PEOPLE) ? PEOPLE : []) {
      const name = String(person?.name || '').trim();
      if (name && !unique.has(name.toLocaleLowerCase('el'))) unique.set(name.toLocaleLowerCase('el'), person);
    }
    return [...unique.values()].sort((left, right) => String(left.name).localeCompare(String(right.name), 'el', {
      sensitivity: 'base',
      numeric: true,
    }));
  }

  function safeExternalUrl76(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const candidate = /^www\./iu.test(raw) ? `https://${raw}` : raw;
    try {
      const parsed = new URL(candidate);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function linkifyTextNode76(textNode) {
    const text = textNode.nodeValue || '';
    URL_PATTERN.lastIndex = 0;
    if (!URL_PATTERN.test(text)) return;
    URL_PATTERN.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
      const matched = match[0];
      const trailing = matched.match(TRAILING_URL_PUNCTUATION)?.[0] || '';
      const visibleUrl = trailing ? matched.slice(0, -trailing.length) : matched;
      const href = safeExternalUrl76(visibleUrl);
      const index = Number(match.index) || 0;
      fragment.append(document.createTextNode(text.slice(cursor, index)));
      if (href) {
        const anchor = document.createElement('a');
        anchor.className = 'mailo-external-link76';
        anchor.href = href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer nofollow';
        anchor.textContent = visibleUrl;
        anchor.setAttribute('aria-label', `Open external link ${visibleUrl}`);
        fragment.append(anchor);
      } else {
        fragment.append(document.createTextNode(visibleUrl));
      }
      if (trailing) fragment.append(document.createTextNode(trailing));
      cursor = index + matched.length;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }

  function linkifyElement76(element) {
    if (!element || element.dataset.linkified76 === 'true') return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !URL_PATTERN.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        URL_PATTERN.lastIndex = 0;
        return node.parentElement?.closest('a,button,textarea,script,style,code,pre')
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(linkifyTextNode76);
    element.dataset.linkified76 = 'true';
  }

  function linkifyRenderedMessages76(root = document) {
    root.querySelectorAll(
      '.task-chat-bubble > p,.task-chat-quote span,#modalContent .comment-list article.comment > p,#modalContent .quoted-comment span',
    ).forEach(linkifyElement76);
  }

  function mentionContext76(textarea) {
    const caret = textarea.selectionStart ?? textarea.value.length;
    const before = textarea.value.slice(0, caret);
    const start = before.lastIndexOf('@');
    if (start < 0 || caret - start > 82) return null;
    const preceding = start > 0 ? before[start - 1] : '';
    if (preceding && !/[\s([{]/u.test(preceding)) return null;
    const query = before.slice(start + 1);
    if (/\n/u.test(query) || !/^[\p{L}\p{M}0-9 .'-]*$/u.test(query)) return null;
    return { start, caret, query: query.trim().toLocaleLowerCase('el') };
  }

  function closeMentionMenu76(textarea) {
    const menu = textarea?.form?.querySelector('.task-chat-mention-menu76');
    if (!menu) return;
    menu.replaceChildren();
    menu.hidden = true;
    textarea.removeAttribute('aria-activedescendant');
    textarea.setAttribute('aria-expanded', 'false');
  }

  function activeMentionButton76(menu) {
    const buttons = [...menu.querySelectorAll('button[role="option"]')];
    const index = Math.max(0, buttons.findIndex(button => button.classList.contains('mention-active')));
    return { buttons, index, button: buttons[index] || null };
  }

  function setActiveMention76(textarea, menu, nextIndex) {
    const buttons = [...menu.querySelectorAll('button[role="option"]')];
    if (!buttons.length) return;
    const resolved = (nextIndex + buttons.length) % buttons.length;
    buttons.forEach((button, index) => {
      const active = index === resolved;
      button.classList.toggle('mention-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    textarea.setAttribute('aria-activedescendant', buttons[resolved].id);
    buttons[resolved].scrollIntoView({ block: 'nearest' });
  }

  function insertMention76(textarea, name) {
    const start = Number(textarea.dataset.mentionStart76);
    const caret = textarea.selectionStart ?? textarea.value.length;
    if (!Number.isInteger(start) || start < 0 || start > caret) return;
    const replacement = `@${name} `;
    textarea.setRangeText(replacement, start, caret, 'end');
    closeMentionMenu76(textarea);
    textarea.focus({ preventScroll: true });
  }

  function renderMentionMenu76(textarea) {
    const menu = textarea.form?.querySelector('.task-chat-mention-menu76');
    if (!menu) return;
    const context = mentionContext76(textarea);
    if (!context) {
      closeMentionMenu76(textarea);
      return;
    }
    const people = sortedMentionPeople76().filter(person => {
      const name = String(person.name).toLocaleLowerCase('el');
      return !context.query || name.includes(context.query);
    });
    if (!people.length) {
      closeMentionMenu76(textarea);
      return;
    }
    textarea.dataset.mentionStart76 = String(context.start);
    menu.replaceChildren();
    people.forEach((person, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `task-chat-mention76-${index}`;
      button.setAttribute('role', 'option');
      button.className = index === 0 ? 'mention-active' : '';
      button.setAttribute('aria-selected', String(index === 0));

      const avatar = document.createElement('i');
      avatar.textContent = String(person.initials || (typeof initials === 'function' ? initials(person.name) : ''));
      const label = document.createElement('span');
      label.textContent = person.name;
      button.append(avatar, label);
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        insertMention76(textarea, person.name);
      });
      menu.append(button);
    });
    menu.hidden = false;
    textarea.setAttribute('aria-expanded', 'true');
    textarea.setAttribute('aria-activedescendant', 'task-chat-mention76-0');
  }

  function handleMentionKey76(textarea, event) {
    const menu = textarea.form?.querySelector('.task-chat-mention-menu76');
    if (!menu || menu.hidden) return;
    const { buttons, index, button } = activeMentionButton76(menu);
    if (!buttons.length) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMentionMenu76(textarea);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveMention76(textarea, menu, event.key === 'ArrowDown' ? index + 1 : index - 1);
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && button) {
      event.preventDefault();
      insertMention76(textarea, button.querySelector('span')?.textContent || '');
    }
  }

  function attachTaskChatMentions76() {
    const textarea = document.querySelector('#chatView .task-chat-composer textarea[name="message"]');
    const form = textarea?.form;
    if (!textarea || !form) return;

    if (textarea.dataset.mentions76Attached === 'true') {
      renderMentionMenu76(textarea);
      return;
    }

    form.querySelectorAll(CHAT_MENTION_SELECTOR).forEach(menu => menu.remove());
    // Version 63 used property handlers. Clearing them prevents its second,
    // visually conflicting suggestion list while Version 59 safely no-ops
    // because its menu has been removed.
    textarea.oninput = null;
    textarea.onkeyup = null;
    textarea.onclick = null;

    const menu = document.createElement('div');
    menu.className = 'comment-mention-menu task-chat-mention-menu76';
    menu.id = 'task-chat-mention-list76';
    menu.role = 'listbox';
    menu.hidden = true;
    const composeRow = form.querySelector('.task-chat-compose-row');
    form.insertBefore(menu, composeRow || form.firstChild);

    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('aria-autocomplete', 'list');
    textarea.setAttribute('aria-controls', menu.id);
    textarea.setAttribute('aria-expanded', 'false');
    textarea.dataset.mentions76Attached = 'true';
    textarea.addEventListener('input', () => renderMentionMenu76(textarea));
    textarea.addEventListener('click', () => renderMentionMenu76(textarea));
    textarea.addEventListener('keydown', event => handleMentionKey76(textarea, event));
    textarea.addEventListener('blur', () => window.setTimeout(() => closeMentionMenu76(textarea), 160));
  }

  function filterTaskChatThreads76(value) {
    const query = String(value || '').trim().toLocaleLowerCase('el');
    const container = document.querySelector('#chatView .task-chat-threads');
    if (!container) return;
    let visible = 0;
    container.querySelectorAll('.task-chat-thread').forEach(thread => {
      const matches = !query || thread.textContent.toLocaleLowerCase('el').includes(query);
      thread.hidden = !matches;
      if (matches) visible += 1;
    });
    let empty = container.querySelector('.task-chat-search-empty76');
    if (!empty) {
      empty = document.createElement('p');
      empty.className = 'task-chat-empty task-chat-search-empty76';
      empty.textContent = 'No Task Chats match this search.';
      container.append(empty);
    }
    empty.hidden = visible > 0;
  }

  function attachTaskChatSearch76(query, restoreFocus = false, selection = null) {
    const input = document.querySelector('#chatView .task-chat-search input');
    if (!input) return;
    input.removeAttribute('oninput');
    input.value = query;
    input.type = 'search';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Search Task Chats');
    if (input.dataset.search76Attached !== 'true') {
      input.dataset.search76Attached = 'true';
      input.addEventListener('input', event => {
        window.MAILO_CHAT_QUERY = event.currentTarget.value;
        filterTaskChatThreads76(event.currentTarget.value);
      });
    }
    filterTaskChatThreads76(query);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        input.focus({ preventScroll: true });
        const start = Math.min(selection?.start ?? input.value.length, input.value.length);
        const end = Math.min(selection?.end ?? start, input.value.length);
        input.setSelectionRange(start, end);
      });
    }
  }

  function decorateTaskSearch76() {
    const input = document.getElementById('searchInput');
    if (!input) return;
    input.type = 'search';
    input.autocomplete = 'off';
    input.enterKeyHint = 'search';
    input.setAttribute('aria-label', 'Search Tasks');
  }

  const previousRenderTaskChat76 = window.renderTaskChat;
  window.renderTaskChat = function version76RenderTaskChat(...args) {
    const requestedActiveTask = state.tasks.find(task => task.id === window.MAILO_ACTIVE_CHAT);
    if (window.MAILO_ACTIVE_CHAT && (!requestedActiveTask || isTaskDeleted(requestedActiveTask) || !canCurrentUserAccessTask(requestedActiveTask))) {
      window.MAILO_ACTIVE_CHAT = null;
    }
    const currentSearch = document.querySelector('#chatView .task-chat-search input');
    const restoreFocus = document.activeElement === currentSearch;
    const selection = currentSearch ? { start: currentSearch.selectionStart, end: currentSearch.selectionEnd } : null;
    const query = String(window.MAILO_CHAT_QUERY || '');
    // The legacy renderer filters its source before producing the DOM. Render
    // the complete current view once, then filter existing rows in place so
    // typing never removes/recreates the focused mobile search input.
    window.MAILO_CHAT_QUERY = '';
    let result;
    try {
      result = previousRenderTaskChat76?.apply(this, args);
    } finally {
      window.MAILO_CHAT_QUERY = query;
    }
    attachTaskChatSearch76(query, restoreFocus, selection);
    attachTaskChatMentions76();
    linkifyRenderedMessages76(document.getElementById('chatView') || document);
    return result;
  };

  const previousOpenTaskChat76 = window.openTaskChat;
  window.openTaskChat = function version76OpenTaskChat(taskId, ...args) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || isTaskDeleted(task) || !canCurrentUserAccessTask(task)) {
      window.MAILO_ACTIVE_CHAT = null;
      window.renderTaskChat?.();
      toast('This Task Chat is not available to your account');
      return false;
    }
    return previousOpenTaskChat76?.call(this, taskId, ...args);
  };

  const previousOpenTask76 = openTask;
  openTask = function version76OpenTask(...args) {
    const task = state.tasks.find(item => item.id === String(args[0] || ''));
    if (!task || isTaskDeleted(task) || !canCurrentUserAccessTask(task)) {
      closeModal(true);
      toast('This Task does not exist or you do not have access to it');
      return false;
    }
    const result = previousOpenTask76.apply(this, args);
    linkifyRenderedMessages76(document.getElementById('modalContent') || document);
    return result;
  };

  const previousRender76 = render;
  render = function version76Render(...args) {
    const result = previousRender76.apply(this, args);
    decorateTaskSearch76();
    if (state.appSection === 'chat') {
      const query = String(window.MAILO_CHAT_QUERY || '');
      attachTaskChatSearch76(query);
      attachTaskChatMentions76();
      linkifyRenderedMessages76(document.getElementById('chatView') || document);
    }
    return result;
  };

  window.MAILO_VERSION_76_CHAT = Object.freeze({
    safeExternalUrl: safeExternalUrl76,
    linkifyRenderedMessages: linkifyRenderedMessages76,
  });

  decorateTaskSearch76();
  if (state.appSection === 'chat') {
    const query = String(window.MAILO_CHAT_QUERY || '');
    attachTaskChatSearch76(query);
    attachTaskChatMentions76();
    linkifyRenderedMessages76(document.getElementById('chatView') || document);
  }
})();
