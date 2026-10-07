const ART_CACHE = 'art-v2';
addEventListener('install', () => skipWaiting());
addEventListener('activate', e => e.waitUntil(clients.claim()));
addEventListener('fetch', e => { const u = new URL(e.request.url);
  if (u.origin === location.origin && u.pathname.includes('/art/')) e.respondWith(caches.open(ART_CACHE).then(async c => (await c.match(e.request)) ||
    fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }))); });
