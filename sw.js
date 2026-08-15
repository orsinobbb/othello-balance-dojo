const CORE_CACHE = 'balance-dojo-core-v3';
const DATA_CACHE = 'balance-dojo-data-v1';
const CORE = ['./', './index.html', './styles.css?v=3', './src/app.js?v=3', './src/core/bitboard.js', './src/core/session.js', './src/core/symmetry.js', './src/core/teaching.js', './src/data/native-balanced-dag.js', './src/data/shard-repository.js', './src/storage/progress-store.js', './data/release-manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CORE_CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => ![CORE_CACHE, DATA_CACHE].includes(key)).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.pathname.endsWith('.otbdag')) {
    event.respondWith(caches.open(DATA_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    }));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) caches.open(CORE_CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request)));
});
