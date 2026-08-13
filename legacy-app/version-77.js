/* MAILO Version 77 — identity-safe Weekly Tasks and readable Task Chat mentions. */
(() => {
  'use strict';

  const VICTOR_77 = 'Victor Stavropoulos';

  function applyVersion77() {
    document.querySelectorAll('#versionBadge,.version-badge').forEach(node => {
      node.textContent = 'Version 77';
    });
  }

  function authenticatedName77() {
    return String(
      window.SHG_AUTH_USER_NAME
      || (typeof SESSION_USER !== 'undefined' ? SESSION_USER : '')
      || '',
    ).trim();
  }

  function roleFor77(name) {
    if (name === VICTOR_77) return 'main_admin';
    const remoteRole = window.SHG_REMOTE_BOOTSTRAP?.roleByName?.[name];
    if (remoteRole) return remoteRole;
    if ((window.SHG_REMOTE_BOOTSTRAP?.mainAdminNames || []).includes(name)) return 'main_admin';
    return 'user';
  }

  function isAuthenticatedMainAdmin77() {
    const authenticated = authenticatedName77();
    return Boolean(authenticated) && roleFor77(authenticated) === 'main_admin';
  }

  function viewedUser77() {
    return String(typeof CURRENT_USER !== 'undefined' ? CURRENT_USER : '').trim();
  }

  function canAddWeeklyForViewedUser77() {
    const authenticated = authenticatedName77();
    const viewed = viewedUser77();
    return Boolean(authenticated && viewed)
      && (isAuthenticatedMainAdmin77() || authenticated === viewed);
  }

  function canRemoveWeeklyForViewedUser77() {
    return isAuthenticatedMainAdmin77() && Boolean(viewedUser77());
  }

  function monday77(value = new Date()) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    return date;
  }

  function weekKey77(value = new Date()) {
    return monday77(value).toISOString().slice(0, 10);
  }

  function selectedWeeklyTasks77({ assignedOnly = false } = {}) {
    const viewed = viewedUser77();
    return (state.tasks || []).filter(task =>
      state.selectedTasks?.has(task.id)
      && task.status !== 'done'
      && (!assignedOnly || Boolean(task.weeklyAssignments?.[viewed]))
      && (typeof canCurrentUserAccessTask !== 'function' || canCurrentUserAccessTask(task))
    );
  }

  function assignSelectedWeekly77() {
    if (!canAddWeeklyForViewedUser77()) {
      toast('You can add Tasks only to your own Weekly Tasks');
      return;
    }
    const selected = selectedWeeklyTasks77();
    if (!selected.length) {
      toast('Select at least one active Task first');
      return;
    }
    const viewed = viewedUser77();
    const actor = authenticatedName77();
    const changedAt = new Date().toISOString();
    const weekStart = weekKey77(changedAt);
    let changed = 0;
    for (const task of selected) {
      if (task.weeklyAssignments?.[viewed]) continue;
      task.weeklyAssignments = {
        ...(task.weeklyAssignments || {}),
        [viewed]: { weekStart, assignedAt: changedAt, assignedBy: actor },
      };
      task.audit = Array.isArray(task.audit) ? task.audit : [];
      task.audit.unshift(`Added to ${viewed}'s Weekly Tasks by ${actor}`);
      task.updated = changedAt;
      changed += 1;
    }
    state.selectedTasks.clear();
    if (!changed) {
      render();
      toast('The selected Tasks are already in this Weekly list');
      return;
    }
    save();
    render();
    toast(`${changed} Task${changed === 1 ? '' : 's'} added to ${viewed}'s Weekly Tasks`);
  }

  function removeSelectedWeekly77() {
    if (!canRemoveWeeklyForViewedUser77()) {
      toast('Only an authenticated Main Admin can remove Weekly Tasks manually');
      return;
    }
    const viewed = viewedUser77();
    const actor = authenticatedName77();
    const selected = selectedWeeklyTasks77({ assignedOnly: true });
    if (!selected.length) {
      toast('Select Weekly Tasks to remove');
      return;
    }
    const changedAt = new Date().toISOString();
    for (const task of selected) {
      const assignments = { ...(task.weeklyAssignments || {}) };
      delete assignments[viewed];
      task.weeklyAssignments = assignments;
      task.audit = Array.isArray(task.audit) ? task.audit : [];
      task.audit.unshift(`Removed from ${viewed}'s Weekly Tasks by ${actor}`);
      task.updated = changedAt;
    }
    state.selectedTasks.clear();
    save();
    render();
    toast(`${selected.length} Task${selected.length === 1 ? '' : 's'} removed from ${viewed}'s Weekly Tasks`);
  }

  // Existing Version 64 buttons keep their markup, but now call the identity-
  // safe rules above. A View As session changes only the target user; it never
  // changes the authenticated actor or grants a standard user removal rights.
  window.addSelectedWeekly64 = assignSelectedWeekly77;
  window.removeSelectedWeekly64 = removeSelectedWeekly77;
  window.addSelectedWeekly77 = assignSelectedWeekly77;
  window.removeSelectedWeekly77 = removeSelectedWeekly77;

  function pruneDoneWeeklyAssignments77() {
    const changedAt = new Date().toISOString();
    let changed = false;
    for (const task of state.tasks || []) {
      if (task.status !== 'done' || !Object.keys(task.weeklyAssignments || {}).length) continue;
      const removedUsers = Object.keys(task.weeklyAssignments);
      task.weeklyAssignments = {};
      task.audit = Array.isArray(task.audit) ? task.audit : [];
      task.audit.unshift(`Completed Task automatically removed from Weekly Tasks for ${removedUsers.join(', ')}`);
      task.updated = changedAt;
      changed = true;
    }
    return changed;
  }

  const previousSave77 = save;
  save = function version77Save(...args) {
    pruneDoneWeeklyAssignments77();
    return previousSave77.apply(this, args);
  };

  const previousListSourceRows77 = listSourceRows;
  listSourceRows = function version77ListSourceRows(...args) {
    const rows = previousListSourceRows77.apply(this, args);
    if (!state.weeklyMode64) return rows;
    // Done Tasks leave Weekly immediately, even when Include Done is enabled.
    return rows.filter(row => state.tasks.find(task => task.id === row.id)?.status !== 'done');
  };

  const previousSavedFilterControls77 = savedFilterControls;
  savedFilterControls = function version77SavedFilterControls(...args) {
    const controls = previousSavedFilterControls77.apply(this, args);
    if (isAuthenticatedMainAdmin77() || authenticatedName77() !== viewedUser77()) return controls;
    return `${controls}<button type="button" class="weekly-add-own77" onclick="addSelectedWeekly77()">Add selected to My Weekly Tasks</button>`;
  };

  function updateWeeklyUI77() {
    const weeklyButton = document.getElementById('weeklyTasksTab64');
    if (weeklyButton) {
      weeklyButton.textContent = `Weekly Tasks · ${viewedUser77()}`;
      weeklyButton.title = isAuthenticatedMainAdmin77()
        ? `View and manage ${viewedUser77()}'s Weekly Tasks`
        : 'View your Weekly Tasks';
    }
    document.querySelectorAll('[onclick="removeSelectedWeekly64()"]')
      .forEach(button => { button.hidden = !canRemoveWeeklyForViewedUser77(); });
  }

  const previousRender77 = render;
  render = function version77Render(...args) {
    const result = previousRender77.apply(this, args);
    applyVersion77();
    updateWeeklyUI77();
    attachTaskChatMentionPresentation77();
    return result;
  };

  function mentionInitials77(name) {
    if (typeof initials === 'function') return initials(name);
    return String(name || '').split(/\s+/u).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  }

  function decorateTaskChatMentionMenu77(menu) {
    if (!menu) return;
    menu.classList.add('task-chat-mention-menu77');
    menu.querySelectorAll('button').forEach(button => {
      const label = button.querySelector('span');
      const name = String(label?.textContent || button.dataset.name || '').trim();
      if (!name) return;
      let avatar = button.querySelector('i');
      if (!avatar) {
        avatar = document.createElement('i');
        button.prepend(avatar);
      }
      const avatarText = mentionInitials77(name);
      if (avatar.textContent !== avatarText) avatar.textContent = avatarText;
      avatar.setAttribute('aria-hidden', 'true');
      if (!label) {
        const createdLabel = document.createElement('span');
        createdLabel.textContent = name;
        button.append(createdLabel);
      }
      button.dataset.fullName77 = name;
      button.setAttribute('aria-label', `Mention ${name}`);
      button.title = name;
    });
  }

  function attachTaskChatMentionPresentation77() {
    const menu = document.querySelector('#chatView .task-chat-mention-menu76');
    if (!menu) return;
    decorateTaskChatMentionMenu77(menu);
    if (menu.dataset.presentation77Attached === 'true') return;
    menu.dataset.presentation77Attached = 'true';
    const observer = new MutationObserver(() => decorateTaskChatMentionMenu77(menu));
    observer.observe(menu, { childList: true });
  }

  const previousRenderTaskChat77 = window.renderTaskChat;
  window.renderTaskChat = function version77RenderTaskChat(...args) {
    const result = previousRenderTaskChat77?.apply(this, args);
    attachTaskChatMentionPresentation77();
    return result;
  };

  function synchroniseCompletedWeekly77() {
    if (!pruneDoneWeeklyAssignments77()) return;
    previousSave77.call(this);
    if (state.appSection === 'tasks') render();
  }

  function showMaintenance77(enabled, message) {
    let overlay = document.getElementById('mailoMaintenance77');
    if (!enabled) {
      overlay?.remove();
      document.documentElement.classList.remove('mailo-maintenance-active77');
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mailoMaintenance77';
      overlay.className = 'mailo-maintenance-overlay77';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
        <section>
          <strong class="mailo-maintenance-mark77">M</strong>
          <small>MAILO SYSTEM UPDATE</small>
          <h2>Γίνεται αναβάθμιση</h2>
          <p></p>
          <div aria-hidden="true"><i></i><i></i><i></i></div>
        </section>`;
      document.body.append(overlay);
    }
    overlay.querySelector('p').textContent = message
      || 'Το MAILO είναι προσωρινά κλειδωμένο. Δοκιμάστε ξανά σε λίγα λεπτά.';
    document.documentElement.classList.add('mailo-maintenance-active77');
  }

  async function checkMaintenance77() {
    const activeSession = window.shgGetSupabaseSession?.();
    if (!activeSession?.access_token || !window.SHG_SUPABASE_URL || !window.SHG_SUPABASE_KEY) return;
    try {
      const response = await fetch(
        `${window.SHG_SUPABASE_URL}/rest/v1/app_settings?select=maintenance_mode,maintenance_message&id=eq.true&limit=1`,
        {
          cache: 'no-store',
          headers: {
            apikey: window.SHG_SUPABASE_KEY,
            Authorization: `Bearer ${activeSession.access_token}`,
          },
        },
      );
      if (!response.ok) return;
      const settings = (await response.json())?.[0];
      showMaintenance77(Boolean(settings?.maintenance_mode), settings?.maintenance_message);
    } catch (error) {
      console.warn('MAILO maintenance status could not be checked', error);
    }
  }

  window.MAILO_VERSION_77 = Object.freeze({
    authenticatedName: authenticatedName77,
    isAuthenticatedMainAdmin: isAuthenticatedMainAdmin77,
    canAddWeeklyForViewedUser: canAddWeeklyForViewedUser77,
    canRemoveWeeklyForViewedUser: canRemoveWeeklyForViewedUser77,
  });

  synchroniseCompletedWeekly77();
  applyVersion77();
  updateWeeklyUI77();
  attachTaskChatMentionPresentation77();
  window.addEventListener('shg:remote-ready', synchroniseCompletedWeekly77);
  window.addEventListener('shg:remote-ready', checkMaintenance77);
  checkMaintenance77();
  window.setInterval(checkMaintenance77, 12000);
})();
