/* Train App service worker.
 *
 * Cache-first for the app shell so the phone opens it instantly and works with
 * no signal at all. Bump CACHE to ship an update. */

const CACHE = 'train-app-v6';

// Exercise photos live in their own cache, filled by the app in the
// background, so an app update does not throw them away.
const PHOTOS = 'train-photos-v1';

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
  './generator.js',
  './guides.js',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' skips the browser's HTTP cache, so an update never
      // re-caches the previous version's files.
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== PHOTOS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Photos never change: serve the stored copy, else fetch and store it.
  if (new URL(req.url).pathname.includes('/photos/')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(PHOTOS).then(c => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((cached) => {
      // Serve from cache immediately, then quietly refresh it for next launch.
      const network = fetch(req, { cache: 'no-cache' })
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
