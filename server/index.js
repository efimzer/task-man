import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 8787;
const DATA_FILE = process.env.TODO_SYNC_DB || join(process.cwd(), 'server', 'storage.json');
const SESSION_COOKIE = process.env.TODO_SESSION_COOKIE || 'todo_session';
const SESSION_TTL = Number(process.env.TODO_SESSION_TTL || 1000 * 60 * 60 * 24 * 30);

const PRIMARY_USER_EMAIL = 'efimzer@gmail.com';
const PRIMARY_PASSWORD = 'efimzer008';
const BASIC_TOKEN = Buffer.from(`${PRIMARY_USER_EMAIL}:${PRIMARY_PASSWORD}`).toString('base64');

mkdirSync(dirname(DATA_FILE), { recursive: true });

let state = {
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

try {
  const raw = readFileSync(DATA_FILE, 'utf8');
  const existing = JSON.parse(raw);
  if (existing?.state) {
    state = existing.state;
  }
} catch (error) {
  state.meta.updatedAt = Date.now();
}

async function persist() {
  await writeFile(DATA_FILE, JSON.stringify({ state }, null, 2), 'utf8');
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (authorized(req)) {
    res.cookie(SESSION_COOKIE, PRIMARY_USER_EMAIL, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: SESSION_TTL
    });
    return next();
  }

  if (hasBasicHeader(req)) {
    res.cookie(SESSION_COOKIE, PRIMARY_USER_EMAIL, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: SESSION_TTL
    });
    req.cookies[SESSION_COOKIE] = PRIMARY_USER_EMAIL;
    return next();
  }

  if (req.path === '/api/auth/login' || req.path === '/api/auth/me') {
    return next();
  }

  if (req.path.startsWith('/web') || req.path === '/') {
    res.redirect('/auth/');
    return;
  }

  next();
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
app.use('/web', express.static(join(rootDir, 'web')));
app.use('/scripts', express.static(join(rootDir, 'scripts')));
app.use('/styles', express.static(join(rootDir, 'styles')));
app.use('/icons', express.static(join(rootDir, 'icons')));
app.use('/auth', (req, res) => {
  res.status(401).send('Authentication required');
});
app.get('/', (req, res) => res.redirect('/web/'));

function hasBasicHeader(req) {
  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  return scheme === 'Basic' && encoded === BASIC_TOKEN;
}

function authorized(req) {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie === PRIMARY_USER_EMAIL) {
    return true;
  }
  return hasBasicHeader(req);
}

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (email !== PRIMARY_USER_EMAIL) {
    res.status(403).json({ error: 'FORBIDDEN' });
    return;
  }
  if (password !== PRIMARY_PASSWORD) {
    res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    return;
  }
  res.cookie(SESSION_COOKIE, PRIMARY_USER_EMAIL, {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    maxAge: SESSION_TTL
  });
  res.json({ ok: true, user: { email: PRIMARY_USER_EMAIL } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (authorized(req)) {
    res.json({ authenticated: true, user: { email: PRIMARY_USER_EMAIL } });
    return;
  }
  res.json({ authenticated: false });
});

app.get('/state/:userId?', (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  res.json(state);
});

app.put('/state/:userId?', async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }
  const payload = req.body?.state;
  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'INVALID_STATE' });
    return;
  }
  state = payload;
  await persist();
  res.json({ ok: true, meta: state.meta ?? null });
});

app.listen(PORT, () => {
  console.log(`Todo sync server is running on port ${PORT}`);
});
