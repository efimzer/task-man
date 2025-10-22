import { loadConfig } from './config.js';
import { initializeDatabase } from './db/client.js';
import { createServerApp } from './app.js';

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    console.error('❌ Configuration error:', error.message);
    process.exit(1);
  }

  let dbContext;
  try {
    dbContext = await initializeDatabase({
      mongoUri: config.mongoUri,
      sessionTtl: config.sessionTtl
    });
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }

  const { app, services } = createServerApp({
    config,
    collections: dbContext.collections
  });

  const server = app.listen(config.port, () => {
    console.log(`✅ Todo sync server running on port ${config.port}`);
    console.log(`📊 Health check: http://localhost:${config.port}/health`);
  });

  const cleanupInterval = setInterval(async () => {
    try {
      const result = await services.sessionService.cleanupExpiredSessions();
      if (result.deletedCount > 0) {
        console.log(`[CLEANUP] Removed ${result.deletedCount} expired sessions`);
      }
    } catch (error) {
      console.error('[CLEANUP ERROR]', error);
    }
  }, 60 * 60 * 1000);

  const shutdown = async (signal) => {
    console.log(`\n🛑 Received ${signal}, shutting down...`);
    clearInterval(cleanupInterval);
    server.close(() => {
      console.log('HTTP server stopped');
    });
    if (dbContext?.client) {
      await dbContext.client.close();
      console.log('MongoDB connection closed');
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

await main();
