/* KC-0101: going to another room and back within ten minutes puts Henrik at the same place in
   the room, not at the top. Pure logic over a Storage-like object (sessionStorage in the page)
   and an injected clock. Invariant: one place per room path, only restored on a fresh page load
   (never on a live swap), never over a #fragment or the browser's own back/forward restoration;
   a missing or blocked storage just means the room starts at the top.
   Loaded as a classic script before app.js; tests import it for KCPlads. */
(function (root) {
  'use strict';
  var UDLOEB = 10 * 60 * 1000;
  function noegle(sti) { return 'kc-plads:' + sti; }
  function gem(lager, sti, y, nu) {
    if (!lager) return;
    try {
      if (y > 0) lager.setItem(noegle(sti), JSON.stringify({ y: Math.round(y), t: nu }));
      else lager.removeItem(noegle(sti));
    } catch (e) { /* full or blocked: the place is just not kept */ }
  }
  // The saved y when it should be restored now, else null.
  function hent(lager, sti, nu, valg) {
    if (!lager) return null;
    if (valg && (valg.hash || valg.navType === 'back_forward')) return null;
    try {
      var r = JSON.parse(lager.getItem(noegle(sti)));
      if (!r || typeof r.y !== 'number' || typeof r.t !== 'number') return null;
      if (!(r.y > 0) || r.t > nu || nu - r.t >= UDLOEB) return null;
      return r.y;
    } catch (e) { return null; }
  }
  root.KCPlads = { gem: gem, hent: hent, UDLOEB: UDLOEB };

  // Page wiring: only in a real page, not in the node tests.
  if (typeof window === 'undefined' || !window.document) return;
  var w = window, d = document;
  var lager = null;
  try { lager = w.sessionStorage; } catch (e) { lager = null; }
  var sti = w.location.pathname;

  // On the phone an open chat pins the page (body fixed, top = -scroll), so scrollY reads 0.
  function nuY() {
    var b = d.body;
    if (b && b.style.position === 'fixed' && b.style.top) return -parseFloat(b.style.top) || 0;
    return w.scrollY;
  }
  function gemNu() { KCPlads.gem(lager, sti, nuY(), Date.now()); }
  // While the page is torn down its height can shrink (measured: 17 px on Mail), so pagehide and the
  // hidden state that follows must not overwrite the place taken a moment before by the nav tap.
  var forladt = false;
  function gemVedFarvel() { if (!forladt) gemNu(); }

  var navType = '';
  try { var nav = w.performance.getEntriesByType('navigation')[0]; navType = nav ? nav.type : ''; } catch (e) { /* no timing API */ }
  var maal = KCPlads.hent(lager, sti, Date.now(), { hash: w.location.hash, navType: navType });
  if (maal !== null) {
    w.scrollTo(0, maal);
    // Web fonts or images may still change the height: once more after load, unless Henrik already scrolled.
    var roert = false;
    function rort() { roert = true; }
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (e) { w.addEventListener(e, rort, { passive: true, once: true }); });
    w.addEventListener('load', function () { if (!roert && Math.abs(w.scrollY - maal) > 1) w.scrollTo(0, maal); });
  }

  w.addEventListener('beforeunload', function () { gemNu(); forladt = true; });
  w.addEventListener('pagehide', gemVedFarvel);
  w.addEventListener('pageshow', function () { forladt = false; });
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') gemVedFarvel(); });
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('nav a') : null;
    // iOS fires no beforeunload: the tap itself takes the place (and lets go if no page change follows).
    if (a) { gemNu(); forladt = true; setTimeout(function () { forladt = false; }, 1500); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
