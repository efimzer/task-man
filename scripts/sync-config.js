const DEFAULT_BASE_URL = 'https://gofima.online';

function resolveBaseUrl() {
  if (typeof window !== 'undefined') {
    const origin = window.location?.origin;
    if (origin && /^https?:/.test(origin)) {
      return origin;
    }
  }
  return DEFAULT_BASE_URL;
}

export const syncConfig = {
  enabled: true,
  baseUrl: resolveBaseUrl(),
  pullOnStartup: true,
  pushDebounceMs: 500,
  pullIntervalMs: 1500,
  keepAliveIntervalMs: 60 * 60 * 1000 // 1 час
};
