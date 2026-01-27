import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserService } from './services/user-service.js';
import { createSessionService } from './services/session-service.js';
import { createStateService } from './services/state-service.js';
import { createAuthHelpers } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createStateRouter } from './routes/state.js';
import { createDebugRouter } from './routes/debug.js';
import { createPreviewRouter } from './routes/preview.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

export function createServerApp({ config, collections }) {
  const services = {
    userService: createUserService(collections.users),
    sessionService: createSessionService({
      collection: collections.sessions,
      sessionTtl: config.sessionTtl
    }),
    stateService: createStateService(collections.states)
  };

  const authHelpers = createAuthHelpers({
    sessionService: services.sessionService,
    cookieName: config.sessionCookie
  });

  const app = express();
  const authRouter = createAuthRouter({
    userService: services.userService,
    sessionService: services.sessionService,
    stateService: services.stateService,
    authHelpers,
    config
  });
  const stateRouter = createStateRouter({
    authHelpers,
    stateService: services.stateService
  });
  const debugRouter = createDebugRouter({
    userService: services.userService,
    sessionService: services.sessionService,
    stateService: services.stateService
  });
  const previewRouter = createPreviewRouter({
    authHelpers
  });

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

  app.all(['/auth', '/auth/*'], (req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.use('/web', express.static(join(rootDir, 'web')));
  app.use('/scripts', express.static(join(rootDir, 'scripts')));
  app.use('/styles', express.static(join(rootDir, 'styles')));
  app.use('/icons', express.static(join(rootDir, 'icons')));

  app.get('/', (req, res) => {
    res.redirect('/web/');
  });

  app.use('/', express.static(rootDir));

  app.use('/api/auth', authRouter);
  app.use('/web/api/auth', authRouter);

  app.use('/api', previewRouter);
  app.use('/web/api', previewRouter);

  app.use('/', stateRouter);
  app.use('/web', stateRouter);

  app.use('/', debugRouter);
  app.use('/web', debugRouter);

  app.get(['/health', '/web/health'], (req, res) => {
    res.json({
      ok: true,
      version: '1.0.6-mongodb',
      cookieSecure: config.secureCookies,
      nodeEnv: config.nodeEnv,
      dbConnected: true,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nDisallow: /');
  });

  app.use((req, res) => {
    res.status(404).sendFile(join(rootDir, 'web/404.html'));
  });

  return {
    app,
    services,
    authHelpers
  };
}
