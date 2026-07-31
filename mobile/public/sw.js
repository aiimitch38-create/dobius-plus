// Dobius+ Mobile service worker (v1.0.43 Phase 4). Makes the PWA installable
// and openable offline (last-known app shell), and is the registration Web
// Push will attach to in Phase 5. Network-first with a cache fallback: a remote
// control should show fresh content when online, and the cached shell when the
// link is down. Never touches cross-origin requests or the WebSocket.
const CACHE = 'dobius-mobile-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Web Push (Phase 5b): show the notification the Mac sent, and focus/open the
// app when it's tapped.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Dobius+';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { url: data.url || './' },
    icon: './icon.png',
    badge: './icon.png',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || './';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
    return undefined;
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // leave cross-origin alone
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit
        || (req.mode === 'navigate' ? caches.match('./') : undefined))),
  );
});
