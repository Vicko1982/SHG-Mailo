/* Mailo Version 52 workflow, collaboration and reliability enhancements. */
(() => {
  const VICTOR = 'Victor Stavropoulos';
  const ALEXANDROS = 'Alexandros K';
  const SAKIS = 'Sakis Iliou';
  const CONSTRUCTION_STAGES = [
    'Κατεδαφίσεις - Γκρεμίσματα - Αποξηλώσεις','Πρώτη Φάση Γυψοσανίδων','Πρώτη Φάση Ηλεκτρολογικών','Πρώτη Φάση Υδραυλικών',
    'Δεύτερη Φάση Γυψοσανίδων','Τοποθέτηση Κουφωμάτων','Σοβάτισμα - Στοκάρισμα - Βάψιμο','Τοποθέτηση Δαπέδων - Πλακιδίων',
    'Τοποθέτηση Εξωτερικών Πορτών','Δεύτερη Φάση Υδραυλικών','Δεύτερη Φάση Ηλεκτρολογικών','Επίπλωση - Δημιουργία Εξωτερικών Χώρων'
  ];
  const mainAdmins = new Set([VICTOR, ...(window.SHG_REMOTE_BOOTSTRAP?.mainAdminNames || [])]);
  const isRealMain = () => mainAdmins.has(SESSION_USER);
  const personByLooseName = value => PEOPLE.find(person => person.name.toLowerCase() === String(value || '').toLowerCase());

  // Everyone can use both voice import surfaces. The logged-in identity remains the Creator.
  chooseVoiceMemos = function version52ChooseVoiceMemos() { document.getElementById('voiceMemoFiles')?.click(); };
  document.querySelectorAll('.sidebar-voice-memos').forEach(element => element.classList.remove('main-admin-only'));

  // Persist the real Main Admin while previewing another user.
  function renderPreviewBanner() {
    document.getElementById('viewAsBanner')?.remove();
    if (!isRealMain() || CURRENT_USER === SESSION_USER) return;
    const banner = document.createElement('div');
    banner.id = 'viewAsBanner'; banner.className = 'view-as-banner';
    banner.innerHTML = `<span>Viewing as <strong>${esc(CURRENT_USER)}</strong></span><button type="button">Return to Main Admin</button>`;
    banner.querySelector('button').onclick = () => previewAsUser(SESSION_USER);
    document.body.appendChild(banner);
  }
  const basePreviewAsUser52 = previewAsUser;
  previewAsUser = function version52Preview(name) { basePreviewAsUser52(name); renderPreviewBanner(); };
  const baseRender52 = render;
  render = function version52Render() { baseRender52(); renderPreviewBanner(); };

  // Sakis always receives Alexandros as Supervisor, in list edits and creation forms.
  const baseUpdateTaskCell52 = updateTaskCell;
  updateTaskCell = function version52UpdateCell(id, key, value) {
    baseUpdateTaskCell52(id, key, value);
    if (key === 'assignee' && value === SAKIS) {
      const task = state.tasks.find(item => item.id === id);
      if (task && taskSupervisor(task) !== ALEXANDROS) baseUpdateTaskCell52(id, 'supervisor', ALEXANDROS);
    }
  };
  let successfulCreationSubmit = false;
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!['taskForm','miniTaskForm','subtaskForm'].includes(form.id)) return;
    successfulCreationSubmit = true;
    if (form.elements.assignee?.value === SAKIS && form.elements.supervisor) form.elements.supervisor.value = ALEXANDROS;
  }, true);

  // Creation succeeds without showing a false unsaved warning.
  document.addEventListener('submit', event => {
    if (['taskForm','miniTaskForm','subtaskForm'].includes(event.target.id)) requestAnimationFrame(() => { if (!document.getElementById(event.target.id)) closeModal(true); });
  });

  // Recurrence metadata for Main Admins. One future copy per completed period.
  function recurrenceField(value = '') {
    if (!isRealMain()) return '';
    return `<div class="field recurring-task-field"><label>Recurring Task</label><select name="recurringFrequency"><option value="">Not recurring</option>${['daily','weekly','monthly','yearly'].map(item => `<option value="${item}" ${value===item?'selected':''}>${item[0].toUpperCase()+item.slice(1)}</option>`).join('')}</select></div>`;
  }
  function decorateCreationRecurrence() {
    const form = document.querySelector('#modalContent form.task-form');
    if (!form || form.querySelector('[name="recurringFrequency"]')) return;
    form.querySelector('button[type="submit"]')?.insertAdjacentHTML('beforebegin', recurrenceField());
    form.addEventListener('submit', () => {
      const before = new Set(state.tasks.map(task => task.id));
      const frequency = form.elements.recurringFrequency?.value;
      requestAnimationFrame(() => {
        const created = state.tasks.find(task => !before.has(task.id));
        if (created && frequency) { created.recurringFrequency = frequency; created.recurringAnchor = created.created; save(); }
      });
    }, { once: true });
  }
  for (const fnName of ['newTaskModal','miniTaskModal']) {
    const base = window[fnName];
    window[fnName] = function version52CreateModal(...args) { base(...args); decorateCreationRecurrence(); };
  }
  const baseOpenTask52 = openTask;
  openTask = function version52OpenTask(id, preserveDirty = false) {
    baseOpenTask52(id, preserveDirty);
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;
    const title = document.querySelector('#modalContent h2');
    if (title && !document.querySelector('.task-code-badge')) title.insertAdjacentHTML('beforebegin', `<strong class="task-code-badge">${esc(task.id)}</strong>`);
    if (isRealMain()) {
      const grid = document.querySelector('#modalContent .detail-grid');
      if (grid && !grid.querySelector('[name="taskRecurringFrequency"]')) grid.insertAdjacentHTML('beforeend', recurrenceField(task.recurringFrequency).replace('name="recurringFrequency"','name="taskRecurringFrequency" onchange="setTaskRecurrenceFromDetails(this.value)"'));
    }
    decorateComments52(task);
  };
  window.setTaskRecurrenceFromDetails = value => { if (!taskDetailsDraft || !isRealMain()) return; taskDetailsDraft.recurringFrequency = value; markTaskDetailsDirty(taskDetailsDraft.id); };
  function nextRecurringDate(date, frequency) { const next = new Date(date || Date.now()); if (frequency==='daily') next.setDate(next.getDate()+1); if (frequency==='weekly') next.setDate(next.getDate()+7); if (frequency==='monthly') next.setMonth(next.getMonth()+1); if (frequency==='yearly') next.setFullYear(next.getFullYear()+1); return next; }
  function processRecurringTasks() {
    let changed = false; const now = new Date();
    for (const source of [...state.tasks]) {
      if (!source.recurringFrequency || !['done','cancelled'].includes(source.status)) continue;
      const period = nextRecurringDate(source.recurringLastCreatedAt || source.updated || source.created, source.recurringFrequency);
      if (period > now || source.recurringLastCreatedAt === period.toISOString()) continue;
      const copy = JSON.parse(JSON.stringify(source)); copy.id = nextTaskKey(source.project); copy.status = source.isMiniTask?'progress':'backlog'; copy.jiraStatus = source.isMiniTask?'In Progress':'Backlog'; copy.created = copy.updated = now.toISOString(); copy.comments=[]; copy.audit=[`Recurring copy created from ${source.id}`]; delete copy.lastChecks; delete copy.recurringLastCreatedAt; source.recurringLastCreatedAt = period.toISOString(); state.tasks.unshift(copy); changed = true;
    }
    if (changed) { save(); render(); }
  }
  processRecurringTasks(); setInterval(processRecurringTasks, 60000);

  // Unlimited nested subtasks inherit the first subtask branch properties.
  const baseOpenSubtaskModal52 = openSubtaskModal;
  openSubtaskModal = function version52SubtaskModal(parentId) {
    baseOpenSubtaskModal52(parentId);
    const parent = state.tasks.find(item => item.id === parentId); if (!parent) return;
    let branch = parent;
    while (branch.parent) branch = state.tasks.find(item => item.id === branch.parent) || branch;
    const first = state.tasks.find(item => item.parent === branch.id) || parent;
    const form = document.getElementById('subtaskForm'); if (!form) return;
    for (const [name,value] of [['assignee',first.assignee],['supervisor',taskSupervisor(first)],['priority',first.priority],['label',first.labels?.[0]]]) if (form.elements[name] && value) form.elements[name].value=value;
  };

  // Construction folder template.
  const baseSavedFilterControls52 = savedFilterControls;
  savedFilterControls = function version52SavedFilters() { return `${baseSavedFilterControls52()}<button type="button" class="save-filter-btn create-folders-btn" onclick="openConstructionFolderModal()">Create Folders ▾</button>`; };
  window.openConstructionFolderModal = () => {
    document.getElementById('modalContent').innerHTML = `<p class="eyebrow">CREATE FOLDER</p><h2>Construction</h2><p class="modal-sub">Creates one central Task and the 12 standard construction stages as Subtasks.</p><form id="constructionFolderForm" class="task-form"><div class="field"><label>Central Task title *</label><input name="title" required autofocus placeholder="e.g. Εκκρεμότητες κτιρίου"></div><div class="field"><label>Space</label><select name="project">${taskCreationSpaceEntries().map(([key,p])=>`<option value="${key}">${esc(p.name)}</option>`).join('')}</select></div><button class="primary-btn">Create Construction Folder</button></form>`;
    showModal(); document.getElementById('constructionFolderForm').onsubmit = event => { event.preventDefault(); const data=new FormData(event.target), now=new Date().toISOString(), project=data.get('project'), rootId=nextTaskKey(project), root={id:rootId,title:data.get('title').trim(),project,creator:CURRENT_USER,status:'backlog',jiraStatus:'Backlog',priority:'Medium',labels:[],dueDate:null,assignee:'Unassigned',supervisor:'Unassigned',approver:DEFAULT_APPROVER,description:'Construction folder',created:now,updated:now,comments:[],audit:[`Construction folder created by ${CURRENT_USER}`]}; state.tasks.unshift(root); for(const title of [...CONSTRUCTION_STAGES].reverse()){const id=nextTaskKey(project);state.tasks.unshift({...root,id,title,parent:rootId,issueType:'Sub-task',comments:[],audit:[`Created automatically under ${rootId}`]})} save(); closeModal(true); render(); toast(`${rootId} and 12 construction stages created`); };
  };

  // Reply to comments and common office-file attachments (stored with the protected Task record).
  let replyDraft = null;
  window.replyToComment = (taskId, commentId) => { const task=state.tasks.find(item=>item.id===taskId),comment=(taskDetailsDraft?.comments||task?.comments||[]).find(item=>item.id===commentId); if(!comment)return; replyDraft={taskId,commentId,author:comment.author,text:comment.text||''}; openTask(taskId,true); document.getElementById(`commentInput-${taskId}`)?.focus(); decorateComments52(task); };
  window.cancelCommentReply = taskId => { replyDraft=null; openTask(taskId,true); };
  function decorateComments52(task) {
    const form=document.querySelector('#modalContent .comment-form'); if(!form)return;
    const fileInput=form.querySelector('input[type="file"]'); if(fileInput){fileInput.accept='image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip';fileInput.closest('label').childNodes[0].textContent='📎 Add files';}
    if(replyDraft?.taskId===task.id&&!form.querySelector('.reply-composer')) form.insertAdjacentHTML('afterbegin',`<div class="reply-composer">Replying to <strong>${esc(replyDraft.author)}</strong><span>${esc(replyDraft.text).slice(0,120)}</span><button type="button" onclick="cancelCommentReply('${esc(task.id)}')">×</button></div>`);
    document.querySelectorAll('#modalContent .comment-list article.comment').forEach((article,index)=>{if(article.querySelector('.comment-reply-btn'))return;const comments=taskDetailsDraft?.comments||task.comments||[],comment=comments[index];if(!comment)return;article.dataset.commentId=comment.id;article.querySelector('.comment-meta')?.insertAdjacentHTML('beforeend',`<button type="button" class="comment-reply-btn" onclick="replyToComment('${esc(task.id)}','${esc(comment.id)}')">Reply</button>`);if(comment.replyTo)article.insertAdjacentHTML('afterbegin',`<div class="quoted-comment"><strong>${esc(comment.replyTo.author)}</strong><span>${esc(comment.replyTo.text||'').slice(0,160)}</span></div>`);if(comment.attachments?.length)article.insertAdjacentHTML('beforeend',`<div class="comment-attachments">${comment.attachments.map(file=>`<a href="${file.data}" download="${esc(file.name)}"><strong>${esc(file.name)}</strong><small>${esc(file.type||'File')} · ${Math.ceil(file.size/1024)} KB</small></a>`).join('')}</div>`);});
  }
  const baseAddComment52 = addComment;
  addComment = async function version52AddComment(id,event) {
    const input=event.currentTarget.querySelector('input[type="file"]'),files=[...(input?.files||[])];
    if(files.some(file=>file.size>3*1024*1024)){event.preventDefault();toast('Each attachment must be 3 MB or smaller');return}
    const extras=await Promise.all(files.filter(file=>!file.type.startsWith('image/')).map(file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,type:file.type,size:file.size,data:reader.result});reader.onerror=reject;reader.readAsDataURL(file)})));
    if(input&&typeof DataTransfer!=='undefined'){const transfer=new DataTransfer();files.filter(file=>file.type.startsWith('image/')).slice(0,4).forEach(file=>transfer.items.add(file));input.files=transfer.files;}
    await baseAddComment52(id,event); const pending=taskDetailsDraft?.comments?.find(comment=>comment.pending); if(pending){pending.attachments=extras;if(replyDraft?.taskId===id){pending.replyTo={id:replyDraft.commentId,author:replyDraft.author,text:replyDraft.text};replyDraft=null;}openTask(id,true);}
  };

  // Voice Memo review protects edited drafts from accidental dismissal.
  let memoFingerprint = '';
  const baseRenderVoiceMemoReview52 = renderVoiceMemoReview;
  renderVoiceMemoReview = function version52MemoReview(...args) { baseRenderVoiceMemoReview52(...args); memoFingerprint=JSON.stringify(state.voiceMemoDrafts||[]); };
  const baseCloseModal52 = closeModal;
  closeModal = function version52Close(discard=false) { const reviewing=Boolean(document.querySelector('.voice-memo-review')); if(reviewing&&!discard&&memoFingerprint!==JSON.stringify(state.voiceMemoDrafts||[])&&!confirm('You have unsaved Voice Memo changes. Leave without saving them?'))return false; const result=baseCloseModal52(discard||successfulCreationSubmit);successfulCreationSubmit=false;return result; };

  // Backlog notifications: Approver only; Assignee/Supervisor begin at To Do.
  const baseSendTaskCreatedEmails52 = sendTaskCreatedEmails;
  sendTaskCreatedEmails = function version52CreatedEmail(task) {
    if (task.status !== 'backlog') return baseSendTaskCreatedEmails52(task);
    const assignee=task.assignee,supervisor=task.supervisor; task.assignee='Unassigned';task.supervisor='Unassigned';baseSendTaskCreatedEmails52(task);task.assignee=assignee;task.supervisor=supervisor;
  };
  const baseMoveTask52 = moveTask;
  moveTask = function version52MoveTask(id,target,reason=null){const task=state.tasks.find(item=>item.id===id),wasBacklog=task?.status==='backlog';baseMoveTask52(id,target,reason);if(wasBacklog&&target==='todo'&&task)baseSendTaskCreatedEmails52(task);};

  // Actual database roles appear in Users and sidebar.
  const baseRenderUsers52 = renderUsers;
  renderUsers = function version52Users(){baseRenderUsers52();requestAnimationFrame(()=>{document.querySelectorAll('#usersTable tbody tr').forEach(row=>{const name=row.querySelector('.table-person')?.textContent?.trim();if(!name)return;const role=mainAdmins.has(name)?'Main Admin':state.admins.has(name)?'Administrator':'User';const cell=row.children[3];if(cell&&!cell.querySelector('select'))cell.textContent=role;});});};
  const baseRoleName52 = roleName;
  roleName = function version52RoleName(){if(mainAdmins.has(CURRENT_USER))return 'Main Admin';return state.admins.has(CURRENT_USER)?'Administrator':'User';};
  document.getElementById('roleLabel').textContent=roleName();

  // Secondary recovery email entry is visible only on Victor's own account.
  if (SESSION_USER===VICTOR) {
    const menu=document.getElementById('sidebarUserMenu');
    menu?.insertAdjacentHTML('afterbegin','<button id="secondaryEmailBtn" type="button" role="menuitem"><span>✉</span> Second email</button>');
    document.getElementById('secondaryEmailBtn')?.addEventListener('click',()=>{const current=localStorage.getItem('mailo-victor-secondary-email')||'';const email=prompt('Second recovery email for Victor',current);if(email===null)return;if(!/^\S+@\S+\.\S+$/.test(email)){toast('Enter a valid email');return}localStorage.setItem('mailo-victor-secondary-email',email);toast('Second email saved locally. Verification is required before it can be used for login.');});
  }
})();
