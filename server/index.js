import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { join, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const PORT = process.env.PORT || 8787;
const DATA_FILE = process.env.TODO_SYNC_DB || join(process.cwd(), 'server', 'storage.json');
const DATA_DIR = dirname(DATA_FILE);
mkdirSync(DATA_DIR, { recursive: true });
const AUTH_TOKEN = process.env.TODO_SYNC_TOKEN || null;
const SESSION_COOKIE = process.env.TODO_SESSION_COOKIE || 'todo_session';
const SESSION_TTL_MS = Number(process.env.TODO_SESSION_TTL || 1000 * 60 * 60 * 24 * 7 * 4);
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const webDir = join(rootDir, 'web');
const scriptsDir = join(rootDir, 'scripts');
const stylesDir = join(rootDir, 'styles');
const iconsDir = join(rootDir, 'icons');
const authDir = join(webDir, 'auth');

const db = new Low(new JSONFile(DATA_FILE), { states: {}, users: [], sessions: {} });
await db.read();
if (!db.data) {
  db.data = { states: {}, users: [], sessions: {} };
}
if (!db.data.states) {
  db.data.states = {};
}
if (!db.data.users) {
  db.data.users = [];
}
if (!db.data.sessions) {
  db.data.sessions = {};
}

const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, origin ?? true);
    },
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

function cleanupExpiredSessions() {
  const now = Date.now();
  const sessionIds = Object.keys(db.data.sessions ?? {});
  let dirty = false;
  sessionIds.forEach((id) => {
    const record = db.data.sessions[id];
    if (!record || record.expiresAt <= now) {
      delete db.data.sessions[id];
      dirty = true;
    }
  });
  if (dirty) {
    db.write().catch((error) => {
      console.warn('Failed to cleanup sessions:', error);
    });
  }
}

cleanupExpiredSessions();
const sessionCleanupTimer = setInterval(cleanupExpiredSessions, 1000 * 60 * 30);
if (typeof sessionCleanupTimer.unref === 'function') {
  sessionCleanupTimer.unref();
}

function getUserSafe(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function findUserByEmail(email) {
  const normalized = email.trim().toLowerCase();
  return db.data.users.find((user) => user.email === normalized) ?? null;
}

function createSession(userId) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const session = {
    id,
    userId,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + SESSION_TTL_MS
  };
  db.data.sessions[id] = session;
  return session;
}

function touchSession(session) {
  if (!session) return;
  session.updatedAt = Date.now();
  session.expiresAt = session.updatedAt + SESSION_TTL_MS;
}

async function persist() {
  try {
    await db.write();
  } catch (error) {
    console.error('Failed to persist database:', error);
    throw error;
  }
}

function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    maxAge: SESSION_TTL_MS
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE
  });
}

app.use((req, res, next) => {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (!sessionId) {
    req.session = null;
    req.user = null;
    return next();
  }

  const session = db.data.sessions?.[sessionId];
  if (!session || session.expiresAt <= Date.now()) {
    if (session) {
      delete db.data.sessions[sessionId];
      persist().catch((error) => console.warn('Failed to prune expired session:', error));
    }
    req.session = null;
    req.user = null;
    return next();
  }

  const user = db.data.users.find((item) => item.id === session.userId);
  if (!user) {
    delete db.data.sessions[sessionId];
    persist().catch((error) => console.warn('Failed to cleanup orphan session:', error));
    req.session = null;
    req.user = null;
    return next();
  }

  touchSession(session);
  persist().catch((error) => console.warn('Failed to refresh session:', error));
  req.session = session;
  req.user = getUserSafe(user);
  next();
});

function requireSession(req, res, next) {
  if (req.user) {
    return next();
  }
  const acceptHeader = req.headers.accept || '';
  const wantsHtml = /text\/html|\*/i.test(acceptHeader);
  if (req.method === 'GET' && wantsHtml) {
    res.redirect(`/auth/?next=${encodeURIComponent(req.originalUrl || '/web/')}`);
    return;
  }
  res.status(401).json({ error: 'AUTH_REQUIRED' });
}

function hasToken(req) {
  if (!AUTH_TOKEN) {
    return false;
  }
  const provided = extractToken(req);
  return Boolean(provided && provided === AUTH_TOKEN);
}

function ensureAuthAllowed(req, res) {
  if (req.user) {
    return true;
  }
  if (hasToken(req)) {
    return true;
  }
  res.status(401).json({ error: 'UNAUTHORIZED' });
  return false;
}

function normalizeKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function resolveStateKey(req, paramUserId) {
  const emailKey = normalizeKey(req.user?.email);
  if (emailKey) {
    return emailKey;
  }

  const paramKey = normalizeKey(paramUserId);
  if (paramKey) {
    return paramKey;
  }

  return null;
}

