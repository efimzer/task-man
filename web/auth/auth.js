const elements = {
  form: document.getElementById('authForm'),
  tabLogin: document.getElementById('tabLogin'),
  tabRegister: document.getElementById('tabRegister'),
  emailInput: document.getElementById('email'),
  passwordInput: document.getElementById('password'),
  passwordToggle: document.getElementById('togglePassword'),
  submitButton: document.getElementById('submitButton'),
  errorMessage: document.getElementById('errorMessage'),
  successMessage: document.getElementById('successMessage'),
  logoutButton: document.getElementById('logoutButton'),
};

const ICON_EYE_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5.1 0-9.27 3.11-10.5 7C2.73 15.89 6.9 19 12 19s9.27-3.11 10.5-7C21.27 8.11 17.1 5 12 5Zm0 12c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5Zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>';
const ICON_EYE_CLOSED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.53 4.47 2.1 5.9l3.03 3.03A11.86 11.86 0 0 0 2 12c1.63 3.94 5.76 7 10 7 1.7 0 3.32-.33 4.77-.95l3.1 3.1 1.41-1.41L3.53 4.47Zm6.2 6.2 4.6 4.6A3.8 3.8 0 0 1 12 16a4 4 0 0 1-4-4c0-.54.11-1.05.31-1.53Zm2.27-5.67c2.13 0 4.18.56 5.94 1.58l-2.06 2.06a6.2 6.2 0 0 0-3.88-1.31c-1 0-1.96.22-2.84.62L8.74 6.66a12.5 12.5 0 0 1 3.26-.66Zm9.73 6.99c-.52-1.8-1.71-3.53-3.32-4.88l2.02-2.02-1.4-1.4-2.24 2.24A10.8 10.8 0 0 1 20.62 12a11.3 11.3 0 0 1-1.34 2.35l1.46 1.46a12.8 12.8 0 0 0 1.49-3.82Z"/></svg>';

const USER_ID_STORAGE_KEY = 'todoAuthUserId';

function persistUserId(user) {
  if (!user) {
    return;
  }
  const key = (user.email || user.id || '').toLowerCase();
  if (!key) {
    return;
  }
  try {
    localStorage.setItem(USER_ID_STORAGE_KEY, key);
  } catch (error) {
    console.warn('Auth: unable to persist user id', error);
  }
}

if (elements.passwordToggle) {
  elements.passwordToggle.innerHTML = ICON_EYE_OPEN;
}

const MODES = {
  login: {
    endpoint: '/api/auth/login',
    submitLabel: 'Войти'
  },
  register: {
    endpoint: '/api/auth/register',
    submitLabel: 'Создать аккаунт'
  }
};

let mode = 'login';
const redirectUrl = (() => {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  if (next && /^\//.test(next)) {
    return next;
  }
  return '/web/';
})();

function setMode(nextMode) {
  mode = nextMode;
  const config = MODES[mode];
  elements.submitButton.textContent = config.submitLabel;
  elements.passwordInput.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  elements.passwordInput.type = 'password';
  elements.passwordToggle.classList.remove('is-visible');
  elements.passwordToggle.setAttribute('aria-label', 'Показать пароль');
  elements.passwordToggle.setAttribute('aria-pressed', 'false');
  elements.passwordToggle.innerHTML = ICON_EYE_OPEN;
  elements.tabLogin.classList.toggle('is-active', mode === 'login');
  elements.tabRegister.classList.toggle('is-active', mode === 'register');
  elements.tabLogin.setAttribute('aria-selected', String(mode === 'login'));
  elements.tabRegister.setAttribute('aria-selected', String(mode === 'register'));
  clearMessages();
}

function clearMessages() {
  elements.errorMessage.textContent = '';
  elements.successMessage.textContent = '';
}

async function request(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data?.details ?? {};
    const message = data?.error === 'EMAIL_EXISTS'
      ? 'Такой email уже зарегистрирован'
      : data?.error === 'INVALID_CREDENTIALS'
        ? 'Неверный email или пароль'
        : Object.values(details)[0] ?? 'Не удалось выполнить запрос';
    throw new Error(message);
  }

  return data;
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessages();

  const email = elements.emailInput.value.trim();
  const password = elements.passwordInput.value;

  if (!email || !password) {
    elements.errorMessage.textContent = 'Введите email и пароль';
    return;
  }

  elements.submitButton.disabled = true;
  elements.submitButton.textContent = 'Подождите…';

  try {
    const result = await request(MODES[mode].endpoint, { email, password });
    persistUserId(result?.user);
    elements.successMessage.textContent = mode === 'login'
      ? ' '
      : 'Аккаунт создан, выполняется вход…';
    setTimeout(() => {
      window.location.href = redirectUrl;
    }, 500);
  } catch (error) {
    elements.errorMessage.textContent = error.message;
  } finally {
    elements.submitButton.disabled = false;
    elements.submitButton.textContent = MODES[mode].submitLabel;
  }
}

async function checkSession() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (data?.authenticated) {
      persistUserId(data.user);
      elements.logoutButton?.classList.remove('hidden');
      elements.submitButton.textContent = 'Перейти к задачам';
      elements.submitButton.addEventListener('click', (event) => {
        event.preventDefault();
        window.location.href = redirectUrl;
      }, { once: true });
      elements.form.querySelectorAll('input').forEach((input) => {
        input.disabled = true;
      });
      return true;
    }
  } catch (error) {
    console.warn('Auth status check failed', error);
  }
  return false;
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    try {
      localStorage.removeItem(USER_ID_STORAGE_KEY);
    } catch (error) {
      console.warn('Auth: unable to clear user id', error);
    }
    window.location.reload();
  } catch (error) {
    console.warn('Logout failed', error);
  }
}

elements.form.addEventListener('submit', handleSubmit);
elements.tabLogin.addEventListener('click', () => setMode('login'));
elements.tabRegister.addEventListener('click', () => setMode('register'));
elements.logoutButton?.addEventListener('click', handleLogout);
elements.passwordToggle.addEventListener('click', () => {
  const isVisible = elements.passwordInput.type === 'text';
  elements.passwordInput.type = isVisible ? 'password' : 'text';
  elements.passwordToggle.classList.toggle('is-visible', !isVisible);
  elements.passwordToggle.setAttribute('aria-label', isVisible ? 'Показать пароль' : 'Скрыть пароль');
  elements.passwordToggle.setAttribute('aria-pressed', String(!isVisible));
  elements.passwordToggle.innerHTML = isVisible ? ICON_EYE_OPEN : ICON_EYE_CLOSED;
});

document.addEventListener('DOMContentLoaded', async () => {
  const loggedIn = await checkSession();
  if (!loggedIn) {
    setMode('login');
  }
});
