/* KC-0065: how tall the chat sheet may be on the phone. Pure logic, no DOM.
   iOS 26 Safari draws the bar above the keyboard (arrows + checkmark) floating
   over the page, inside visualViewport.height — so with the keyboard open the
   sheet ends above that bar, or the chat field sits behind it.
   Loaded as a classic script before app.js; tests import it for KCArk. */
(function (root) {
  'use strict';
  // Bar 48 pt + its gap to the keyboard 11 pt, measured on Henrik's iPhone (2026-10-30), plus a hair.
  var BJAELKE = 60;
  // The on-screen keyboard is open when the visible height dropped this much below the full height.
  var TASTATUR_MIN = 120;
  function tastaturAaben(o) {
    return o.feltFokus && o.fuldH - o.vvH > TASTATUR_MIN;
  }
  function synligHoejde(o) {
    return o.ios && tastaturAaben(o) ? o.vvH - BJAELKE : o.vvH;
  }
  root.KCArk = { synligHoejde: synligHoejde, tastaturAaben: tastaturAaben, BJAELKE: BJAELKE };
})(typeof window !== 'undefined' ? window : globalThis);
