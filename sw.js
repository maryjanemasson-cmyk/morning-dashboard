// Morning Dashboard service worker.
// Network-first for same-origin GETs so the installed app ALWAYS gets the
// latest version when online; the cache is only an offline fallback.
// Cross-origin requests (Firebase, TVMaze, etc.) are left untouched.
const CACHE = 'md-cache-v1';

self.addEventListener('install', () => {
  self.skipWaiting(); // activate the new worker immediately
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // drop any old caches, then take control of open pages
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // Only manage same-origin GETs; let the browser handle everything else.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
