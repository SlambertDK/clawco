/* KC-0094: registers the service worker that shows the Danish "kan ikke nås" page offline. */
(function () {
  'use strict';
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () { /* no worker: Safari's own page, nothing else breaks */ });
  } catch (e) { /* blocked or unsupported: same */ }
})();
