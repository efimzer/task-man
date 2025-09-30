import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync } from 'node:crypto';

const PORT = process.env.PORT || 8787;
const DATA_FILE = process.env.TODO_SYNC_DB || join(process.cwd(), 'server', 'storage.json');
const SESSION_TTL = Number(process.env.TODO_SESSION_TTL) || 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_COOKIE = process.env.TODO_SESSION_COOKIE || 'todo_token';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

mkdirSync(dirname(DATA_FILE), { recursive: true });

function defaultState() {
  return {
    meta: { version: 0, updatedAt: Date.now() },
    folders: [
      { id: 'all', name: 'Все' },
      { id: 'inbox', name: 'Основные' },
      { id: 'personal', name: 'Личное' },
      { id: 'archive', name: 'Архив' }
    ],
    tasks: [],
    archivedTasks: [],
    ui: { selectedFolderId: 'inbox', activeScreen: 'folders' }
  };
}

let data = {
  users: {},
  sessions: {},
  states: {},
  legacyState: null
};

try {
  const raw = readFileSync(DATA_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  
  // Миграция старой структуры (массив users) в новую (объект users)
  if (Array.isArray(parsed?.users)) {
    console.log('Migrating old storage format...');
    const oldUsers = parsed.users;
    const oldSessions = parsed.sessions ?? {};
    
    // Конвертируем users из массива в объект с ключами email
    const newUsers = {};
    const sessionMapping = {}; // userId -> email
    
    oldUsers.forEach(user => {
      const email = normalizeEmail(user.email);
      newUsers[email] = {
        email,
        salt: user.salt || randomBytes(16).toString('hex'), // если нет salt, создаем
        hash: user.passwordHash || user.hash, // поддерживаем оба поля
        createdAt: user.createdAt
      };
      sessionMapping[user.id] = email;
    });
    
    // Конвертируем sessions, заменяя userId на email
    const newSessions = {};
    Object.entries(oldSessions).forEach(([sessionId, session]) => {
      const email = sessionMapping[session.userId];
      if (email) {
        newSessions[sessionId] = {
          email,
          createdAt: session.createdAt || Date.now()
        };
      }
    });
    
    data = {
      users: newUsers,
      sessions: newSessions,
      states: parsed.states ?? {},
      legacyState: parsed.legacyState ?? null
    };
    
    // Сохраняем мигрированную структуру
    persist().then(() => {
      console.log('Migration completed successfully');
    }).catch(err => {
      console.error('Migration save failed:', err);
    });
  } else if (parsed?.users || parsed?.states) {
    // Новая структура
    data = {
      users: parsed.users ?? {},
      sessions: parsed.sessions ?? {},
      states: parsed.states ?? {},
      legacyState: parsed.legacyState ?? null
    };
  } else if (parsed?.state) {
    data.legacyState = parsed.state;
  }
} catch (error) {
  console.error('Failed to load storage:', error.message);
  // fresh storage — keep defaults
}

async function persist() {
  const snapshot = {
    users: data.users,
    sessions: data.sessions,
    states: data.states,
    legacyState: data.legacyState
  };
  
  try {
    // Создаем backup перед сохранением
    const backupFile = DATA_FILE + '.backup';
    try {
      const current = readFileSync(DATA_FILE, 'utf8');
      await writeFile(backupFile, current, 'utf8');
    } catch (e) {
      // Игнорируем, если файла еще не существует
    }
    
    await writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log(`[PERSIST] Saved data: ${Object.keys(data.users).length} users, ${Object.keys(data.states).length} states, ${Object.keys(data.sessions).length} sessions`);
  } catch (error) {
    console.error('[PERSIST ERROR]', error);
    throw error;
  }
}

// Периодическое сохранение каждые 5 минут
setInterval(async () => {
  try {
    await persist();
    console.log('[AUTO-SAVE] Data persisted successfully');
  } catch (error) {
    console.error('[AUTO-SAVE ERROR]', error);
  }
}, 5 * 60 * 1000);

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, { salt, hash }) {
  const candidate = hashPassword(password, salt).hash;
  return candidate === hash;
}

function issueToken(email) {
  const token = randomBytes(32).toString('hex');
  data.sessions[token] = {
    email,
    createdAt: Date.now()
  };
  return token;
}

function attachSessionCookie(res, token) {
  console.log(`[COOKIE] Setting cookie: ${SESSION_COOKIE}, secure: ${COOKIE_SECURE}, production: ${process.env.NODE_ENV === 'production'}`);
  
  const cookieOptions = {
    httpOnly: true,
    maxAge: SESSION_TTL || undefined
  };
  
  // В production (на HTTPS): sameSite='none', secure=true
  // В development: sameSite='lax', secure=false
  if (COOKIE_SECURE) {
    cookieOptions.sameSite = 'none';
    cookieOptions.secure = true;
  } else {
    cookieOptions.sameSite = 'lax';
    cookieOptions.secure = false;
  }
  
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  console.log(`[COOKIE] Cookie options:`, cookieOptions);
}

function cleanupExpiredSessions() {
  if (!SESSION_TTL) {
    return;
  }
  const now = Date.now();
  let changed = false;
  Object.entries(data.sessions).forEach(([token, session]) => {
    if (!session || now - Number(session.createdAt ?? 0) > SESSION_TTL) {
      delete data.sessions[token];
      changed = true;
    }
  });
  if (changed) {
    void persist();
  }
}

