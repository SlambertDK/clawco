/* KC-0094: the service worker's one decision, kept pure so node can test it. When Kontrolcenter
   cannot be reached, opening it (the home-screen icon, a link) shows a calm Danish page instead of
   Safari's English error. Invariant: only a page navigation is answered, and only with the offline
   page — never a cached room, never a cached app.js. Everything else is left to the browser.
   Loaded by sw.js through importScripts; tests import it for KCSw. */
(function (root) {
  'use strict';
  var OFFLINE_SIDE = '/uden-forbindelse';
  function erSideskift(req) { return req.mode === 'navigate' && req.method === 'GET'; }
  // Tailscale Serve answers 502 while the service restarts: that is "cannot be reached" too.
  function erUdenForbindelse(svar) { return svar.status === 502 || svar.status === 503 || svar.status === 504; }
  // hent(req) = the network; offline() = the cached offline page. null = not ours, do not respondWith.
  function svar(req, hent, offline) {
    if (!erSideskift(req)) return null;
    function tilbage() {
      return Promise.resolve(offline()).then(function (side) { if (!side) throw new Error('ingen offline-side'); return side; });
    }
    return Promise.resolve().then(function () { return hent(req); }).then(
      function (res) { return erUdenForbindelse(res) ? tilbage() : res; },
      tilbage
    );
  }
  root.KCSw = { OFFLINE_SIDE: OFFLINE_SIDE, erSideskift: erSideskift, svar: svar };
})(typeof window !== 'undefined' ? window : globalThis);
