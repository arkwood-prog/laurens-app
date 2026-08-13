/* Laurens App service worker.
 *
 * Cache-first for the app shell so the phone opens it instantly and works with
 * no signal at all. Bump CACHE to ship an update. */

const CACHE = 'laurens-app-v2';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './app.css',
  './app.js',
  './store.js',
  './exercises.js',
  './anim.js',
  './charts.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then((cached) => {
      // Serve from cache immediately, then quietly refresh it for next launch.
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
