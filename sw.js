/* UNote service worker - the app opens offline, and a new version lands by itself. */
const CACHE = 'unote-v1.0.12';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-maskable.svg', './updates.json'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    for (const p of SHELL) {
      try { await c.add(new Request(p, { cache: 'reload' })); } catch (err) { /* a missing icon must not block the install */ }
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // The update file must never be answered from the cache, or a new version can never be noticed.
  if (url.pathname.endsWith('/updates.json')) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(req)));
    return;
  }

  // Page loads: serve the shell, then quietly refresh it in the background.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = await caches.match('./index.html');
      const fresh = fetch(req).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put('./index.html', res.clone()));
        return res;
      }).catch(() => null);
      return cached || (await fresh) || new Response('UNote is offline and has not been saved yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }

  // Everything else: cache first, and fill the cache from the network.
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
