/* KC-0085: "Fortryd" right in the message after a handling. Pure logic, no DOM.
   Invariant: the offer points at exactly the log entry the press created, or there is no offer.
   Loaded as a classic script before app.js; tests import it for KCFortryd. */
(function (root) {
  'use strict';
  var VIS_MS = 10000;
  // foer/efter: the ids of the room's undo buttons before the press and after the room came back.
  function ny(foer, efter) {
    var nye = efter.filter(function (id) { return foer.indexOf(id) < 0; });
    return nye.length === 1 ? nye[0] : null;
  }
  root.KCFortryd = { ny: ny, VIS_MS: VIS_MS };
})(typeof window !== 'undefined' ? window : globalThis);
