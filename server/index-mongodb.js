import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { MongoClient } from 'mongodb';

const PORT = process.env.PORT || 8787;
const SESSION_TTL = Number(process.env.TODO_SESSION_TTL) || 1000 * 60 * 60 * 24 * 30; // 30 days
const SESSION_COOKIE = process.env.TODO_SESSION_COOKIE || 'todo_token';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI environment variable is required!');
  process.exit(1);
}

// MongoDB collections
let db = null;
let usersCollection = null;
let sessionsCollection = null;
let statesCollection = null;

async function connectDB() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    
    db = client.db('todo_app');
    usersCollection = db.collection('users');
    sessionsCollection = db.collection('sessions');
    statesCollection = db.collection('states');
    
    // Создать индексы для быстрого поиска
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await sessionsCollection.createIndex({ token: 1 }, { unique: true });
    await sessionsCollection.createIndex({ email: 1 });
    await sessionsCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: SESSION_TTL / 1000 });
    await statesCollection.createIndex({ email: 1 }, { unique: true });
    
    console.log('✅ Connected to MongoDB successfully');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

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

async function issueToken(email) {
  const token = randomBytes(32).toString('hex');
  await sessionsCollection.insertOne({
    token,
    email,
    createdAt: new Date()
  });
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

async function cleanupExpiredSessions() {
  // MongoDB TTL index автоматически удаляет старые сессии
  // Но можно добавить дополнительную очистку
  if (SESSION_TTL) {
    const expiredBefore = new Date(Date.now() - SESSION_TTL);
    const result = await sessionsCollection.deleteMany({
      createdAt: { $lt: expiredBefore }
    });
    if (result.deletedCount > 0) {
      console.log(`[CLEANUP] Removed ${result.deletedCount} expired sessions`);
    }
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

async function resolveSession(req) {
  const token = extractToken(req);
  if (!token) {
    return null;
  }
  
  const session = await sessionsCollection.findOne({ token });
  if (!session) {
    return null;
  }
  
  // Проверить не истекла ли сессия
  if (SESSION_TTL) {
    const age = Date.now() - session.createdAt.getTime();
    if (age > SESSION_TTL) {
      await sessionsCollection.deleteOne({ token });
      return null;
    }
  }
  
  return { token, email: session.email };
}

async function requireAuth(req, res, next) {
  const resolved = await resolveSession(req);
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

async function getStateForUser(email) {
  let state = await statesCollection.findOne({ email });
  
  if (!state) {
    // Создать дефолтное состояние для нового пользователя
    const newState = defaultState();
    await statesCollection.insertOne({
      email,
      ...newState
    });
    return newState;
  }
  
  // Убрать _id и email из ответа
  const { _id, email: _, ...stateData } = state;
  return stateData;
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
app.use('/web', express.static(join(rootDir, 'web')));
app.use('/scripts', express.static(join(rootDir, 'scripts')));
app.use('/styles', express.static(join(rootDir, 'styles')));
app.use('/icons', express.static(join(rootDir, 'icons')));
app.use('/', express.static(rootDir));

app.get('/health', (req, res) => {
  res.json({ 
    ok: true, 
    version: '1.0.6-mongodb',
    cookieSecure: COOKIE_SECURE,
    nodeEnv: process.env.NODE_ENV,
    dbConnected: db !== null,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/debug/stats', async (req, res) => {
  try {
    const userCount = await usersCollection.countDocuments();
    const sessionCount = await sessionsCollection.countDocuments();
    const stateCount = await statesCollection.countDocuments();
    
    const users = await usersCollection.find({}, { projection: { email: 1, _id: 0 } }).toArray();
    const states = await statesCollection.find({}, { projection: { email: 1, _id: 0 } }).toArray();
    
    res.json({
      users: userCount,
      sessions: sessionCount,
      states: stateCount,
      userEmails: users.map(u => u.email),
      stateEmails: states.map(s => s.email)
    });
  } catch (error) {
    console.error('[DEBUG STATS ERROR]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/debug/user/:email', async (req, res) => {
  try {
    const email = normalizeEmail(req.params.email);
    const user = await usersCollection.findOne({ email }, { projection: { hash: 0, salt: 0 } });
    
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    
    const state = await statesCollection.findOne({ email });
    const sessions = await sessionsCollection.find({ email }).toArray();
    
    res.json({
      email: user.email,
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      activeSessions: sessions.length,
      sessions: sessions.map(s => ({
        token: s.token.substring(0, 8) + '...',
        createdAt: s.createdAt.toISOString()
      })),
      state: {
        folders: state?.folders?.length || 0,
        tasks: state?.tasks?.length || 0,
        archivedTasks: state?.archivedTasks?.length || 0,
        lastUpdate: state?.meta?.updatedAt ? new Date(state.meta.updatedAt).toISOString() : null
      }
    });
  } catch (error) {
    console.error('[DEBUG USER ERROR]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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
  try {
    const { email, password, errors } = validateCredentials(req.body);
    
    if (Object.keys(errors).length) {
      console.log(`[REGISTER ERROR] Validation failed for ${email}:`, errors);
      res.status(400).json({ error: 'VALIDATION_ERROR', details: errors });
      return;
    }
    
    // Проверить существует ли пользователь
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      console.log(`[REGISTER ERROR] Email already exists: ${email}`);
      res.status(409).json({ error: 'EMAIL_EXISTS' });
      return;
    }
    
    console.log(`[REGISTER] Creating new user: ${email}`);
    
    const credential = hashPassword(password);
    await usersCollection.insertOne({
      email,
      salt: credential.salt,
      hash: credential.hash,
      createdAt: Date.now()
    });
    
    const token = await issueToken(email);
    attachSessionCookie(res, token);
    
    // Создать дефолтное состояние
    const initialState = defaultState();
    await statesCollection.insertOne({
      email,
      ...initialState
    });
    
    console.log(`[REGISTER SUCCESS] User created: ${email}`);
    
    res.json({
      ok: true,
      token,
      user: { email }
    });
  } catch (error) {
    console.error('[REGISTER ERROR]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    
    console.log(`[LOGIN] Attempt for ${email}`);
    
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      const allUsers = await usersCollection.find({}, { projection: { email: 1 } }).toArray();
      console.log(`[LOGIN ERROR] User not found: ${email}. Available users: ${allUsers.map(u => u.email).join(', ')}`);
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }
    
    if (!verifyPassword(password, user)) {
      console.log(`[LOGIN ERROR] Invalid password for ${email}`);
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }
    
    const token = await issueToken(email);
    attachSessionCookie(res, token);
    
    const stateExists = await statesCollection.findOne({ email });
    console.log(`[LOGIN SUCCESS] ${email}, state exists: ${!!stateExists}`);
    
    res.json({ ok: true, token, user: { email } });
  } catch (error) {
    console.error('[LOGIN ERROR]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const resolved = await resolveSession(req);
    if (resolved) {
      await sessionsCollection.deleteOne({ token: resolved.token });
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
  } catch (error) {
    console.error('[LOGOUT ERROR]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const resolved = await resolveSession(req);
    if (!resolved) {
      res.json({ authenticated: false });
      return;
    }
    res.json({ authenticated: true, user: { email: resolved.email } });
  } catch (error) {
    console.error('[AUTH ME ERROR]', error);
    res.json({ authenticated: false });
  }
});

app.get('/state', requireAuth, async (req, res) => {
  try {
    const email = req.auth.email;
    const state = await getStateForUser(email);
    res.json(state);
  } catch (error) {
    console.error('[GET STATE ERROR]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/state', requireAuth, async (req, res) => {
  try {
    const email = req.auth.email;
    const payload = req.body?.state;
    
    if (!payload || typeof payload !== 'object') {
      console.log(`[STATE UPDATE ERROR] Invalid state from ${email}`);
      res.status(400).json({ error: 'INVALID_STATE' });
      return;
    }
    
    console.log(`[STATE UPDATE] Updating state for ${email}, folders: ${payload.folders?.length || 0}, tasks: ${payload.tasks?.length || 0}`);
    
    // Обновить состояние (upsert)
    await statesCollection.updateOne(
      { email },
      { $set: { ...payload, email } },
      { upsert: true }
    );
    
    console.log(`[STATE UPDATE SUCCESS] State saved for ${email}`);
    
    res.json({ ok: true, meta: payload.meta ?? null });
  } catch (error) {
    console.error('[STATE UPDATE ERROR]', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Периодическая очистка старых сессий
setInterval(() => {
  cleanupExpiredSessions().catch(err => {
    console.error('[CLEANUP ERROR]', err);
  });
}, 60 * 60 * 1000); // Каждый час

// Запуск сервера
await connectDB();

app.listen(PORT, () => {
  console.log(`✅ Todo sync server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
});
