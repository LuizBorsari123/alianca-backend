const CACHE = 'alianca-pwa-v2';
const ASSETS = [
  '/', '/index.html', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/icon-maskable.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // nunca intercepta POST (API)
  const url = new URL(e.request.url);
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  if (url.origin === self.location.origin && ASSETS.includes(url.pathname)) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
  // qualquer outra coisa (chamadas de API GET) segue direto pra rede
});

// ---- Push: chega do servidor e vira notificação na tela, com o app FECHADO.
// É isto que avisa o cônjuge no iPhone (iOS 16.4+, com o app na Tela de Início).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { corpo: e.data && e.data.text() }; }
  const titulo = d.titulo || 'Aliança';
  const corpo = d.corpo || '';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: corpo,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tipo || 'alianca',
    data: { url: '/' },
  }));
});

// Toque na notificação → abre/foca o app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    for (const c of lista) { if ('focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow('/');
  }));
});
