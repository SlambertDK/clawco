/* KC-0094: service worker. Its only job is the calm Danish page when Kontrolcenter cannot be
   reached; the decision itself is in sw-logik.js. It caches nothing but that page, so a deploy
   always reaches the browser and no old room content is ever shown as new. */
importScripts('/sw-logik.js');

var CACHE = 'kc-offline-v1';

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.add(new Request(self.KCSw.OFFLINE_SIDE, { cache: 'reload' })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (navne) {
        return Promise.all(navne.filter(function (n) { return n.indexOf('kc-') === 0 && n !== CACHE; }).map(function (n) { return caches.delete(n); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var svar = self.KCSw.svar(
    event.request,
    function (req) { return fetch(req); },
    function () { return caches.open(CACHE).then(function (c) { return c.match(self.KCSw.OFFLINE_SIDE); }); }
  );
  if (svar) event.respondWith(svar);
});
