const DEFAULT_PORT = 8787;
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function loadConfig(env = process.env) {
  const port = Number(env.PORT) || DEFAULT_PORT;
  const rawTtl = Number(env.TODO_SESSION_TTL);
  const sessionTtl = Number.isFinite(rawTtl) && rawTtl > 0 ? rawTtl : DEFAULT_SESSION_TTL_MS;

  const config = {
    port,
    sessionTtl,
    sessionCookie: env.TODO_SESSION_COOKIE || 'todo_token',
    secureCookies: env.COOKIE_SECURE === 'true' || env.NODE_ENV === 'production',
    mongoUri: env.MONGO_URI,
    nodeEnv: env.NODE_ENV || 'development'
  };

  if (!config.mongoUri) {
    throw new Error('MONGO_URI environment variable is required');
  }

  return config;
}
