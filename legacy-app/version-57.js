/* MAILO Version 57 — Task access, dependable mobile layouts and direct Task Chat entry. */
(() => {
  const mobile57 = () => window.matchMedia('(max-width:850px)').matches;

  function taskAccessNames57(task) {
    if (!task) return [];
    return PEOPLE
      .filter(person => taskAccessReasons(task, person.name).length > 0)
      .map(person => person.name)
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  }

  function decorateTaskAccess57() {
    const summary = document.querySelector('#chatView .task-chat-summary');
    const task = state.tasks.find(item => item.id === window.MAILO_ACTIVE_CHAT);
    if (!summary || !task || summary.querySelector('.task-chat-access57')) return;
    const names = taskAccessNames57(task);
    const access = document.createElement('details');
    access.className = 'task-chat-access57';
    access.innerHTML = `<summary><small>Task Access</small><strong>${names.length} user${names.length === 1 ? '' : 's'} ▾</strong></summary><div>${names.map(name => `<span>${esc(name)}</span>`).join('') || '<span>No users</span>'}</div>`;
    summary.appendChild(access);
  }

  const previousRenderTaskChat57 = window.renderTaskChat;
  window.renderTaskChat = function version57RenderTaskChat() {
    previousRenderTaskChat57?.();
    decorateTaskAccess57();
    document.body.classList.toggle('mailo-chat-open57', state.appSection === 'chat');
  };

  const previousRender57 = render;
  render = function version57Render() {
    previousRender57();
    const tasksOpen = state.appSection === 'tasks';
    document.body.classList.toggle('mailo-tasks-open57', tasksOpen);
    document.body.classList.toggle('mailo-chat-open57', state.appSection === 'chat');
    if (state.appSection === 'chat') decorateTaskAccess57();
  };

  const sidebarToggle57 = document.getElementById('sidebarToggle');
  sidebarToggle57?.addEventListener('click', event => {
    if (!mobile57()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    document.body.classList.remove('sidebar-mobile-open');
  }, true);

  function openDirectTaskChat57() {
    const parameters = new URLSearchParams(location.search);
    if (parameters.get('view') !== 'chat') return;
    state.appSection = 'chat';
    state.project = 'all';
    window.MAILO_ACTIVE_CHAT = null;
    render();
  }

  document.querySelectorAll('[data-view="chat"]').forEach(button => button.addEventListener('click', () => {
    const url = new URL(location.href);
    url.searchParams.set('view', 'chat');
    history.replaceState({}, '', url);
  }));

  openDirectTaskChat57();
})();
