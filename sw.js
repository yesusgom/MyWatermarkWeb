/* =============================================================
   sw.js — service worker (solo uso sin conexión)
   La app NO necesita servidor ni red: esto únicamente guarda una
   copia de los ficheros para que abra al instante y siga
   funcionando sin cobertura. Se registra solo en http(s).
   ============================================================= */
var CACHE = 'marca-agua-v3';

var ASSETS = [
    './',
    './index.html',
    './manifest.webmanifest',
    './icon.svg',
    './icon-maskable.svg',
    './css/styles.css',
    './js/utils.js',
    './js/zip.js',
    './js/renderer.js',
    './js/app.js'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE)
            .then(function (cache) { return cache.addAll(ASSETS); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (key) {
                return key === CACHE ? null : caches.delete(key);
            }));
        }).then(function () { return self.clients.claim(); })
    );
});

/*
 * Red primero y caché como respaldo: así una versión nueva se ve
 * siempre en cuanto hay cobertura, y sin cobertura la app sigue
 * abriendo al instante desde la copia local.
 */
self.addEventListener('fetch', function (event) {
    if (event.request.method !== 'GET') return;
    if (new URL(event.request.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request).then(function (response) {
            if (response && response.ok) {
                var copy = response.clone();
                caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
            }
            return response;
        }).catch(function () {
            return caches.match(event.request).then(function (hit) {
                return hit || caches.match('./index.html');
            });
        })
    );
});
