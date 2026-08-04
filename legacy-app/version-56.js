/* MAILO Version 56 — reliable keyboard date entry when creating Tasks. */
(() => {
  function isoToDisplay56(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }

  function displayToIso56(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validIso56(text) ? text : null;
    const digits = text.replace(/\D/g, '');
    if (digits.length !== 8) return null;
    const iso = `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
    return validIso56(iso) ? iso : null;
  }

  function validIso56(value) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return year >= 1900 && year <= 2200 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function formatTypedDate56(input) {
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    input.value = digits.length <= 2 ? digits : digits.length <= 4 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    input.setCustomValidity('');
  }

  function enhanceCreationDate56(formId) {
    const form = document.getElementById(formId), input = form?.querySelector('input[name="dueDate"]');
    if (!form || !input || input.dataset.keyboardDate56 === 'true') return;
    const initialValue = input.value;
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.maxLength = 10;
    input.placeholder = 'dd/mm/yyyy';
    input.value = isoToDisplay56(initialValue);
    input.dataset.keyboardDate56 = 'true';
    input.setAttribute('aria-label', 'Due Date, day month year');
    input.addEventListener('input', () => formatTypedDate56(input));
    input.addEventListener('blur', () => {
      const iso = displayToIso56(input.value);
      if (iso) input.value = isoToDisplay56(iso);
    });

    const originalSubmit = form.onsubmit;
    form.onsubmit = event => {
      const iso = displayToIso56(input.value);
      if (input.value.trim() && !iso) {
        event.preventDefault();
        input.setCustomValidity('Enter a valid date as dd/mm/yyyy.');
        input.reportValidity();
        input.focus();
        return;
      }
      input.setCustomValidity('');
      input.value = iso || '';
      return originalSubmit?.call(form, event);
    };
  }

  const previousNewTaskModal56 = newTaskModal;
  newTaskModal = function version56NewTaskModal() {
    previousNewTaskModal56();
    enhanceCreationDate56('taskForm');
  };

  const previousMiniTaskModal56 = miniTaskModal;
  miniTaskModal = function version56MiniTaskModal() {
    previousMiniTaskModal56();
    enhanceCreationDate56('miniTaskForm');
  };

  const newTaskButton56 = document.getElementById('newTaskBtn');
  const mobileNewTaskButton56 = document.getElementById('mobileNewTaskBtn');
  const miniTaskButton56 = document.getElementById('miniTaskBtn');
  if (newTaskButton56) newTaskButton56.onclick = newTaskModal;
  if (mobileNewTaskButton56) mobileNewTaskButton56.onclick = newTaskModal;
  if (miniTaskButton56) miniTaskButton56.onclick = miniTaskModal;
})();
