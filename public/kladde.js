/* KC-0087: the chat's draft survives a reload or a trip to another room. Pure logic over a
   Storage-like object (localStorage in the page). Invariant: one draft per room, gone once sent
   or erased; a missing or blocked storage never breaks the chat — there is just no draft.
   Loaded as a classic script before app.js; tests import it for KCKladde. */
(function (root) {
  'use strict';
  var MAX = 20000;
  function noegle(rum) { return 'kc-kladde:' + rum; }
  function gem(lager, rum, tekst) {
    if (!lager) return;
    try {
      if (String(tekst).trim()) lager.setItem(noegle(rum), String(tekst).slice(0, MAX));
      else lager.removeItem(noegle(rum));
    } catch (e) { /* full or blocked: the draft is just not kept */ }
  }
  function hent(lager, rum) {
    if (!lager) return '';
    try { return lager.getItem(noegle(rum)) || ''; } catch (e) { return ''; }
  }
  root.KCKladde = { gem: gem, hent: hent };
})(typeof window !== 'undefined' ? window : globalThis);
