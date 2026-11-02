/* KC-0083: what the page does when a handling's stream drops before the answer came.
   Pure logic, no DOM. Invariant: the run goes on at the server whatever the page does,
   so a dropped connection is never shown as "Hermes fejlede" — the page waits, looks
   again and follows the run to its end, or fetches the room when the run is gone.
   Loaded as a classic script before app.js; tests import it for KCFoelg. */
(function (root) {
  'use strict';
  // 1+2+4+8+16+30+30+30 s: about two minutes before the page stops waiting on its own.
  var MAX = 8;
  function ventOm(forsoeg) {
    return forsoeg >= MAX ? null : Math.min(30000, 1000 * Math.pow(2, forsoeg));
  }
  // koe: the runs the server still knows (/api/koe keeps finished ones a while). A known run
  // replays its events to the end when followed again; an unknown one is gone (a restart).
  function skridt(koe, runId) {
    for (var i = 0; i < koe.length; i++) if (koe[i].id === runId) return 'foelg';
    return 'vaek';
  }
  root.KCFoelg = { ventOm: ventOm, skridt: skridt, MAX: MAX };
})(typeof window !== 'undefined' ? window : globalThis);
