/* KC-0203: the closed beta's feedback card. Pure logic, no DOM: what the card will send (krop) and the line that shows
   it before it is sent (forhaandsvisning) are made from the same object, so the preview is what is sent. The server
   validates and keeps exactly this object (src/beta/feedback.ts). Loaded as a classic script before app.js, only when the
   beta is on; tests import it for KCBeta. */
(function (root) {
  'use strict';
  var TEKST_MAKS = 500;
  // One plain line: line breaks become a space, control characters go, ends are trimmed (the server does the same).
  function renLinje(s) { return String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim(); }
  function krop(v) {
    if (!v || !(v.vurdering >= 1 && v.vurdering <= 5)) return null;
    var tekst = renLinje(String(v.tekst || '').slice(0, TEKST_MAKS));
    return { dag: v.dag, vurdering: v.vurdering, tekst: tekst || null, betale: v.betale || null };
  }
  function forhaandsvisning(v, ord) {
    var k = krop(v);
    if (!k) return ord.sendes + ': ' + ord.vaelg;
    var dele = [ord.vurdering + ' ' + k.vurdering];
    if (k.tekst !== null) dele.push('«' + k.tekst + '»');
    if (k.betale !== null) dele.push(ord.betale + ': ' + ord[k.betale]);
    return ord.sendes + ': ' + dele.join(', ');
  }
  root.KCBeta = { krop: krop, forhaandsvisning: forhaandsvisning };
})(typeof window !== 'undefined' ? window : globalThis);
