const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function validateCredentials(body) {
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';
  const errors = {};

  if (!email || !EMAIL_REGEX.test(email)) {
    errors.email = 'Введите корректный email';
  }

  if (password.length < 6) {
    errors.password = 'Пароль должен содержать минимум 6 символов';
  }

  return { email, password, errors };
}
