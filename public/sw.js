// Lightweight PWA SW with runtime caching for Human.js models
const VERSION = '2025-09-04-1';
const CORE_CACHE = `core-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

// Precache minimal shell
const CORE_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Human.js CDN patterns to cache (models & lib)
const HUMAN_CDNS = [
  'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/',
  'https://unpkg.com/@vladmandic/human@3.3.6/',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.includes('core-') || k.includes('runtime-')) && k !== CORE_CACHE && k !== RUNTIME_CACHE ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

function shouldCacheRuntime(url) {
  const u = url.toString();
  if (u.includes('/_next/static/')) return true; // app assets
  for (const cdn of HUMAN_CDNS) if (u.startsWith(cdn)) return true;
  return false;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only GET
  if (req.method !== 'GET') return;

  if (shouldCacheRuntime(req.url)) {
    e.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req, { mode: 'no-cors' });
        // opaque is fine for CDN assets
        cache.put(req, res.clone());
        return res;
      } catch (err) {
        return cached || fetch(req);
      }
    })());
    return;
  }

  // Core shell: stale-while-revalidate
  if (CORE_ASSETS.includes(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(CORE_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((res) => { cache.put(req, res.clone()); return res; });
      return cached || fetchPromise;
    })());
    return;
  }
});
