/* KC-0079: what waits, in the browser tab's title and on the home-screen icon. Own unfinished
   work (Skrive drafts, a univers' pile — the nav marks those data-eget) is not counted; the
   server counts the same way (antalVenter in src/shell/synlig.ts) for the first paint.
   Pure logic, no DOM. Loaded as a classic script before app.js; tests import it for KCTitel. */
(function (root) {
  'use strict';
  function antal(venter, erEget) {
    var n = 0;
    for (var id in venter) if (Object.prototype.hasOwnProperty.call(venter, id) && !erEget(id)) n += venter[id] || 0;
    return n;
  }
  function titel(base, n) { return n > 0 ? '(' + n + ') ' + base : base; }
  root.KCTitel = { antal: antal, titel: titel };
})(typeof window !== 'undefined' ? window : globalThis);
