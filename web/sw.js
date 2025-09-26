const CACHE_NAME = 'todo-sync-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  '../styles/theme-light.css',
  '../styles/theme-dark.css',
  '../styles/app.css',
  '../scripts/sidepanel.js',
  '../scripts/sync.js',
  '../scripts/sync-config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .catch((error) => console.warn('SW install failed', error))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .catch((error) => console.warn('SW activate cleanup failed', error))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        return response;
      });
    })
  );
});
