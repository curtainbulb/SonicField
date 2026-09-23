// Cache-first for artwork: a cover is downloaded once per device, ever.
addEventListener('install', () => skipWaiting());
addEventListener('activate', e => e.waitUntil(clients.claim()));
addEventListener('fetch', e => { const u = new URL(e.request.url);
  if (u.origin === location.origin && u.pathname.includes('/art/') || u.hostname.endsWith('mzstatic.com')) e.respondWith(caches.open('art-v1').then(async c => (await c.match(e.request)) ||
    fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }))); });
