const CACHE_NAME = 'parcheggio-firenze-v11';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './logic.js',
  './data.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './badge-96.png',
  './notif-car-192.png',
  './assets/logo-spazzapp-white.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: quando sei online prendi sempre la versione più recente di
// codice/dati (utile perché data.js viene aggiornato periodicamente); la
// cache serve solo come fallback offline.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// Notifica push reale: arriva anche ad app chiusa (inviata dal workflow
// GitHub Actions tramite il Worker Cloudflare, protocollo Web Push standard).
self.addEventListener('push', (event) => {
  let data = { title: 'Sposta la 🚗', body: 'Controlla la tua auto parcheggiata.' };
  try { if (event.data) data = event.data.json(); } catch (e) {}
  event.waitUntil(
    // `icon`: macchinina su fondo viola, non il logo (che Android mostra
    // già come icona dell'app: col logo anche qui compariva due volte;
    // senza niente Chrome disegna una "P" grigia con l'iniziale del sito).
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'notif-car-192.png',
      badge: 'badge-96.png',
      tag: 'parcheggio-firenze-reminder',
      // Su Android: vibra, ri-avvisa anche se una notifica con lo stesso tag
      // è già presente, e resta visibile finché l'utente non la tocca.
      vibrate: [200, 100, 200, 100, 300],
      renotify: true,
      requireInteraction: true
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
