(() => {
  const SUPABASE_URL = 'https://ewjalucwaeotamodlajs.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_XeGECEGDBFj1b0z-zyb2kQ_SdlTL2tG';
  const SESSION_KEY = 'shg-supabase-session';
  const AUTH_REQUIRED = !['127.0.0.1', 'localhost'].includes(location.hostname) || new URLSearchParams(location.search).get('auth') === '1';
  const USER_NAMES = {
    'agapi@shd.global': 'Agapi Zoannou',
    'alexandros@shd.global': 'Alexandros',
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

  function readSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!session?.access_token || !session?.user?.email) return null;
      if (session.expires_at && session.expires_at * 1000 <= Date.now()) return null;
      return session;
    } catch {
      return null;
    }
  }

  let session = readSession();
  let pendingEmail = '';
  window.SHG_AUTH_USER_EMAIL = session?.user?.email?.toLowerCase() || '';
  window.SHG_AUTH_USER_NAME = USER_NAMES[window.SHG_AUTH_USER_EMAIL] || '';
  window.SHG_AUTH_REQUIRED = AUTH_REQUIRED;
  window.SHG_USER_EMAILS = Object.fromEntries(
    Object.entries(USER_NAMES).map(([email, name]) => [name, email]),
  );

  window.shgInvokeFunction = async (functionName, payload) => {
    const accessToken = readSession()?.access_token;
    if (!accessToken) throw new Error('Sign in is required to send notifications.');
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

  async function authRequest(path, body) {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.msg || data.message || data.error_description || 'Authentication failed.');
    return data;
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
    if (!USER_NAMES[normalized]) throw new Error('This email is not registered as an SHG Task Manager user.');
    await authRequest('otp', { email: normalized, create_user: false });
    pendingEmail = normalized;
    document.getElementById('authEmailForm').classList.add('hidden');
    document.getElementById('authOtpForm').classList.remove('hidden');
    document.getElementById('authMessage').textContent = `We sent an 8-digit verification code to ${normalized}.`;
    document.getElementById('authOtp').focus();
  }

  function initAuth() {
    const gate = document.getElementById('authGate');
    if (!AUTH_REQUIRED || session) {
      gate.classList.add('hidden');
      document.body.classList.remove('auth-locked');
      return;
    }
    gate.classList.remove('hidden');
    document.body.classList.add('auth-locked');

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
        localStorage.setItem(SESSION_KEY, JSON.stringify(data));
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
    const accessToken = readSession()?.access_token;
    if (accessToken) {
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('shg-auth-login-email');
    sessionStorage.removeItem('shg.impersonate');
    location.reload();
  };

  document.addEventListener('DOMContentLoaded', initAuth, { once: true });
})();