app.use('/auth', express.static(authDir));
app.use('/web', requireSession, express.static(webDir));
app.use('/scripts', requireSession, express.static(scriptsDir));
app.use('/styles', requireSession, express.static(stylesDir));
app.use('/icons', requireSession, express.static(iconsDir));

app.get('/', (req, res) => {
  if (req.user) {
    res.redirect('/web/');
  } else {
    res.redirect('/auth/');
  }
});

function extractToken(req) {
  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }
  if (req.query?.token) {
    return req.query.token;
  }
  return null;
}

function ensureMeta(state, existing) {
  const currentVersion = Number.isFinite(existing?.meta?.version) ? existing.meta.version : 0;
  const nextVersion = Number.isFinite(state?.meta?.version) ? state.meta.version : currentVersion + 1;
  const updatedAt = Date.now();

  return {
    version: nextVersion,
    updatedAt
  };
}

function validateCredentials({ email, password }) {
  const errors = {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    errors.email = 'Введите корректный email';
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    errors.password = 'Минимальная длина пароля 6 символов';
  }
  return errors;
}

app.get('/api/auth/me', (req, res) => {
  if (!req.user) {
    res.json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, user: req.user });
});

app.post('/api/auth/register', async (req, res) => {
  cleanupExpiredSessions();
  const { email, password } = req.body ?? {};
  const validationErrors = validateCredentials({ email, password });
  if (Object.keys(validationErrors).length) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: validationErrors });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (findUserByEmail(normalizedEmail)) {
    res.status(409).json({ error: 'EMAIL_EXISTS' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    passwordHash,
    createdAt: Date.now()
  };

  db.data.users.push(newUser);
  const session = createSession(newUser.id);
  touchSession(session);
  await persist();
  setSessionCookie(res, session.id);

  res.status(201).json({ ok: true, user: getUserSafe(newUser) });
});

app.post('/api/auth/login', async (req, res) => {
  cleanupExpiredSessions();
  const { email, password } = req.body ?? {};
  const validationErrors = validateCredentials({ email, password });
  if (Object.keys(validationErrors).length) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: validationErrors });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existingUser = findUserByEmail(normalizedEmail);
  if (!existingUser) {
    res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    return;
  }

  const passwordOk = await bcrypt.compare(password, existingUser.passwordHash);
  if (!passwordOk) {
    res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    return;
  }

  const session = createSession(existingUser.id);
  touchSession(session);
  await persist();
  setSessionCookie(res, session.id);

  res.json({ ok: true, user: getUserSafe(existingUser) });
});

app.post('/api/auth/logout', async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId && db.data.sessions?.[sessionId]) {
    delete db.data.sessions[sessionId];
    await persist();
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/state/:userId', async (req, res) => {
  if (!ensureAuthAllowed(req, res)) {
    return;
  }
  const { userId } = req.params;
  const key = resolveStateKey(req, userId);
  if (!key) {
    res.status(400).json({ error: 'USER_ID_REQUIRED' });
    return;
  }

  let record = db.data.states[key];

  if (!record && req.user?.id) {
    const legacyKeys = [
      `user:${req.user.id}`,
      req.user.id,
      userId,
      'shared'
    ].map(normalizeKey).filter(Boolean);

    const found = legacyKeys.find((legacy) => legacy && db.data.states[legacy]);
    if (found) {
      record = db.data.states[found];
      db.data.states[key] = record;
      legacyKeys.forEach((legacy) => {
        if (legacy) {
          db.data.states[legacy] = record;
        }
      });
      await persist();
    }
  }

  if (!record) {
    res.status(404).json({ error: 'STATE_NOT_FOUND' });
    return;
  }
  res.json(record);
});

app.put('/state/:userId', async (req, res) => {
  if (!ensureAuthAllowed(req, res)) {
    return;
  }
  const { userId } = req.params;
  const key = resolveStateKey(req, userId);
  if (!key) {
    res.status(400).json({ error: 'USER_ID_REQUIRED' });
    return;
  }
  const payload = req.body?.state;

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'INVALID_STATE' });
    return;
  }

  const nextState = JSON.parse(JSON.stringify(payload));
  const existing = db.data.states[key];
  nextState.meta = ensureMeta(nextState, existing);

  db.data.states[key] = nextState;
  if (req.user?.id) {
    const legacyKeys = [
      `user:${req.user.id}`,
      req.user.id,
      userId,
      'shared'
    ].map(normalizeKey).filter(Boolean);
    legacyKeys.forEach((legacy) => {
      if (legacy) {
        db.data.states[legacy] = nextState;
      }
    });
  }
  await persist();

  res.json({ ok: true, meta: nextState.meta });
});

app.listen(PORT, () => {
  console.log(`Todo sync server is running on port ${PORT}`);
});
