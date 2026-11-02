/* KC-0090: what Esc closes. Pure logic, no DOM. Invariant: one press closes one thing, the innermost
   first (the open Senere choice on a card, a floating panel, then the chat sheet it may sit over, then the element the chat is about);
   native dialogs close themselves. Loaded as a classic script before app.js; tests import it for KCEsc. */
(function (root) {
  'use strict';
  var ORDEN = ['senere', 'koe', 'samtale', 'chat', 'kontekst'];
  function foerst(aabne) {
    for (var i = 0; i < ORDEN.length; i++) if (aabne[ORDEN[i]]) return ORDEN[i];
    return null;
  }
  root.KCEsc = { foerst: foerst };
})(typeof window !== 'undefined' ? window : globalThis);
