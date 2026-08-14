/* MAILO Version 76 — audit detail, comment ownership, transcription and identity-safe administration. */
(() => {
  'use strict';

  const VICTOR76 = 'Victor Stavropoulos';
  const trackedFields76 = [
    ['title', 'Title'],
    ['description', 'Description'],
    ['creator', 'Creator'],
    ['assignee', 'Assignee'],
    ['supervisor', 'Supervisor'],
    ['approver', 'Approver'],
    ['project', 'Space'],
    ['priority', 'Priority'],
    ['dueDate', 'Due Date'],
    ['targetStartDate', 'Target Start Date'],
    ['unblockingDate', 'Unblocking Date'],
    ['status', 'Status'],
    ['labels', 'Labels'],
    ['parent', 'Parent Task'],
    ['issueType', 'Task Type'],
    ['isMiniTask', 'Mini Task'],
    ['disableMainAdminReminders', 'Automatic Reminders'],
    ['recurringFrequency', 'Recurrence'],
    ['scheduledFor', 'Scheduled Creation'],
    ['scheduledComments', 'Scheduled Comments'],
    ['weeklyAssignments', 'Weekly Tasks'],
    ['progressLog', 'Progress Log'],
    ['personalOwner', 'Personal Owner'],
    ['personalAccessLocked', 'Personal Access Lock'],
    ['accessRevocations', 'Task Access'],
    ['archivedAt', 'Archived At'],
    ['archivedBy', 'Archived By'],
    ['cancellationReason', 'Cancellation Reason'],
    ['blockedReason', 'Blocked Reason'],
  ];

  const authenticatedName76 = () => String(
    window.SHG_AUTH_USER_NAME
    || (typeof SESSION_USER !== 'undefined' ? SESSION_USER : '')
    || '',
  ).trim();

  function roleFor76(name) {
    if (name === VICTOR76) return 'main_admin';
    const remoteRole = window.SHG_REMOTE_BOOTSTRAP?.roleByName?.[name];
    if (remoteRole) return remoteRole;
    if ((window.SHG_REMOTE_BOOTSTRAP?.mainAdminNames || []).includes(name)) return 'main_admin';
    return state.admins?.has(name) ? 'admin' : 'user';
  }

  const isAuthenticated76 = () => Boolean(authenticatedName76());
  const isAuthenticatedVictor76 = () => authenticatedName76() === VICTOR76;
  const isAuthenticatedMainAdmin76 = () => roleFor76(authenticatedName76()) === 'main_admin';
  const isViewingOwnIdentity76 = () => authenticatedName76() === String(CURRENT_USER || '').trim();
  const canManagePermissions76 = () => isAuthenticatedVictor76() && isViewingOwnIdentity76();
  const actorRole76 = () => {
    const role = roleFor76(authenticatedName76());
    return role === 'main_admin' ? 'Main Admin' : role === 'admin' ? 'Admin' : 'User';
  };

  /* Detailed Activity Log ------------------------------------------------- */

  const snapshots76 = new Map();
  let addingAudit76 = false;

  function commentKey76(comment, index = 0) {
    return String(comment?._supabaseId || comment?.id || `${comment?.createdAt || 'comment'}-${index}`);
  }

  function commentSnapshot76(comment, index) {
    return {
      key: commentKey76(comment, index),
      author: String(comment?.author || 'Unknown user'),
      text: String(comment?.text || ''),
      createdAt: comment?.createdAt || null,
      editedAt: comment?.editedAt || null,
      system: comment?.system === true,
      images: Array.isArray(comment?.images) ? comment.images.length : 0,
      attachments: Array.isArray(comment?.attachments)
        ? comment.attachments.map(item => String(item?.name || 'Attachment'))
        : [],
      audio: Boolean(comment?.audioMessage),
    };
  }

  function taskSnapshot76(task) {
    const fields = {};
    for (const [key] of trackedFields76) {
      const value = task?.[key];
      try { fields[key] = value == null ? null : structuredClone(value); }
      catch { fields[key] = value == null ? null : JSON.parse(JSON.stringify(value)); }
    }
    return {
      id: String(task?.id || ''),
      title: String(task?.title || ''),
      fields,
      comments: (task?.comments || []).map(commentSnapshot76),
    };
  }

  function refreshSnapshots76() {
    const live = new Set(state.tasks || []);
    for (const task of live) snapshots76.set(task, taskSnapshot76(task));
    for (const task of snapshots76.keys()) if (!live.has(task)) snapshots76.delete(task);
  }

  function equalValue76(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }

  function readableValue76(field, value) {
    if (value === null || value === undefined || value === '') return 'None';
    if (field === 'disableMainAdminReminders') return value ? 'Disabled' : 'Enabled';
    if (field === 'project') return PROJECTS?.[value]?.name || String(value);
    if (field === 'status') return STATUSES?.find(item => item.id === value)?.label || String(value);
    if (Array.isArray(value)) {
      if (!value.length) return 'None';
      return value.some(item => item && typeof item === 'object') ? JSON.stringify(value) : value.join(', ');
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function activityEntry76(task, field, label, oldValue, newValue, at) {
    const actor = authenticatedName76() || String(CURRENT_USER || 'Unknown user');
    const oldText = readableValue76(field, oldValue);
    const newText = readableValue76(field, newValue);
    const action = `${label} changed from “${oldText}” to “${newText}” by ${actor}`;
    const entry = {
      id: `activity-v76-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at,
      user: actor,
      actor,
      role: actorRole76(),
      action,
      taskId: task.id,
      taskTitle: task.title || '',
      field,
      oldValue,
      newValue,
      version: 76,
    };
    task.audit = Array.isArray(task.audit) ? task.audit : [];
    task.auditDetails = Array.isArray(task.auditDetails) ? task.auditDetails : [];
    task.audit.unshift(action);
    task.auditDetails.unshift({ ...entry });
    state.activityLog.unshift(entry);
    return entry;
  }

  function commentSummary76(comment) {
    const text = String(comment?.text || '');
    if (text) return text;
    if (comment?.audio) return '[Voice message]';
    if (comment?.attachments?.length) return `[Files: ${comment.attachments.join(', ')}]`;
    if (comment?.images) return `[${comment.images} image${comment.images === 1 ? '' : 's'}]`;
    return '[Empty comment]';
  }

  function auditComments76(task, before, after, at) {
    const oldByKey = new Map((before || []).filter(item => !item.system).map(item => [item.key, item]));
    const newByKey = new Map((after || []).filter(item => !item.system).map(item => [item.key, item]));
    let count = 0;
    for (const [key, next] of newByKey) {
      const previous = oldByKey.get(key);
      if (!previous) {
        activityEntry76(task, 'comments', 'Comment', 'None', `${next.author}: ${commentSummary76(next)}`, at);
        count += 1;
        continue;
      }
      const previousContent = {
        text: previous.text,
        images: previous.images,
        attachments: previous.attachments,
        audio: previous.audio,
      };
      const nextContent = {
        text: next.text,
        images: next.images,
        attachments: next.attachments,
        audio: next.audio,
      };
      if (!equalValue76(previousContent, nextContent)) {
        activityEntry76(
          task,
          'comments',
          `Comment by ${previous.author}`,
          commentSummary76(previous),
          commentSummary76(next),
          at,
        );
        count += 1;
      }
    }
    for (const [key, previous] of oldByKey) {
      if (newByKey.has(key)) continue;
      activityEntry76(task, 'comments', `Comment by ${previous.author}`, commentSummary76(previous), 'Deleted', at);
      count += 1;
    }
    return count;
  }

  function collectDetailedActivity76() {
    if (addingAudit76) return 0;
    addingAudit76 = true;
    let count = 0;
    const at = new Date().toISOString();
    try {
      for (const task of state.tasks || []) {
        const previous = snapshots76.get(task);
        const next = taskSnapshot76(task);
        if (!previous) {
          activityEntry76(task, 'task', 'Task', 'None', `${task.id} — ${task.title || ''}`, at);
          count += 1;
          continue;
        }
        for (const [field, label] of trackedFields76) {
          const oldValue = previous.fields[field];
          const newValue = next.fields[field];
          if (equalValue76(oldValue, newValue)) continue;
          activityEntry76(task, field, label, oldValue, newValue, at);
          count += 1;
        }
        if (previous.id !== next.id) {
          activityEntry76(task, 'taskKey', 'Task Code', previous.id, next.id, at);
          count += 1;
        }
        count += auditComments76(task, previous.comments, next.comments, at);
        if (count && typeof activityAuditHeads !== 'undefined') {
          activityAuditHeads.set(task.id, task.audit?.[0] || '');
        }
      }
      if (count) {
        state.activityLog = state.activityLog.slice(0, 5000);
        persistActivityFallback(state.activityLog);
      }
      return count;
    } finally {
      addingAudit76 = false;
    }
  }

  const priorLogActivity76 = logActivity;
  logActivity = function version76LogActivity(action, task = null) {
    const actor = authenticatedName76() || String(CURRENT_USER || 'Unknown user');
    const entry = {
      id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      user: actor,
      actor,
      role: actorRole76(),
      action: String(action),
      taskId: task?.id || '',
      taskTitle: task?.title || '',
      version: 76,
    };
    state.activityLog.unshift(entry);
    state.activityLog = state.activityLog.slice(0, 5000);
    persistActivityFallback(state.activityLog);
    return entry;
  };

  const priorSave76 = save;
  save = function version76Save(...args) {
    const detailed = collectDetailedActivity76();
    if (detailed && typeof activityAuditHeads !== 'undefined') {
      for (const task of state.tasks || []) activityAuditHeads.set(task.id, task.audit?.[0] || '');
    }
    const result = priorSave76.apply(this, args);
    refreshSnapshots76();
    return result;
  };

  /* Comment editing ------------------------------------------------------- */

  function canEditComment76(comment) {
    if (!comment || comment.system === true || !isAuthenticated76()) return false;
    return isAuthenticatedVictor76() || String(comment.author || '').trim() === authenticatedName76();
  }

  function locateComment76(taskId, commentId) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return {};
    const inOpenDraft = taskDetailsDraft?.id === taskId;
    const source = inOpenDraft ? taskDetailsDraft.comments || [] : task.comments || [];
    const comment = source.find(item => String(item.id) === String(commentId));
    return { task, source, comment, inOpenDraft };
  }

  window.editTaskComment76 = async (taskId, commentId) => {
    const { task, comment, inOpenDraft } = locateComment76(taskId, commentId);
    if (!comment) { toast('Comment not found'); return; }
    if (!canEditComment76(comment)) { toast('You can edit only your own comments'); return; }
    const typed = prompt('Edit comment:', comment.text || '');
    if (typed === null) return;
    const nextText = String(typed).trim();
    const hasOtherContent = Boolean(comment.audioMessage || comment.images?.length || comment.attachments?.length);
    if (!nextText && !hasOtherContent) { toast('A comment cannot be empty'); return; }
    if (nextText === String(comment.text || '')) return;

    const previous = {
      text: comment.text || '',
      editedAt: comment.editedAt,
      editedBy: comment.editedBy,
    };
    const changedAt = new Date().toISOString();
    comment.text = nextText;
    comment.editedAt = changedAt;
    comment.editedBy = authenticatedName76();

    if (inOpenDraft) {
      markTaskDetailsDirty(taskId);
      openTask(taskId, true);
      toast('Comment edited. Press Submit to save.');
      return;
    }

    task.updated = changedAt;
    try {
      await window.shgSaveCommentImmediately?.(task, comment);
      save();
      window.renderTaskChat?.();
      toast('Comment edited');
    } catch (error) {
      comment.text = previous.text;
      comment.editedAt = previous.editedAt;
      comment.editedBy = previous.editedBy;
      window.renderTaskChat?.();
      toast(error?.message || 'The comment could not be updated');
    }
  };

  // Existing Version 62 buttons keep working, but now use ownership rules.
  window.editTaskComment62 = window.editTaskComment76;

  function addEditButton76(container, taskId, comment) {
    if (!container || !canEditComment76(comment)) return;
    const existing = container.querySelector('.edit-comment62,.edit-comment76');
    if (existing) {
      existing.removeAttribute('onclick');
      existing.onclick = () => window.editTaskComment76(taskId, comment.id);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'edit-comment62 edit-comment76';
    button.textContent = 'Edit';
    button.onclick = () => window.editTaskComment76(taskId, comment.id);
    container.appendChild(button);
  }

  function decorateTaskCommentEditing76(taskId) {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    const source = taskDetailsDraft?.id === taskId ? taskDetailsDraft.comments || [] : task.comments || [];
    const commentsById = new Map(source.map(comment => [String(comment.id || ''), comment]));
    document.querySelectorAll('#modalContent .comment-list article.comment').forEach(article => {
      const comment = commentsById.get(String(article.dataset.commentId || ''));
      if (!comment) return;
      addEditButton76(article.querySelector('.comment-meta'), taskId, comment);
    });
  }

  function decorateChatCommentEditing76() {
    const taskId = String(window.MAILO_ACTIVE_CHAT || '');
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) return;
    const commentsById = new Map((task.comments || []).map(comment => [String(comment.id || ''), comment]));
    document.querySelectorAll('#taskChatMessages article.task-chat-message').forEach(article => {
      const comment = commentsById.get(String(article.dataset.commentId || ''));
      if (!comment) return;
      addEditButton76(article.querySelector('header'), taskId, comment);
    });
  }

  /* OpenAI transcription for every authenticated user -------------------- */

  const formats76 = [
    { mime: 'audio/webm;codecs=opus', type: 'audio/webm', extension: 'webm' },
    { mime: 'audio/webm', type: 'audio/webm', extension: 'webm' },
    { mime: 'audio/mp4;codecs=mp4a.40.2', type: 'audio/mp4', extension: 'mp4' },
    { mime: 'audio/mp4', type: 'audio/mp4', extension: 'mp4' },
  ];
  let recorder76 = null;
  let stream76 = null;
  let chunks76 = [];
  let capture76 = null;
  let transcriptionState76 = 'idle';

  function supportedFormat76() {
    if (!window.MediaRecorder) return null;
    return formats76.find(format => {
      try { return !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(format.mime); }
      catch { return false; }
    }) || null;
  }

  function stopStream76() {
    stream76?.getTracks().forEach(track => track.stop());
    stream76 = null;
  }

  function targetTextarea76(capture = capture76) {
    if (capture?.where === 'chat') return document.querySelector('.task-chat-composer textarea[name="message"],.task-chat-composer textarea');
    return document.getElementById(`commentInput-${capture?.taskId || ''}`);
  }

  function captureStillOpen76(capture) {
    if (!capture || capture.section !== state.appSection) return false;
    if (capture.where === 'chat') return state.appSection === 'chat' && String(window.MAILO_ACTIVE_CHAT || '') === capture.taskId;
    return taskDetailsDraft?.id === capture.taskId && !document.getElementById('modalBackdrop')?.classList.contains('hidden');
  }

  function setTranscriptionState76(value) {
    transcriptionState76 = value;
    document.querySelectorAll('.transcribe76').forEach(button => {
      const compact = button.dataset.compact === 'true';
      button.classList.toggle('recording76', value === 'recording');
      button.classList.toggle('processing76', value === 'processing');
      button.disabled = value === 'processing';
      button.setAttribute('aria-pressed', String(value === 'recording'));
      button.textContent = value === 'recording'
        ? (compact ? '■' : '■ Stop recording')
        : value === 'processing'
          ? (compact ? '…' : '● Processing…')
          : (compact ? '✦🎤' : '✦🎤 Transcribe');
      button.title = value === 'recording' ? 'Stop recording and transcribe' : 'Transcribe with OpenAI';
    });
  }

  function resetTranscription76() {
    if (recorder76?.state === 'recording') {
      try { recorder76.onstop = null; recorder76.stop(); } catch {}
    }
    recorder76 = null;
    capture76 = null;
    chunks76 = [];
    stopStream76();
    setTranscriptionState76('idle');
  }

  async function uploadTranscription76(recorder, format, capture) {
    setTranscriptionState76('processing');
    stopStream76();
    try {
      if (!chunks76.length) throw new Error('No audio was captured. Please try again.');
      const recordedType = String(recorder?.mimeType || chunks76[0]?.type || format.type).split(';')[0];
      const type = recordedType === 'audio/mp4' ? 'audio/mp4' : 'audio/webm';
      const extension = type === 'audio/mp4' ? 'mp4' : 'webm';
      const blob = new Blob(chunks76, { type });
      if (!blob.size) throw new Error('No audio was captured. Please try again.');
      const form = new FormData();
      form.set('file', blob, `comment-${Date.now()}.${extension}`);
      form.set('purpose', 'comment-transcription');
      toast('Transcribing with OpenAI…');
      const result = await window.shgInvokeFunctionFormData('import-voice-memo', form);
      if (!captureStillOpen76(capture)) return;
      const text = String(result?.transcript || '').trim();
      if (!text) throw new Error('No speech was detected in the recording.');
      const textarea = targetTextarea76(capture);
      if (!textarea) throw new Error('The comment editor is no longer open.');
      textarea.value += `${textarea.value ? ' ' : ''}${text}`;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
      toast('Transcription is ready for review');
    } catch (error) {
      toast(error?.message || 'Transcription failed');
    } finally {
      recorder76 = null;
      capture76 = null;
      chunks76 = [];
      setTranscriptionState76('idle');
    }
  }

  window.toggleTranscription76 = async where => {
    if (!isAuthenticated76()) { toast('Please log in before using transcription'); return; }
    if (transcriptionState76 === 'processing') return;
    if (recorder76?.state === 'recording') {
      recorder76.stop();
      return;
    }
    const format = supportedFormat76();
    if (!format) { toast('This browser does not support audio recording'); return; }
    const capture = {
      where,
      section: state.appSection,
      taskId: String(where === 'chat' ? window.MAILO_ACTIVE_CHAT || '' : where || ''),
    };
    capture76 = capture;
    try {
      stream76 = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!captureStillOpen76(capture)) { resetTranscription76(); return; }
      chunks76 = [];
      recorder76 = new MediaRecorder(stream76, { mimeType: format.mime });
      const activeRecorder = recorder76;
      recorder76.ondataavailable = event => { if (event.data?.size) chunks76.push(event.data); };
      recorder76.onerror = () => { resetTranscription76(); toast('The audio recording failed. Please try again.'); };
      recorder76.onstop = () => uploadTranscription76(activeRecorder, format, capture);
      recorder76.start();
      setTranscriptionState76('recording');
      toast('Listening… Tap again to stop.');
    } catch (error) {
      resetTranscription76();
      toast(error?.message || 'Microphone access is required');
    }
  };

  function prepareTranscriptionButton76(button, where, compact) {
    button.classList.remove('recording75', 'processing75');
    button.classList.add('transcribe63', 'transcribe76');
    button.dataset.compact = String(compact);
    button.removeAttribute('onclick');
    button.onclick = () => window.toggleTranscription76(where);
  }

  function decorateTranscription76() {
    if (!isAuthenticated76()) return;
    const chatRow = document.querySelector('.task-chat-compose-row');
    if (chatRow) {
      let button = chatRow.querySelector('.transcribe76,.transcribe63');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        chatRow.querySelector('textarea')?.before(button);
      }
      prepareTranscriptionButton76(button, 'chat', true);
    }
    document.querySelectorAll('#modalContent .comment-tools').forEach(tools => {
      let button = tools.querySelector('.transcribe76,.transcribe63');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        tools.prepend(button);
      }
      prepareTranscriptionButton76(button, String(taskDetailsDraft?.id || ''), false);
    });
    setTranscriptionState76(transcriptionState76);
  }

  /* Victor-only permission management ----------------------------------- */

  function permissionDenied76() {
    toast('Permissions can be managed only by Victor Stavropoulos');
  }

  function guardPermissionFunction76(name) {
    const previous = window[name];
    if (typeof previous !== 'function') return;
    window[name] = function version76PermissionGuard(...args) {
      if (!canManagePermissions76()) { permissionDenied76(); return; }
      return previous.apply(this, args);
    };
  }

  for (const name of ['setUserAdmin', 'setUserApprover', 'setUserSpaceAccess', 'saveUsersChanges', 'openSpaceAccessModal']) {
    guardPermissionFunction76(name);
  }

  const priorCreateUserModal76 = createUserModal;
  createUserModal = function version76CreateUserModal(...args) {
    if (!canManagePermissions76()) { permissionDenied76(); return; }
    return priorCreateUserModal76.apply(this, args);
  };

  const priorEditUserProfileModal76 = editUserProfileModal;
  editUserProfileModal = function version76EditUserProfileModal(...args) {
    if (!canManagePermissions76()) { permissionDenied76(); return; }
    return priorEditUserProfileModal76.apply(this, args);
  };

  const priorSubmitCreateUser76 = submitCreateUser;
  submitCreateUser = function version76SubmitCreateUser(...args) {
    if (!canManagePermissions76()) { permissionDenied76(); return; }
    return priorSubmitCreateUser76.apply(this, args);
  };

  function hideManagedColumn76(table, label) {
    if (!table) return;
    const header = [...(table.tHead?.rows?.[0]?.cells || [])].find(cell =>
      String(cell.dataset.columnLabel || cell.textContent || '').trim().toLowerCase() === label.toLowerCase()
    );
    if (!header) return;
    const key = header.dataset.columnKey;
    header.hidden = true;
    header.style.display = 'none';
    for (const row of table.tBodies?.[0]?.rows || []) {
      const cell = key
        ? [...row.cells].find(item => item.dataset.columnKey === key)
        : row.cells[header.cellIndex];
      if (cell) { cell.hidden = true; cell.style.display = 'none'; }
    }
  }

  function applyPermissionVisibility76() {
    if (canManagePermissions76()) return;
    const usersTable = document.getElementById('usersTable');
    for (const label of ['Role', 'Approver', 'Spaces']) hideManagedColumn76(usersTable, label);
    document.getElementById('saveUsersChanges')?.remove();
    document.querySelectorAll('#usersView .create-space-btn,#usersView button[onclick*="createUserModal"],#usersView button[onclick*="editUserProfileModal"]').forEach(button => button.remove());
    const usersSubtitle = document.querySelector('#usersView .subtitle');
    if (usersSubtitle) usersSubtitle.textContent = 'Review user profiles. Permission management is available only to Victor Stavropoulos.';
    document.querySelectorAll('#spacesView button[onclick*="openSpaceAccessModal"],#spacesView .space-access-apply').forEach(button => button.remove());
    const spacesSubtitle = document.querySelector('#spacesView .subtitle');
    if (spacesSubtitle) spacesSubtitle.textContent = 'Review Spaces. Permission management is available only to Victor Stavropoulos.';
  }

  const priorRenderUsers76 = renderUsers;
  renderUsers = function version76RenderUsers(...args) {
    const result = priorRenderUsers76.apply(this, args);
    requestAnimationFrame(() => requestAnimationFrame(applyPermissionVisibility76));
    return result;
  };

  const priorRenderSpaces76 = renderSpaces;
  renderSpaces = function version76RenderSpaces(...args) {
    const result = priorRenderSpaces76.apply(this, args);
    requestAnimationFrame(applyPermissionVisibility76);
    return result;
  };

  /* View As for every authenticated Main Admin --------------------------- */

  function removeViewAsBanner76() {
    document.getElementById('viewAsBanner')?.remove();
  }

  function applyViewAsUI76() {
    removeViewAsBanner76();
    const switcher = document.querySelector('.user-preview-switcher');
    if (switcher) switcher.hidden = !isAuthenticatedMainAdmin76();
    if (!isAuthenticatedMainAdmin76() || isViewingOwnIdentity76()) return;
    const banner = document.createElement('div');
    banner.id = 'viewAsBanner';
    banner.className = 'view-as-banner';
    banner.innerHTML = `<span>Viewing as <strong>${esc(CURRENT_USER)}</strong></span><button type="button">Return to ${esc(authenticatedName76())}</button>`;
    banner.querySelector('button').onclick = () => previewAsUser(authenticatedName76());
    document.body.appendChild(banner);
  }

  previewAsUser = function version76PreviewAsUser(name) {
    const authenticated = authenticatedName76();
    if (!isAuthenticatedMainAdmin76() && name !== authenticated) {
      toast('Only a Main Admin can preview another user');
      return;
    }
    const person = PEOPLE.find(item => item.name === name);
    CURRENT_USER = person ? person.name : authenticated;
    const viewedRole = roleFor76(CURRENT_USER);
    state.role = ['admin', 'main_admin'].includes(viewedRole) ? 'admin' : 'user';
    if (state.role !== 'admin' && ['users', 'spaces', 'activity'].includes(state.appSection)) state.appSection = 'tasks';
    if (state.project !== 'all' && !canCurrentUserSeeProject(state.project)) {
      state.project = 'all';
      const crumb = document.getElementById('projectCrumb');
      if (crumb) crumb.textContent = 'ALL SPACES';
    }
    render();
    toast(isViewingOwnIdentity76() ? `Returned to ${authenticated}` : `Viewing the application as ${CURRENT_USER}`);
  };

  /* Final render hooks ---------------------------------------------------- */

  const priorOpenTask76 = openTask;
  openTask = function version76OpenTask(id, ...args) {
    const result = priorOpenTask76.call(this, id, ...args);
    decorateTaskCommentEditing76(id);
    decorateTranscription76();
    return result;
  };

  const priorRenderTaskChat76 = window.renderTaskChat;
  window.renderTaskChat = function version76RenderTaskChat(...args) {
    const result = priorRenderTaskChat76?.apply(this, args);
    decorateChatCommentEditing76();
    decorateTranscription76();
    return result;
  };

  const priorRender76 = render;
  render = function version76Render(...args) {
    const result = priorRender76.apply(this, args);
    applyViewAsUI76();
    applyPermissionVisibility76();
    decorateTranscription76();
    return result;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && recorder76) resetTranscription76();
  });
  window.addEventListener('pagehide', resetTranscription76);
  window.addEventListener('shg:remote-ready', () => setTimeout(refreshSnapshots76, 0));
  window.addEventListener('shg:comments-ready', () => setTimeout(refreshSnapshots76, 0));
  window.addEventListener('shg:comment-change', () => setTimeout(refreshSnapshots76, 0));
  window.addEventListener('shg:comment-batch', () => setTimeout(refreshSnapshots76, 0));

  const style = document.createElement('style');
  style.id = 'version76AdminStyles';
  style.textContent = `
    .edit-comment76{border:0;background:transparent;color:#2f66d1;padding:4px 6px;font:700 9px DM Sans;cursor:pointer}
    .transcribe76{white-space:nowrap}
    .transcribe76.recording76{border-color:#22c55e!important;background:#dcfce7!important;color:#15803d!important;animation:mailo-v76-recording 1.1s infinite}
    .transcribe76.processing76{border-color:#ef4444!important;background:#fee2e2!important;color:#b91c1c!important}
    @keyframes mailo-v76-recording{50%{box-shadow:0 0 0 7px rgba(34,197,94,.13)}}
  `;
  document.head.appendChild(style);

  refreshSnapshots76();
  applyViewAsUI76();
  applyPermissionVisibility76();
  decorateTranscription76();

  window.MAILO_V76_ADMIN = Object.freeze({
    authenticatedName: authenticatedName76,
    isAuthenticatedMainAdmin: isAuthenticatedMainAdmin76,
    canManagePermissions: canManagePermissions76,
    refreshSnapshots: refreshSnapshots76,
  });
})();
