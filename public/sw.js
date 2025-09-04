// PWA Service Worker — cache app shell & model lokal Human.js
// GANTI versi tiap kali SW diubah agar update pasti terpasang
const VERSION = '2025-09-04-3';
const CORE_CACHE = `core-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

// App shell yang perlu siap offline
const CORE_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  // Tambahkan aset penting lain jika perlu, mis. logo/splash:
  // '/logo/logo-horizontal.png',
];

// Tentukan aset runtime yang perlu di-cache:
// - Next build assets: /_next/static/
// - Model Human lokal: /models/
function shouldCacheRuntime(urlStr) {
  const url = new URL(urlStr);
  if (url.pathname.startsWith('/_next/static/')) return true;
  if (url.pathname.startsWith('/models/')) return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => {
        const isOldCore = k.startsWith('core-') && k !== CORE_CACHE;
        const isOldRuntime = k.startsWith('runtime-') && k !== RUNTIME_CACHE;
        return (isOldCore || isOldRuntime) ? caches.delete(k) : Promise.resolve();
      })
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Hanya tangani GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Strategy: cache-first untuk runtime (Next static & model), supaya cepat/offline
  if (shouldCacheRuntime(req.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req); // fetch normal (CORS dilayani oleh server sendiri)
        if (res && (res.ok || res.type === 'opaqueredirect' || res.type === 'opaque')) {
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        // Jika gagal network & tidak ada cache, lempar error
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  // Strategy: stale-while-revalidate untuk app shell
  if (CORE_ASSETS.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CORE_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaqueredirect' || res.type === 'opaque')) {
          cache.put(req, res.clone());
        }
        return res;
      }).catch(() => cached); // jika offline, pakai cache
      return cached || fetchPromise;
    })());
    return;
  }

  // Default: network-first dengan fallback cache (untuk halaman lainnya)
  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      return res;
    } catch {
      const cache = await caches.open(CORE_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      // Optional: kembalikan halaman root kalau navigasi dan offline
      if (req.mode === 'navigate') {
        const fallback = await cache.match('/');
        if (fallback) return fallback;
      }
      throw new Error('Offline and no cache available');
    }
  })());
});
