#!/usr/bin/env node

const TARGET_URL = process.env.KEEP_ALIVE_URL || process.env.BASE_URL || process.env.RENDER_SERVICE_URL;

if (!TARGET_URL) {
  console.error('❌ KEEP_ALIVE_URL (или BASE_URL/RENDER_SERVICE_URL) не задан. Завершение работы.');
  process.exit(1);
}

const INTERVAL_MS = Number(process.env.KEEP_ALIVE_INTERVAL_MS) || 60 * 60 * 1000; // 1 час
const url = new URL('/health', TARGET_URL);

async function ping() {
  const started = Date.now();
  try {
    const response = await fetch(url, { method: 'GET' });
    const duration = Date.now() - started;
    if (!response.ok) {
      const text = await response.text().catch(() => '<no body>');
      console.warn(`⚠️ Keep-alive: ${response.status} ${response.statusText} (${duration}ms) – ${text}`);
      return;
    }
    console.log(`✅ Keep-alive OK (${response.status}) in ${duration}ms at ${new Date().toISOString()}`);
  } catch (error) {
    console.error(`❌ Keep-alive failed: ${error.message}`);
  }
}

console.log(`🚀 Keep-alive worker started. Target: ${url.toString()} , interval: ${INTERVAL_MS}ms`);

await ping();

const timer = setInterval(() => {
  ping().catch((error) => {
    console.error('❌ Unexpected keep-alive error:', error);
  });
}, INTERVAL_MS);

function shutdown(signal) {
  console.log(`🛑 Received ${signal}, stopping keep-alive worker`);
  clearInterval(timer);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
