/* KC-0084: the "nu" marker on the day line is the clock, not a value Hermes wrote in the morning.
   The server renders it for the moment of the render (data-nu-ms) and this script moves it as
   time passes, without a reload: it is hidden outside the line and on any other day than the line's.
   Pure helpers + a small timer; loaded as a classic script before app.js, tests import KCNu.
   The clock is anchored to the server's render moment (not trusted from the device alone), so a
   phone with a skewed clock and the test world's fictional day both agree with the page. */
(function (root) {
  'use strict';
  var TZ = 'Europe/Copenhagen';
  var TAKT = 20000;

  // Where the marker sits on a line from `fra` to `til` (hours): a percentage, or null outside it.
  function position(fra, til, hh, mm) {
    var t = hh + mm / 60;
    if (t < fra || t > til) return null;
    return Math.round((t - fra) / (til - fra) * 10000) / 100 + '%';
  }

  var fmt = null;
  // The Copenhagen day (YYYY-MM-DD) and clock of a moment, whatever the device's own time zone.
  function kbh(ms) {
    if (!fmt) fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    var p = {};
    fmt.formatToParts(new Date(ms)).forEach(function (d) { p[d.type] = d.value; });
    return { dag: p.year + '-' + p.month + '-' + p.day, hh: Number(p.hour), mm: Number(p.minute) };
  }

  // line element -> { ms: the render moment it was read for, forskel: render moment minus the device clock then }
  var anker = typeof WeakMap === 'function' ? new WeakMap() : null;
  function forskel(linje, enhedsMs) {
    var ms = Number(linje.getAttribute('data-nu-ms'));
    var a = anker && anker.get(linje);
    if (!a || a.ms !== ms) {
      a = { ms: ms, forskel: ms - enhedsMs };
      if (anker) anker.set(linje, a);
    }
    return a.forskel;
  }

  // Places the marker of every line for the device moment `enhedsMs`.
  function opdater(linjer, enhedsMs) {
    Array.prototype.forEach.call(linjer, function (linje) {
      var nu = linje.querySelector('.dl-nu');
      if (!nu) return;
      var k = kbh(enhedsMs + forskel(linje, enhedsMs));
      var p = k.dag === linje.getAttribute('data-dag') ? position(Number(linje.getAttribute('data-fra')), Number(linje.getAttribute('data-til')), k.hh, k.mm) : null;
      if (p === null) { nu.hidden = true; return; }
      nu.style.left = p;
      nu.hidden = false;
    });
  }

  function tik() { opdater(document.querySelectorAll('.dagslinje[data-nu-ms]'), Date.now()); }

  root.KCNu = { position: position, kbh: kbh, opdater: opdater };
  if (typeof document === 'undefined') return;
  tik();
  setInterval(tik, TAKT);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tik(); });
  // A room morphed in place (or swapped) brings a fresh render moment; read it straight away.
  if (typeof MutationObserver === 'function') {
    var vagt = 0;
    new MutationObserver(function () {
      if (vagt) return;
      vagt = setTimeout(function () { vagt = 0; tik(); }, 0);
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-nu-ms'] });
  }
})(typeof window !== 'undefined' ? window : globalThis);
