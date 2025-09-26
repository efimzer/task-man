const elements = {
  form: document.getElementById('authForm'),
  tabLogin: document.getElementById('tabLogin'),
  tabRegister: document.getElementById('tabRegister'),
  confirmWrapper: document.getElementById('confirmWrapper'),
  confirmInput: document.getElementById('confirmPassword'),
  emailInput: document.getElementById('email'),
  passwordInput: document.getElementById('password'),
  submitButton: document.getElementById('submitButton'),
  errorMessage: document.getElementById('errorMessage'),
  successMessage: document.getElementById('successMessage'),
  logoutButton: document.getElementById('logoutButton'),
};

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
  elements.confirmWrapper.classList.toggle('hidden', mode !== 'register');
  elements.confirmInput.required = mode === 'register';
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

  if (mode === 'register') {
    const confirmPassword = elements.confirmInput.value;
    if (password !== confirmPassword) {
      elements.errorMessage.textContent = 'Пароли не совпадают';
      return;
    }
  }

  elements.submitButton.disabled = true;
  elements.submitButton.textContent = 'Подождите…';

  try {
    await request(MODES[mode].endpoint, { email, password });
    elements.successMessage.textContent = mode === 'login'
      ? 'Вы успешно вошли'
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
      elements.successMessage.textContent = `Вы вошли как ${data.user.email}`;
      elements.logoutButton.classList.remove('hidden');
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
    window.location.reload();
  } catch (error) {
    console.warn('Logout failed', error);
  }
}

elements.form.addEventListener('submit', handleSubmit);
elements.tabLogin.addEventListener('click', () => setMode('login'));
elements.tabRegister.addEventListener('click', () => setMode('register'));
elements.logoutButton.addEventListener('click', handleLogout);

document.addEventListener('DOMContentLoaded', async () => {
  const loggedIn = await checkSession();
  if (!loggedIn) {
    setMode('login');
  }
});
