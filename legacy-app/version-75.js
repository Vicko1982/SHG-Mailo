/* MAILO Version 75 — reliable comment and Task Chat transcription recording. */
(() => {
  const VICTOR = 'Victor Stavropoulos';
  const compatibleFormats75 = [
    { recorderType: 'audio/webm;codecs=opus', contentType: 'audio/webm', extension: 'webm' },
    { recorderType: 'audio/webm', contentType: 'audio/webm', extension: 'webm' },
    { recorderType: 'audio/mp4;codecs=mp4a.40.2', contentType: 'audio/mp4', extension: 'mp4' },
    { recorderType: 'audio/mp4', contentType: 'audio/mp4', extension: 'mp4' },
  ];

  let recorder75 = null;
  let stream75 = null;
  let capture75 = null;
  let session75 = 0;
  let transcriptionState75 = 'idle';

  function applyVersion75() {
    document.querySelectorAll('#versionBadge,.version-badge').forEach(node => {
      if (node.textContent !== 'Version 75') node.textContent = 'Version 75';
    });
  }

  function isVictor75() {
    const authenticated = String(
      window.SHG_AUTH_USER_NAME
      || (typeof SESSION_USER !== 'undefined' ? SESSION_USER : '')
      || '',
    ).trim();
    return typeof CURRENT_USER !== 'undefined' && CURRENT_USER === VICTOR && authenticated === VICTOR;
  }

  function pickFormat75() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') return null;
    return compatibleFormats75.find(format => {
      try { return window.MediaRecorder.isTypeSupported(format.recorderType); }
      catch { return false; }
    }) || null;
  }

  function actualFormat75(mimeType) {
    const baseType = String(mimeType || '').split(';')[0].trim().toLowerCase();
    if (baseType === 'audio/webm') return { contentType: 'audio/webm', extension: 'webm' };
    if (baseType === 'audio/mp4' || baseType === 'audio/x-m4a') return { contentType: 'audio/mp4', extension: 'mp4' };
    return null;
  }

  function setTranscriptionState75(nextState) {
    transcriptionState75 = nextState;
    document.querySelectorAll('.transcribe63').forEach(button => {
      if (!button.dataset.idleLabel75) button.dataset.idleLabel75 = button.textContent.trim() || '✦🎤';
      const compact = !button.dataset.idleLabel75.includes('Transcribe');
      button.classList.toggle('recording75', nextState === 'recording');
      button.classList.toggle('processing75', nextState === 'processing');
      button.disabled = nextState === 'processing';
      button.setAttribute('aria-busy', String(nextState === 'processing'));
      button.setAttribute('aria-pressed', String(nextState === 'recording'));
      if (nextState === 'recording') {
        button.textContent = compact ? '■' : '■ Stop recording';
        button.title = 'Stop recording and transcribe';
      } else if (nextState === 'processing') {
        button.textContent = compact ? '…' : '● Processing…';
        button.title = 'Transcribing with OpenAI';
      } else {
        button.textContent = button.dataset.idleLabel75;
        button.title = 'Transcribe with OpenAI';
      }
    });
  }

  function stopStream75() {
    stream75?.getTracks().forEach(track => track.stop());
    stream75 = null;
  }

  function targetArea75(capture) {
    if (capture?.where === 'chat') {
      return document.querySelector('.task-chat-composer textarea[name="message"], .task-chat-composer textarea');
    }
    const targetId = String(capture?.taskId || '');
    return targetId
      ? document.querySelector(`#commentInput-${CSS.escape(targetId)}`)
      : null;
  }

  function captureIsCurrent75(capture) {
    if (!capture || capture.section !== state.appSection) return false;
    if (capture.where === 'chat') {
      return capture.section === 'chat' && String(window.MAILO_ACTIVE_CHAT || '') === capture.taskId;
    }
    const modalOpen = !document.getElementById('modalBackdrop')?.classList.contains('hidden');
    return modalOpen && String(taskDetailsDraft?.id || '') === capture.taskId;
  }

  function cancelTranscription75() {
    session75 += 1;
    const activeRecorder = recorder75;
    if (activeRecorder) {
      activeRecorder.onstop = null;
      activeRecorder.onerror = null;
      if (activeRecorder.state === 'recording') {
        try { activeRecorder.stop(); } catch {}
      }
    }
    stopStream75();
    recorder75 = null;
    capture75 = null;
    setTranscriptionState75('idle');
  }

  async function processRecording75(stoppedRecorder, capturedChunks, selectedFormat, session, capture) {
    if (session !== session75) return;
    setTranscriptionState75('processing');
    stopStream75();
    try {
      if (!capturedChunks.length) throw new Error('No audio was captured. Please try recording again.');
      const recordedType = stoppedRecorder.mimeType || capturedChunks.find(chunk => chunk.type)?.type || selectedFormat?.recorderType;
      const uploadFormat = actualFormat75(recordedType) || actualFormat75(selectedFormat?.contentType);
      if (!uploadFormat) throw new Error('This browser did not create a supported audio recording.');

      const blob = new Blob(capturedChunks, { type: uploadFormat.contentType });
      if (!blob.size) throw new Error('No audio was captured. Please try recording again.');
      const form = new FormData();
      form.set('file', blob, `comment-${Date.now()}.${uploadFormat.extension}`);
      toast('Transcribing with OpenAI…');
      const result = await window.shgInvokeFunctionFormData('import-voice-memo', form);
      if (session !== session75 || !captureIsCurrent75(capture)) return;
      const area = targetArea75(capture);
      const text = String(result?.transcript || '').trim();
      if (!text) throw new Error('No speech was detected in the recording.');
      if (area) {
        area.value += `${area.value ? ' ' : ''}${text}`;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        area.focus();
      }
      toast('Transcription is ready for review');
    } catch (error) {
      if (session === session75) toast(error?.message || 'Transcription failed');
    } finally {
      if (session === session75) {
        recorder75 = null;
        capture75 = null;
        setTranscriptionState75('idle');
      }
    }
  }

  window.toggleTranscription63 = async where => {
    if (!isVictor75()) return;
    if (transcriptionState75 === 'processing') return;
    if (capture75 && !recorder75) return;
    if (recorder75?.state === 'recording') {
      setTranscriptionState75('processing');
      recorder75.stop();
      return;
    }

    const session = ++session75;
    const capture = {
      where,
      section: state.appSection,
      taskId: String(where === 'chat' ? window.MAILO_ACTIVE_CHAT || '' : where || ''),
    };
    capture75 = capture;
    try {
      const selectedFormat = pickFormat75();
      if (!selectedFormat) throw new Error('This browser does not support a compatible audio recording format.');
      const requestedStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (session !== session75 || !captureIsCurrent75(capture)) {
        requestedStream.getTracks().forEach(track => track.stop());
        return;
      }
      stream75 = requestedStream;
      const capturedChunks = [];
      recorder75 = new MediaRecorder(stream75, { mimeType: selectedFormat.recorderType });
      const activeRecorder = recorder75;
      recorder75.ondataavailable = event => { if (event.data?.size) capturedChunks.push(event.data); };
      recorder75.onstop = () => processRecording75(activeRecorder, capturedChunks, selectedFormat, session, capture);
      recorder75.onerror = event => {
        if (session !== session75) return;
        console.error('MAILO transcription recorder failed', event?.error || event);
        cancelTranscription75();
        toast('The audio recording failed. Please try again.');
      };
      recorder75.start();
      setTranscriptionState75('recording');
      toast('Listening… Tap again to stop.');
    } catch (error) {
      if (session !== session75) return;
      cancelTranscription75();
      toast(error?.message || 'Microphone access is required');
    }
  };

  const priorRenderTaskChat75 = window.renderTaskChat;
  window.renderTaskChat = function version75RenderTaskChat(...args) {
    const result = priorRenderTaskChat75?.apply(this, args);
    setTranscriptionState75(transcriptionState75);
    return result;
  };

  const priorOpenTask75 = openTask;
  openTask = function version75OpenTask(...args) {
    const openingTaskId = String(args[0] || '');
    if (capture75 && (capture75.where === 'chat' || capture75.taskId !== openingTaskId)) cancelTranscription75();
    const result = priorOpenTask75.apply(this, args);
    setTranscriptionState75(transcriptionState75);
    return result;
  };

  const priorCloseModal75 = closeModal;
  closeModal = function version75CloseModal(...args) {
    const result = priorCloseModal75.apply(this, args);
    if (result !== false && capture75?.where !== 'chat') cancelTranscription75();
    return result;
  };

  const priorOpenTaskChat75 = window.openTaskChat;
  window.openTaskChat = function version75OpenTaskChat(id, ...args) {
    if (capture75 && capture75.taskId !== String(id || '')) cancelTranscription75();
    return priorOpenTaskChat75?.call(this, id, ...args);
  };

  const priorCloseTaskChat75 = window.closeTaskChat;
  window.closeTaskChat = function version75CloseTaskChat(...args) {
    cancelTranscription75();
    return priorCloseTaskChat75?.apply(this, args);
  };

  const priorRender75 = render;
  render = function version75Render(...args) {
    if (capture75 && capture75.section !== state.appSection) cancelTranscription75();
    const result = priorRender75.apply(this, args);
    applyVersion75();
    setTranscriptionState75(transcriptionState75);
    return result;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && capture75) cancelTranscription75();
  });
  window.addEventListener('pagehide', cancelTranscription75);

  applyVersion75();
  setTranscriptionState75('idle');
})();

