(() => {
  // Version 63 recovery: discard only an oversized reconstructable Task cache.
  // Saved filters and all user preferences remain untouched.
  try {
    const cachedTasks = localStorage.getItem('shg-tasks-v5');
    if (cachedTasks && cachedTasks.length > 1500000) localStorage.removeItem('shg-tasks-v5');
    const workspace = localStorage.getItem('shg-last-workspace-state');
    if (workspace && workspace.length > 250000) localStorage.removeItem('shg-last-workspace-state');
    localStorage.setItem('mailo-browser-recovery-v63', 'complete');
  } catch (error) {
    try { localStorage.removeItem('shg-tasks-v5'); } catch {}
    console.warn('MAILO browser cache recovery applied', error);
  }
  const SUPABASE_URL = 'https://ewjalucwaeotamodlajs.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_XeGECEGDBFj1b0z-zyb2kQ_SdlTL2tG';
  const SESSION_KEY = 'shg-supabase-session';
  const ROLE_CACHE_KEY = 'mailo-role-by-name';
  const REFRESH_EARLY_MS = 5 * 60 * 1000;
  const REFRESH_RETRY_MS = 30 * 1000;
  const AUTH_REQUEST_TIMEOUT_MS = 15000;
  const AUTH_REFRESH_TIMEOUT_MS = 20000;
  const AUTH_REQUIRED = !['127.0.0.1', 'localhost'].includes(location.hostname) || new URLSearchParams(location.search).get('auth') === '1';
  const USER_NAMES = {
    'agapi@shd.global': 'Agapi Zoannou',
    'alexandros@shd.global': 'Alexandros K',
    'c.giannoula.law@gmail.com': 'Chara Giannoula',
    'chris@shd.global': 'Chris Bourtzoulas',
    'dinos@shd.global': 'Dinos Stavropoulos',
    'fang@shd.global': 'Fang Gao',
    'fotis@shd.global': 'Fotis Fotinias',
    'galini@shd.global': 'Galini Stavropoulou',
    'ifigenia@shd.global': 'Ifigenia Chrisoulaki',
    'jtzortzos@shd.global': 'John Tzortzos',
    'sakisiliou80@gmail.com': 'Sakis iliou',
    'info+assistant@shd.global': 'Smart Homes Assistant',
    'katsaros@tkcfinance.com': 'Vasilis Katsaros',
    'victor@shd.global': 'Victor Stavropoulos',
  };

  function readStoredSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!session?.access_token || !session?.user?.email) return null;
      return session;
    } catch {
      return null;
    }
  }

  function sessionIsFresh(value, minimumValidityMs = 0) {
    if (!value?.access_token) return false;
    if (!value.expires_at) return true;
    return value.expires_at * 1000 - Date.now() > minimumValidityMs;
  }

  function normalizeSession(value, previous = null) {
    const normalized = { ...(previous || {}), ...(value || {}) };
    if (!normalized.refresh_token) normalized.refresh_token = previous?.refresh_token || '';
    if (!normalized.expires_at && normalized.expires_in) {
      normalized.expires_at = Math.floor(Date.now() / 1000) + Number(normalized.expires_in);
    }
    return normalized;
  }

  let session = readStoredSession();
  let pendingEmail = '';
  let refreshPromise = null;
  let refreshTimer = null;
  let authHandlersBound = false;

  function cachedRoleLabel(name) {
    if (!name) return '';
    if (name === 'Victor Stavropoulos') return 'Main Admin';
    try {
      const role = JSON.parse(localStorage.getItem(ROLE_CACHE_KEY) || '{}')?.[name];
      if (role === 'main_admin') return 'Main Admin';
      if (role === 'admin') return 'Admin';
      if (role === 'user') return 'User';
    } catch {}
    return 'Loading permissions…';
  }

  function withTimeout(promise, timeoutMs, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function updateAuthIdentity(value) {
    const email = value?.user?.email?.toLowerCase() || '';
    const name = USER_NAMES[email] || '';
    window.SHG_AUTH_USER_EMAIL = email;
    window.SHG_AUTH_USER_NAME = name;
    const nameElement = document.getElementById('currentUserName');
    const avatarElement = document.getElementById('currentUserAvatar');
    const roleElement = document.getElementById('roleLabel');
    if (nameElement) nameElement.textContent = name || 'Loading user…';
    if (avatarElement) {
      avatarElement.textContent = name
        ? name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()
        : '…';
    }
    if (roleElement) roleElement.textContent = cachedRoleLabel(name);
  }

  function storeSession(value) {
    session = normalizeSession(value, session);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    updateAuthIdentity(session);
    window.dispatchEvent(new CustomEvent('shg:auth-session', { detail: { session } }));
    scheduleRefresh();
    return session;
  }

  function scheduleRefresh(delayOverride = null) {
    clearTimeout(refreshTimer);
    if (!session?.refresh_token) return;
    const expiresAt = Number(session.expires_at || 0) * 1000;
    const delay = delayOverride ?? Math.max(1000, expiresAt - Date.now() - REFRESH_EARLY_MS);
    refreshTimer = setTimeout(() => {
      ensureFreshSession(REFRESH_EARLY_MS).catch(() => scheduleRefresh(REFRESH_RETRY_MS));
    }, Math.min(delay, 2147483647));
  }

  async function performRefresh() {
    const latest = readStoredSession();
    if (latest && latest.refresh_token !== session?.refresh_token) session = latest;
    if (sessionIsFresh(session, REFRESH_EARLY_MS)) {
      scheduleRefresh();
      return session;
    }
    if (!session?.refresh_token) return null;
    try {
      const data = await authRequest('token?grant_type=refresh_token', {
        refresh_token: session.refresh_token,
      });
      return storeSession(data);
    } catch (error) {
      scheduleRefresh(REFRESH_RETRY_MS);
      throw error;
    }
  }

  async function ensureFreshSession(minimumValidityMs = REFRESH_EARLY_MS) {
    const latest = readStoredSession();
    if (latest && latest.refresh_token !== session?.refresh_token) session = latest;
    if (sessionIsFresh(session, minimumValidityMs)) {
      scheduleRefresh();
      return session;
    }
    if (!session?.refresh_token) return null;
    if (refreshPromise) return refreshPromise;
    const refresh = async () => {
      const newest = readStoredSession();
      if (newest) session = newest;
      return sessionIsFresh(session, minimumValidityMs) ? session : performRefresh();
    };
    const refreshOperation = navigator.locks?.request
      ? navigator.locks.request('mailo-auth-refresh', refresh)
      : refresh()
    refreshPromise = withTimeout(
      refreshOperation,
      AUTH_REFRESH_TIMEOUT_MS,
      'The login session refresh timed out. Please try again.',
    ).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  updateAuthIdentity(session);
  window.SHG_AUTH_REQUIRED = AUTH_REQUIRED;
  window.SHG_SUPABASE_URL = SUPABASE_URL;
  window.SHG_SUPABASE_KEY = SUPABASE_KEY;
  window.shgGetSupabaseSession = () => session || readStoredSession();
  window.shgEnsureFreshSession = ensureFreshSession;
  window.SHG_USER_EMAILS = Object.fromEntries(
    Object.entries(USER_NAMES).map(([email, name]) => [name, email]),
  );

  window.shgInvokeFunction = async (functionName, payload) => {
    const activeSession = await ensureFreshSession(60 * 1000).catch(() => null);
    const accessToken = activeSession?.access_token;
    if (!accessToken || !sessionIsFresh(activeSession)) {
      throw new Error('The connection is temporarily unavailable. Please try again when you are online.');
    }
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || 'The notification could not be sent.');
    }
    return data;
  };

  window.shgInvokeFunctionFormData = async (functionName, formData) => {
    const activeSession = await ensureFreshSession(60 * 1000).catch(() => null);
    const accessToken = activeSession?.access_token;
    if (!accessToken || !sessionIsFresh(activeSession)) {
      throw new Error('The connection is temporarily unavailable. Please try again when you are online.');
    }
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.message || 'The Voice Memo could not be processed.');
    }
    return data;
  };

  async function authRequest(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.msg || data.message || data.error_description || 'Authentication failed.');
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('The authentication service did not respond in time. Please try again.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function showError(message = '') {
    const element = document.getElementById('authError');
    element.textContent = message;
    element.classList.toggle('hidden', !message);
  }

  function setBusy(button, busy, busyText) {
    button.disabled = busy;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = busy ? busyText : button.dataset.label;
  }

  async function sendOtp(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) throw new Error('Enter a valid email address.');
    await authRequest('otp', { email: normalized, create_user: false });
    pendingEmail = normalized;
    document.getElementById('authEmailForm').classList.add('hidden');
    document.getElementById('authOtpForm').classList.remove('hidden');
    document.getElementById('authMessage').textContent = `We sent an 8-digit verification code to ${normalized}.`;
    document.getElementById('authOtp').focus();
  }

  function initAuth(forceLogin = false) {
    const gate = document.getElementById('authGate');
    if (!AUTH_REQUIRED || (session && !forceLogin)) {
      gate.classList.add('hidden');
      document.body.classList.remove('auth-locked');
      return;
    }
    gate.classList.remove('hidden');
    document.body.classList.add('auth-locked');
    if (authHandlersBound) return;
    authHandlersBound = true;

    document.getElementById('authEmailForm').addEventListener('submit', async event => {
      event.preventDefault();
      showError();
      const button = document.getElementById('sendOtpBtn');
      setBusy(button, true, 'Sending…');
      try {
        await sendOtp(document.getElementById('authEmail').value);
      } catch (error) {
        showError(error.message);
      } finally {
        setBusy(button, false);
      }
    });

    document.getElementById('authOtpForm').addEventListener('submit', async event => {
      event.preventDefault();
      showError();
      const button = document.getElementById('verifyOtpBtn');
      const token = document.getElementById('authOtp').value.replace(/\D/g, '');
      if (token.length !== 8) {
        showError('Enter the complete 8-digit code.');
        return;
      }
      setBusy(button, true, 'Verifying…');
      try {
        const data = await authRequest('verify', { email: pendingEmail, token, type: 'email' });
        storeSession(data);
        localStorage.setItem('shg-auth-login-email', pendingEmail);
        location.reload();
      } catch (error) {
        showError(error.message);
      } finally {
        setBusy(button, false);
      }
    });

    document.getElementById('resendOtpBtn').addEventListener('click', async () => {
      showError();
      const button = document.getElementById('resendOtpBtn');
      setBusy(button, true, 'Sending…');
      try {
        await sendOtp(pendingEmail);
        document.getElementById('authMessage').textContent = `A new 8-digit code was sent to ${pendingEmail}.`;
      } catch (error) {
        showError(error.message);
      } finally {
        setBusy(button, false);
      }
    });

    document.getElementById('changeAuthEmail').addEventListener('click', () => {
      pendingEmail = '';
      showError();
      document.getElementById('authOtp').value = '';
      document.getElementById('authOtpForm').classList.add('hidden');
      document.getElementById('authEmailForm').classList.remove('hidden');
      document.getElementById('authMessage').textContent = 'Enter your company email and we will send you an 8-digit verification code.';
      document.getElementById('authEmail').focus();
    });
  }

  window.shgLogout = async () => {
    const accessToken = session?.access_token || readStoredSession()?.access_token;
    if (accessToken) {
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('shg-auth-login-email');
    localStorage.removeItem('shg-last-workspace-state');
    sessionStorage.removeItem('shg.impersonate');
    window.SHG_AUTH_USER_EMAIL = '';
    window.SHG_AUTH_USER_NAME = '';
    location.reload();
  };

  window.shgShowLogin = ({ resetSession = false } = {}) => {
    if (resetSession) {
      session = null;
      refreshPromise = null;
      clearTimeout(refreshTimer);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('shg-auth-login-email');
      updateAuthIdentity(null);
    }
    initAuth(true);
  };

  window.addEventListener('online', () => {
    ensureFreshSession(REFRESH_EARLY_MS).catch(() => {});
  });
  window.addEventListener('storage', event => {
    if (event.key !== SESSION_KEY) return;
    session = readStoredSession();
    updateAuthIdentity(session);
    scheduleRefresh();
  });
  scheduleRefresh();
  // Cloudflare or a warm browser cache may execute this file after
  // DOMContentLoaded. In that case, waiting for an event which has already
  // fired leaves the application shell visible without either data or login.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth, { once: true });
  } else {
    initAuth();
  }
})();
