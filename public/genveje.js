/* KC-0080: keyboard shortcuts on the laptop. A digit opens the n-th room the menu shows, / goes to
   the chat field, ? shows the shortcuts. Never while Henrik types in a field and never with a
   modifier, so the browser's own shortcuts stay his. Pure logic, no DOM.
   Loaded as a classic script before app.js; tests import it for KCGenveje. */
(function (root) {
  'use strict';
  function handling(t) {
    if (t.iFelt || t.ctrlKey || t.metaKey || t.altKey) return null;
    if (/^[1-9]$/.test(t.key)) return { type: 'rum', nr: Number(t.key) };
    if (t.key === '/') return { type: 'chat' };
    if (t.key === '?') return { type: 'hjaelp' };
    return null;
  }
  root.KCGenveje = { handling: handling };
})(typeof window !== 'undefined' ? window : globalThis);
