// Offline cache. Network first, past the HTTP cache: new deploy shows at once, cache serves when offline.
// Change CACHE when the file list changes.
const CACHE = 'dalmierz-v3';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/ble.js', 'js/db.js', 'js/editor.js', 'js/geometry.js', 'js/render.js',
  'js/format.js', 'js/ui.js', 'js/image.js', 'js/backup.js', 'js/demo.js', 'js/marks.js', 'js/update.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('version.json')) return;
  // GitHub Pages sends max-age=600. 'no-cache' asks the server each time (304 when not changed).
  // A navigate request cannot be copied with options, so make a new one from the URL.
  const req = e.request.mode === 'navigate' ? new Request(e.request.url, { cache: 'no-cache' }) : new Request(e.request, { cache: 'no-cache' });
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