function extractToken(req) {
  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  const fromQuery = req.query?.token;
  if (typeof fromQuery === 'string' && fromQuery.trim()) {
    return fromQuery.trim();
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (cookieToken) {
    return cookieToken;
  }
  return null;
}

function resolveSession(req) {
  cleanupExpiredSessions();
  const token = extractToken(req);
  if (!token) {
    return null;
  }
  const session = data.sessions[token];
  if (!session) {
    return null;
  }
  return { token, email: session.email };
}

function requireAuth(req, res, next) {
  const resolved = resolveSession(req);
  if (!resolved) {
    if (req.accepts('html')) {
      res.redirect('/auth/');
      return;
    }
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  req.auth = resolved;
  res.set('Cache-Control', 'no-store');
  next();
}

function getStateForUser(email) {
  if (!data.states[email]) {
    let initial = data.legacyState ?? defaultState();
    if (data.legacyState) {
      initial = data.legacyState;
      data.legacyState = null;
      void persist();
    }
    data.states[email] = initial;
  }
  return data.states[email];
}

const app = express();
app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const authDir = join(rootDir, 'web/auth');
app.get('/auth', (req, res) => {
  res.sendFile(join(authDir, 'index.html'));
});
app.use('/auth', express.static(authDir));
app.use('/web', express.static(join(rootDir, 'web'))); // Убрали requireAuth
app.use('/scripts', express.static(join(rootDir, 'scripts'))); // Убрали requireAuth
app.use('/styles', express.static(join(rootDir, 'styles'))); // Убрали requireAuth
app.use('/icons', express.static(join(rootDir, 'icons')));
app.use('/', express.static(rootDir));

app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    version: '1.0.5',
    cookieSecure: COOKIE_SECURE,
    nodeEnv: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/debug/stats', (req, res) => {
  res.json({
    users: Object.keys(data.users).length,
    sessions: Object.keys(data.sessions).length,
    states: Object.keys(data.states).length,
    userEmails: Object.keys(data.users),
    stateEmails: Object.keys(data.states)
  });
});

function validateCredentials(body) {
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === 'string' ? body.password : '';
  const errors = {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    errors.email = 'Введите корректный email';
  }
  if (password.length < 6) {
    errors.password = 'Пароль должен содержать минимум 6 символов';
  }
  return { email, password, errors };
}

app.post('/api/auth/register', async (req, res) => {
  const { email, password, errors } = validateCredentials(req.body);
  if (Object.keys(errors).length) {
    console.log(`[REGISTER ERROR] Validation failed for ${email}:`, errors);
    res.status(400).json({ error: 'VALIDATION_ERROR', details: errors });
    return;
  }
  if (data.users[email]) {
    console.log(`[REGISTER ERROR] Email already exists: ${email}`);
    res.status(409).json({ error: 'EMAIL_EXISTS' });
    return;
  }

  console.log(`[REGISTER] Creating new user: ${email}`);
  
  const credential = hashPassword(password);
  data.users[email] = {
    email,
    salt: credential.salt,
    hash: credential.hash,
    createdAt: Date.now()
  };

  const token = issueToken(email);
  attachSessionCookie(res, token);
  if (!data.states[email]) {
    data.states[email] = data.legacyState ? data.legacyState : defaultState();
    data.legacyState = null;
    console.log(`[REGISTER] Created initial state for ${email}`);
  }

  await persist();
  console.log(`[REGISTER SUCCESS] User created: ${email}`);
  res.json({
    ok: true,
    token,
    user: { email }
  });
});

app.post('/api/auth/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  
  console.log(`[LOGIN] Attempt for ${email}`);
  const user = data.users[email];
  
  if (!user) {
    console.log(`[LOGIN ERROR] User not found: ${email}. Available users: ${Object.keys(data.users).join(', ')}`);
    res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    return;
  }
  
  if (!verifyPassword(password, user)) {
    console.log(`[LOGIN ERROR] Invalid password for ${email}`);
    res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    return;
  }

  const token = issueToken(email);
  attachSessionCookie(res, token);
  await persist();
  
  console.log(`[LOGIN SUCCESS] ${email}, state exists: ${!!data.states[email]}`);
  res.json({ ok: true, token, user: { email } });
});

app.post('/api/auth/logout', async (req, res) => {
  const resolved = resolveSession(req);
  if (resolved) {
    delete data.sessions[resolved.token];
    await persist();
  }
  
  const cookieOptions = {
    httpOnly: true,
    expires: new Date(0)
  };
  
  if (COOKIE_SECURE) {
    cookieOptions.sameSite = 'none';
    cookieOptions.secure = true;
  } else {
    cookieOptions.sameSite = 'lax';
    cookieOptions.secure = false;
  }
  
  res.cookie(SESSION_COOKIE, '', cookieOptions);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const resolved = resolveSession(req);
  if (!resolved) {
    res.json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, user: { email: resolved.email } });
});

app.get('/state', requireAuth, (req, res) => {
  const email = req.auth.email;
  const state = getStateForUser(email);
  res.json(state);
});

app.put('/state', requireAuth, async (req, res) => {
  const email = req.auth.email;
  const payload = req.body?.state;
  
  if (!payload || typeof payload !== 'object') {
    console.log(`[STATE UPDATE ERROR] Invalid state from ${email}`);
    res.status(400).json({ error: 'INVALID_STATE' });
    return;
  }
  
  console.log(`[STATE UPDATE] Updating state for ${email}, folders: ${payload.folders?.length || 0}, tasks: ${payload.tasks?.length || 0}`);
  
  data.states[email] = payload;
  await persist();
  
  console.log(`[STATE UPDATE SUCCESS] State saved for ${email}`);
  res.json({ ok: true, meta: payload.meta ?? null });
});

app.listen(PORT, () => {
  console.log(`Todo auth & sync server is running on port ${PORT}`);
});
