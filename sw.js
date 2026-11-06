const C = 'swd-v19', FILES = ['./', 'index.html', 'styles.css?v=19', 'app.js?v=19', 'icon.svg'];
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES)));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

self.addEventListener('push', e => {
  let data = { title: 'Smart Water Drink', body: 'ถึงเวลาดื่มน้ำแล้ว สักแก้วนะ', glass: 250 };
  try {
    if (e.data) data = Object.assign(data, e.data.json());
  } catch (_) {}
  const glass = data.glass || 250;
  e.waitUntil(
    self.registration.showNotification(data.title || 'Smart Water Drink', {
      body: data.body,
      icon: 'icon.svg',
      badge: 'icon.svg',
      tag: 'swd-push',
      renotify: true,
      data: { glass, clientId: data.clientId },
      actions: [
        { action: 'drink', title: `+${glass} มล. (ดื่มแล้ว)` },
        { action: 'open', title: 'เปิดแอป' }
      ]
    })
  );
});

self.addEventListener('notificationclick', e => {
  const { glass = 250, clientId } = e.notification.data || {};
  e.notification.close();

  if (e.action === 'drink') {
    e.waitUntil((async () => {
      const winList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (winList.length > 0) {
        winList.forEach(w => w.postMessage({ type: 'DRINK_FROM_NOTIFICATION', ml: glass }));
        return winList[0].focus();
      }
      if (clientId) {
        await fetch('/api/drink', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, ml: glass })
        }).catch(() => {});
      }
    })());
    return;
  }

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(l => l[0] ? l[0].focus() : clients.openWindow('./'))
  );
});
