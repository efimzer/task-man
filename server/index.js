import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PORT = process.env.PORT || 8787;
const DATA_FILE = process.env.TODO_SYNC_DB || join(process.cwd(), 'server', 'storage.json');
mkdirSync(dirname(DATA_FILE), { recursive: true });

const PRIMARY_USER_EMAIL = 'efimzer@gmail.com';
const PRIMARY_PASSWORD = 'efimzer008';
const BASIC_TOKEN = Buffer.from(`${PRIMARY_USER_EMAIL}:${PRIMARY_PASSWORD}`).toString('base64');

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
app.use('/web', express.static(join(rootDir, 'web')));
app.use('/scripts', express.static(join(rootDir, 'scripts')));
app.use('/styles', express.static(join(rootDir, 'styles')));
app.use('/icons', express.static(join(rootDir, 'icons')));
app.get('/', (req, res) => res.redirect('/web/'));

function authorized(req) {
  if (req.cookies?.todo_session === PRIMARY_USER_EMAIL) {
    return true;
  }
  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  return scheme === 'Basic' && encoded === BASIC_TOKEN;
}

app.use((req, res, next) => {
  if (authorized(req)) {
    res.set('Cache-Control', 'no-store');
    res.cookie('todo_session', PRIMARY_USER_EMAIL, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 1000 * 60 * 60 * 24 * 30
    });
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Todo"');
  res.status(401).send('Authentication required');
});

app.get('/state/:userId?', (req, res) => {
  res.json(state);
});

app.put('/state/:userId?', async (req, res) => {
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
