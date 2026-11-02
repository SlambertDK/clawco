/* KC-0073: on the phone "Spørg Hermes" floats over the room. While Henrik scrolls down to read
   and tap, it tucks away so it never sits on the button he reaches for; on the way up, at the top
   and at the bottom of the room it is back. Pure logic, no DOM.
   Loaded as a classic script before app.js; tests import it for KCFab. */
(function (root) {
  'use strict';
  // Scroll steps smaller than this are a finger resting on the glass, not a direction.
  var STEP = 6;
  function vedScroll(forrigeY, y, maxY) {
    if (y <= 0 || y >= maxY - 4) return 'vis';
    if (y - forrigeY > STEP) return 'skjul';
    if (forrigeY - y > STEP) return 'vis';
    return null;
  }
  root.KCFab = { vedScroll: vedScroll };
})(typeof window !== 'undefined' ? window : globalThis);
