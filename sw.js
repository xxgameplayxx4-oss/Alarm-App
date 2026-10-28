const CACHE = 'pushup-alarm-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/pose.js',
  './js/alarm.js',
  './css/missions.css',
  './js/missions/index.js',
  './js/missions/camera-mission.js',
  './js/missions/pushups.js',
  './js/missions/squats.js',
  './js/missions/math.js',
  './js/missions/memory.js',
  './js/missions/typing.js',
  './js/missions/shake.js',
  './js/missions/steps.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './vendor/vision_bundle.mjs',
  './vendor/wasm/vision_wasm_internal.js',
  './vendor/wasm/vision_wasm_internal.wasm',
  './vendor/wasm/vision_wasm_nosimd_internal.js',
  './vendor/wasm/vision_wasm_nosimd_internal.wasm',
  './vendor/pose_landmarker_lite.task',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache individually so one failure doesn't abort the install.
    await Promise.all(ASSETS.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res);
      } catch (e) { /* skip */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ignoreSearch so "?n=20&auto=1" launches hit the cached shell.
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (e) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
