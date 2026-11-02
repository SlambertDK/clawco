/* KC-0088: keeps Hjem's "Næste: … · om 3 t 50 min" line true while the page stays open.
   `om` is the same wording as omTekst in src/shell/naeste.ts (test/client/naeste.test.ts
   compares the two). `tik` rewrites the countdown of every [data-naeste] line from its
   data-start / data-slut (epoch ms) and hides the line once the appointment is over;
   the next one appears with the next fetch of the room. Loaded as a classic script
   before app.js; tests import it for KCNaeste. */
(function (root) {
  'use strict';
  function om(start, slut, nu) {
    if (nu >= start) return slut !== undefined && nu < slut ? 'nu' : null;
    var min = Math.ceil((start - nu) / 60000);
    if (min < 60) return 'om ' + min + ' min';
    var t = Math.floor(min / 60);
    var m = min % 60;
    return m ? 'om ' + t + ' t ' + m + ' min' : 'om ' + t + ' t';
  }
  function tik(doc, nu) {
    var linjer = doc.querySelectorAll('[data-naeste]');
    for (var i = 0; i < linjer.length; i++) {
      var el = linjer[i];
      var slut = el.getAttribute('data-slut');
      var t = om(Number(el.getAttribute('data-start')), slut === null ? undefined : Number(slut), nu);
      var span = el.querySelector('.naeste-om');
      if (t === null) { el.hidden = true; continue; }
      el.hidden = false;
      if (span && span.textContent !== t) span.textContent = t;
    }
  }
  root.KCNaeste = { om: om, tik: tik };
  if (typeof document !== 'undefined') {
    var gaa = function () { tik(document, Date.now()); };
    setInterval(gaa, 15000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) gaa(); });
  }
})(typeof window !== 'undefined' ? window : globalThis);
