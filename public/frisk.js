/* KC-0071: when the room must be fetched again so the screen is never stale.
   Pure logic, no DOM. Invariant: whenever the page may have missed a change
   (the live stream reconnected, the phone slept, the tab sat in the
   background), the room shows what the server has now.
   Loaded as a classic script before app.js; tests import it for KCFrisk. */
(function (root) {
  'use strict';
  // Hidden this long counts as "away": an app-switcher glance does not refetch.
  var SKJULT_MIN = 15000;
  // The live stream's hello carries the room's version. The first hello only learns it
  // (the page was just rendered); a later one comes after a reconnect, and any other
  // version than the one shown means a change was missed (a restart starts versions over).
  function vedHello(kendt, version) {
    return { kendt: version, hent: kendt !== -1 && version !== kendt };
  }
  function vedSynlig(skjultSiden, nu) {
    return skjultSiden !== null && nu - skjultSiden >= SKJULT_MIN;
  }
  // A stream the browser gave up on (the server answered 502 during a deploy) is reopened by us.
  function genforbindOm(forsoeg) {
    return Math.min(30000, 1000 * Math.pow(2, forsoeg));
  }
  root.KCFrisk = { vedHello: vedHello, vedSynlig: vedSynlig, genforbindOm: genforbindOm, SKJULT_MIN: SKJULT_MIN };
})(typeof window !== 'undefined' ? window : globalThis);