/* Keep workflow events in the audit/database while hiding System messages from
   human Comments and Task Chat conversations. */
(() => {
  const isSystemMessage75 = comment => comment?.system === true;

  // Assignment-change email delivery is owned by the durable database queue
  // in Version 75. Prevent the legacy browser helper from sending a duplicate.
  window.sendAssigneeChangedEmail = function version75DatabaseOwnedAssignmentEmail() {};

  function withoutSystemMessages75(callback) {
    const originalComments = state.tasks.map(task => [task, task.comments]);
    const originalCommentsByTask = new Map(originalComments);
    const priorIsUserMentioned75 = isUserMentioned;
    const priorCanAccessTask75 = canCurrentUserAccessTask;
    const priorTaskAccessReasons75 = taskAccessReasons;
    const withPersistedComments75 = (task, operation) => {
      if (!originalCommentsByTask.has(task)) return operation();
      const filteredComments = task.comments;
      task.comments = originalCommentsByTask.get(task);
      try { return operation(); }
      finally { task.comments = filteredComments; }
    };
    try {
      // Hiding is presentation-only. Mention-based participation and access
      // must still use the complete persisted conversation; otherwise a user
      // mentioned by a hidden System event loses the Task Chat while rendering.
      isUserMentioned = (task, name) => withPersistedComments75(task, () => priorIsUserMentioned75(task, name));
      canCurrentUserAccessTask = task => withPersistedComments75(task, () => priorCanAccessTask75(task));
      taskAccessReasons = (task, name) => withPersistedComments75(task, () => priorTaskAccessReasons75(task, name));
      for (const [task, comments] of originalComments) {
        if (Array.isArray(comments)) task.comments = comments.filter(comment => !isSystemMessage75(comment));
      }
      return callback();
    } finally {
      for (const [task, comments] of originalComments) task.comments = comments;
      isUserMentioned = priorIsUserMentioned75;
      canCurrentUserAccessTask = priorCanAccessTask75;
      taskAccessReasons = priorTaskAccessReasons75;
    }
  }

  function refreshHumanUnreadBadge75() {
    const badge = document.getElementById('chatUnreadBadge');
    if (!badge) return;
    const count = state.tasks
      .filter(task => {
        if (isTaskDeleted(task) || !canCurrentUserAccessTask(task)) return false;
        return task.assignee === CURRENT_USER
          || taskSupervisor(task) === CURRENT_USER
          || isUserMentioned(task, CURRENT_USER);
      })
      .reduce((total, task) => {
        const readAt = new Date(task.chatReadBy?.[CURRENT_USER] || 0).getTime();
        return total + (task.comments || []).filter(comment =>
          !isSystemMessage75(comment)
          && comment.author !== CURRENT_USER
          && new Date(comment.createdAt || 0).getTime() > readAt
        ).length;
      }, 0);
    badge.textContent = String(count);
    badge.title = `${count} unread message${count === 1 ? '' : 's'}`;
    badge.classList.toggle('hidden', count === 0);
  }

  const priorTaskChat75 = window.renderTaskChat;
  window.renderTaskChat = function version75HumanTaskChat(...args) {
    const result = withoutSystemMessages75(() => priorTaskChat75?.apply(this, args));
    refreshHumanUnreadBadge75();
    return result;
  };

  const priorUnreadBadge75 = window.refreshUnreadBadge55;
  window.refreshUnreadBadge55 = function version75HumanUnreadBadge(...args) {
    const result = withoutSystemMessages75(() => priorUnreadBadge75?.apply(this, args));
    refreshHumanUnreadBadge75();
    return result;
  };

  const priorOpenTaskComments75 = openTask;
  openTask = function version75HumanTaskComments(id, ...args) {
    const result = priorOpenTaskComments75.call(this, id, ...args);
    const task = state.tasks.find(item => item.id === id);
    const comments = taskDetailsDraft?.id === id ? taskDetailsDraft.comments || [] : task?.comments || [];
    const list = document.querySelector('#modalContent .comment-list');
    if (!list) return result;
    [...list.querySelectorAll(':scope > article.comment')].forEach((article, index) => {
      if (isSystemMessage75(comments[index])) article.remove();
    });
    const visibleCount = comments.filter(comment => !isSystemMessage75(comment)).length;
    const count = document.querySelector('#modalContent .comments > h4 span');
    if (count) count.textContent = String(visibleCount);
    if (!visibleCount && !list.querySelector('.no-comments')) {
      list.insertAdjacentHTML('beforeend', '<p class="no-comments">No comments yet.</p>');
    }
    return result;
  };

  const priorRenderHuman75 = render;
  render = function version75HumanRender(...args) {
    const result = priorRenderHuman75.apply(this, args);
    refreshHumanUnreadBadge75();
    return result;
  };

  refreshHumanUnreadBadge75();
})();
