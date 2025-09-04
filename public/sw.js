// PWA SW: cache runtime untuk Human.js models & Next assets (tanpa no-cors)
const VERSION = '2025-09-04-2';   // <— bump versi agar SW lama terganti
const CORE_CACHE = `core-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

const CORE_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Human.js CDN yang boleh di-cache
const HUMAN_CDNS = [
  'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/',
  'https://unpkg.com/@vladmandic/human@3.3.6/',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) =>
        (k.startsWith('core-') || k.startsWith('runtime-')) &&
        k !== CORE_CACHE && k !== RUNTIME_CACHE
          ? caches.delete(k)
          : null
      )
    );
    await self.clients.claim();
  })());
});

function shouldCacheRuntime(url) {
  const u = url.toString();
  if (u.includes('/_next/static/')) return true; // asset Next
  for (const cdn of HUMAN_CDNS) if (u.startsWith(cdn)) return true; // model Human
  return false;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (shouldCacheRuntime(req.url)) {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      try {
        // fetch normal (CORS di CDN Human sudah allow *)
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        return cached || Promise.reject(err);
      }
    })());
    return;
  }

  // Core shell: stale-while-revalidate
  const url = new URL(req.url);
  if (CORE_ASSETS.includes(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(CORE_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      });
      return cached || fetchPromise;
    })());
  }
});
