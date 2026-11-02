// Kontrolcenter testtilstand (KC-0068): the band at the top of every test page (moment picker + "Sluk")
// and the shifted clock. Injected into <head> by src/testtilstand/kontakt.ts before app.js runs, so the
// Date shift below is the first thing that happens. Server strings only ever go through textContent.
(function () {
  'use strict';
  var T = window.KC_TEST;
  if (!T) return; // a real page: nothing to do
  var OFFSET = Number(T.offsetMs) || 0;

  // ---------------------------------------------------------------------
  // 1. The clock: Date.now() and new Date() (no args) are real time + the test offset.
  var RealDate = Date;
  function ShiftedDate() {
    var a = arguments;
    if (!(this instanceof ShiftedDate)) return new RealDate(RealDate.now() + OFFSET).toString();
    if (a.length === 0) return new RealDate(RealDate.now() + OFFSET);
    return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(a))))();
  }
  ShiftedDate.prototype = RealDate.prototype;
  Object.setPrototypeOf(ShiftedDate, RealDate); // parse, UTC and any statics come through
  ShiftedDate.now = function () { return RealDate.now() + OFFSET; };
  window.Date = ShiftedDate;
  document.documentElement.classList.add('kc-test'); // reserves the band's height from the first paint

  // ---------------------------------------------------------------------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function tid() {
    return new Date().toLocaleTimeString('da-DK', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace('.', ':');
  }
  // POST and read the server's answer: JSON ({url} or {error}) or a short plain-text error.
  function post(url) {
    return fetch(url, { method: 'POST' }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = JSON.parse(t); } catch (e) { /* plain text */ }
        if (r.ok && d && typeof d.url === 'string') return d.url;
        throw new Error((d && d.error) || t || 'Testtilstand fejlede');
      });
    });
  }

  // ---------------------------------------------------------------------
  // 2. The band.
  function build() {
    var band = el('div', 'kc-test-baand');
    band.setAttribute('role', 'region');
    band.setAttribute('aria-label', 'Testtilstand');
    // Two titles, one hidden per breakpoint (CSS): the full one on wide screens, "Test" on a phone (the picker carries the time there).
    var title = el('span', 'kc-test-titel');
    var lang = el('span', 'kc-test-lang');
    var navn = el('span', 'kc-test-navn', 'Testtilstand · ' + (T.navn || ''));
    var klok = el('span', 'kc-test-tid', tid());
    lang.appendChild(navn);
    lang.appendChild(document.createTextNode(' '));
    lang.appendChild(klok);
    title.appendChild(lang);
    title.appendChild(el('span', 'kc-test-kort', 'Test'));
    var fejl = el('span', 'kc-test-fejl');
    fejl.setAttribute('role', 'status');
    var label = el('label', 'kc-test-valg');
    var lt = el('span', 'kc-test-label', 'Øjeblik');
    var sel = el('select');
    sel.disabled = true;
    label.appendChild(lt);
    label.appendChild(sel);
    var sluk = el('button', 'kc-test-sluk', 'Sluk');
    sluk.type = 'button';
    band.appendChild(title);
    band.appendChild(fejl);
    band.appendChild(label);
    band.appendChild(sluk);
    document.body.insertBefore(band, document.body.firstChild);

    function vis(e) { fejl.textContent = e && e.message ? e.message : 'Testtilstand fejlede'; band.classList.add('har-fejl'); }
    function ryd() { fejl.textContent = ''; band.classList.remove('har-fejl'); }
    function ud(p) { return p.then(function (url) { location.href = url; }); }

    sel.addEventListener('change', function () {
      ryd();
      sel.disabled = true;
      ud(post('/test/moment/' + encodeURIComponent(sel.value))).catch(function (e) { sel.disabled = false; vis(e); });
    });
    sluk.addEventListener('click', function () {
      ryd();
      sluk.disabled = true;
      ud(post('/test/sluk')).catch(function (e) { sluk.disabled = false; vis(e); });
    });

    fetch('/test/status').then(function (r) { return r.json(); }).then(function (d) {
      var list = (d && d.momenter) || [];
      list.forEach(function (m) {
        var o = el('option', null, m.tid + ' ' + m.navn);
        o.value = m.id;
        if (m.id === T.moment) o.selected = true;
        sel.appendChild(o);
      });
      sel.disabled = !list.length;
    }).catch(function () { vis(new Error('Kunne ikke hente øjeblikkene')); });

    setInterval(function () { klok.textContent = tid(); }, 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
