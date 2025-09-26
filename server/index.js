import express from 'express';
import cors from 'cors';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

const PORT = process.env.PORT || 8787;
const DATA_FILE = process.env.TODO_SYNC_DB || join(process.cwd(), 'server', 'storage.json');
const AUTH_TOKEN = process.env.TODO_SYNC_TOKEN || null;

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const webDir = join(rootDir, 'web');
const scriptsDir = join(rootDir, 'scripts');
const stylesDir = join(rootDir, 'styles');
const iconsDir = join(rootDir, 'icons');

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
app.use('/web', express.static(webDir));
app.use('/scripts', express.static(scriptsDir));
app.use('/styles', express.static(stylesDir));
app.use('/icons', express.static(iconsDir));
app.get('/', (req, res) => {
  res.redirect('/web/');
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

function isAuthorized(req, res) {
  if (!AUTH_TOKEN) {
    return true;
  }

  const provided = extractToken(req);
  if (provided && provided === AUTH_TOKEN) {
    return true;
  }

  res.status(401).json({ error: 'UNAUTHORIZED' });
  return false;
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

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/state/:userId', async (req, res) => {
  if (!isAuthorized(req, res)) {
    return;
  }
  const { userId } = req.params;
  await db.read();
  const record = db.data.states[userId];
  if (!record) {
    res.status(404).json({ error: 'STATE_NOT_FOUND' });
    return;
  }
  res.json(record);
});

app.put('/state/:userId', async (req, res) => {
  if (!isAuthorized(req, res)) {
    return;
  }
  const { userId } = req.params;
  const payload = req.body?.state;

  if (!payload || typeof payload !== 'object') {
    res.status(400).json({ error: 'INVALID_STATE' });
    return;
  }

  await db.read();
  const nextState = JSON.parse(JSON.stringify(payload));
  const existing = db.data.states[userId];
  nextState.meta = ensureMeta(nextState, existing);

  db.data.states[userId] = nextState;
  await db.write();

  res.json({ ok: true, meta: nextState.meta });
});

app.listen(PORT, () => {
  console.log(`Todo sync server is running on port ${PORT}`);
});
