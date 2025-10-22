import { Router } from 'express';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { validateCredentials, normalizeEmail } from '../utils/validation.js';
import { attachSessionCookie, clearSessionCookie } from '../utils/cookies.js';

export function createAuthRouter({
  userService,
  sessionService,
  stateService,
  authHelpers,
  config
}) {
  const router = Router();

  router.post('/register', asyncHandler(async (req, res) => {
    const { email, password, errors } = validateCredentials(req.body);
    if (Object.keys(errors).length) {
      console.log(`[REGISTER ERROR] Validation failed for ${email}:`, errors);
      res.status(400).json({ error: 'VALIDATION_ERROR', details: errors });
      return;
    }

    const existingUser = await userService.findByEmail(email);
    if (existingUser) {
      console.log(`[REGISTER ERROR] Email already exists: ${email}`);
      res.status(409).json({ error: 'EMAIL_EXISTS' });
      return;
    }

    console.log(`[REGISTER] Creating new user: ${email}`);

    const credential = hashPassword(password);
    await userService.createUser({
      email,
      salt: credential.salt,
      hash: credential.hash
    });

    await stateService.ensureInitialized(email);

    const token = await sessionService.issue(email);
    const cookieOptions = attachSessionCookie(res, config.sessionCookie, token, {
      secure: config.secureCookies,
      maxAge: config.sessionTtl
    });

    console.log(`[REGISTER SUCCESS] User created: ${email}`, cookieOptions);

    res.json({
      ok: true,
      token,
      user: { email }
    });
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    console.log(`[LOGIN] Attempt for ${email}`);

    const user = await userService.findByEmail(email);
    if (!user) {
      const emails = await userService.listEmails();
      console.log(`[LOGIN ERROR] User not found: ${email}. Available users: ${emails.join(', ')}`);
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    if (!verifyPassword(password, user)) {
      console.log(`[LOGIN ERROR] Invalid password for ${email}`);
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    await stateService.ensureInitialized(email);

    const token = await sessionService.issue(email);
    const cookieOptions = attachSessionCookie(res, config.sessionCookie, token, {
      secure: config.secureCookies,
      maxAge: config.sessionTtl
    });

    console.log(`[LOGIN SUCCESS] ${email}`, cookieOptions);

    res.json({ ok: true, token, user: { email } });
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    const session = await authHelpers.resolveSession(req);
    if (session) {
      await sessionService.revoke(session.token);
    }

    const cookieOptions = clearSessionCookie(res, config.sessionCookie, {
      secure: config.secureCookies
    });

    console.log('[LOGOUT] Session cleared', cookieOptions);

    res.json({ ok: true });
  }));

  router.post('/password', asyncHandler(async (req, res) => {
    const session = await authHelpers.resolveSession(req);
    if (!session) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }

    const email = session.email;
    const oldPassword = req.body?.oldPassword || req.body?.currentPassword;
    const newPassword = req.body?.newPassword || req.body?.password;

    console.log(`[PASSWORD CHANGE] Attempt for ${email}`);

    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: 'MISSING_FIELDS', message: 'Укажите старый и новый пароль' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'INVALID_PASSWORD', message: 'Новый пароль должен содержать минимум 6 символов' });
      return;
    }

    const user = await userService.findByEmail(email);
    if (!user) {
      res.status(404).json({ error: 'USER_NOT_FOUND' });
      return;
    }

    if (!verifyPassword(oldPassword, user)) {
      console.log(`[PASSWORD CHANGE ERROR] Invalid old password for ${email}`);
      res.status(401).json({ error: 'INVALID_PASSWORD', message: 'Неверный текущий пароль' });
      return;
    }

    const credential = hashPassword(newPassword);
    await userService.updatePassword(email, credential);

    console.log(`[PASSWORD CHANGE SUCCESS] Password changed for ${email}`);

    res.json({ ok: true, message: 'Пароль успешно изменён' });
  }));

  router.get('/me', asyncHandler(async (req, res) => {
    const session = await authHelpers.resolveSession(req);
    if (!session) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, user: { email: session.email } });
  }));

  return router;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      console.error('[AUTH ROUTE ERROR]', error);
      next(error);
    });
  };
}
