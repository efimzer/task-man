import express from 'express';
import cors from 'cors';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const PORT = process.env.PORT || 8787;
const DATA_FILE = process.env.TODO_SYNC_DB || join(process.cwd(), 'server', 'storage.json');
mkdirSync(dirname(DATA_FILE), { recursive: true });

const BASIC_AUTH_USERNAME = process.env.BASIC_AUTH_USERNAME || '';
const BASIC_AUTH_PASSWORD = process.env.BASIC_AUTH_PASSWORD || '';

const normalizeKey = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const DEFAULT_STATE_KEY = normalizeKey(process.env.TODO_STATE_KEY) || 'owner';
const DEFAULT_ALIASES = ['efimzer@gmail.com', 'shared'].map(normalizeKey).filter(Boolean);
const EXTRA_ALIASES = (process.env.TODO_STATE_ALIASES || '')
  .split(',')
  .map(normalizeKey)
  .filter(Boolean);
const STATE_ALIASES = Array.from(new Set([DEFAULT_STATE_KEY, ...DEFAULT_ALIASES, ...EXTRA_ALIASES]));

const db = new Low(new JSONFile(DATA_FILE), { states: {} });
await db.read();
if (!db.data) {
  db.data = { states: {} };
}
if (!db.data.states) {
  db.data.states = {};
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

function requireBasicAuth(req, res, next) {
  if (!BASIC_AUTH_USERNAME) {
    req.authUser = null;
    return next();
  }

  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    try {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const [user = '', pass = ''] = decoded.split(':');
      if (user === BASIC_AUTH_USERNAME && pass === BASIC_AUTH_PASSWORD) {
        req.authUser = normalizeKey(user);
        return next();
      }
    } catch (error) {
      console.warn('Basic auth decode failed', error);
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="To Do"');
  res.status(401).send('Authentication required');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const webDir = join(rootDir, 'web');
const scriptsDir = join(rootDir, 'scripts');
const stylesDir = join(rootDir, 'styles');
const iconsDir = join(rootDir, 'icons');
const authDir = join(webDir, 'auth');

app.use(requireBasicAuth);
app.use('/web', express.static(webDir));
app.use('/scripts', express.static(scriptsDir));
app.use('/styles', express.static(stylesDir));
app.use('/icons', express.static(iconsDir));
app.use('/auth', express.static(authDir));

app.get('/', (req, res) => {
  res.redirect('/web/');
});

function resolveStateKey(req, paramUserId) {
  const fromAuth = normalizeKey(req.authUser);
  if (fromAuth) {
    return fromAuth;
  }
  const fromParam = normalizeKey(paramUserId);
  if (fromParam) {
    return fromParam;
  }
  return DEFAULT_STATE_KEY;
}

function ensurePersistedState(key, state) {
  const payload = JSON.parse(JSON.stringify(state));
  const targets = new Set([key, DEFAULT_STATE_KEY, ...STATE_ALIASES]);
  targets.forEach((alias) => {
    if (alias) {
      db.data.states[alias] = payload;
    }
  });
}

app.get('/state/:userId', async (req, res) => {
  const key = resolveStateKey(req, req.params.userId);
  let record = db.data.states[key];
  if (!record) {
    for (const alias of STATE_ALIASES) {
      if (db.data.states[alias]) {
        record = db.data.states[alias];
        ensurePersistedState(key, record);
        await db.write();
        break;
      }
    }
  }

  if (!record) {
    res.status(404).json({ error: 'STATE_NOT_FOUND' });
    return;
  }

  res.json(record);
});

app.put('/state/:userId', async (req, res) => {
  const key = resolveStateKey(req, req.params.userId);
  const payload = req.body?.state;

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'INVALID_STATE' });
    return;
  }

  ensurePersistedState(key, payload);
  await db.write();

  res.json({ ok: true, meta: db.data.states[key]?.meta ?? null });
});

app.listen(PORT, () => {
  console.log(`Todo sync server is running on port ${PORT}`);
});
