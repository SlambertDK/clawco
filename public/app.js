// Kontrolcenter client: handlinger, Fortryd, Opdatér, aktioner, chat, the
// context chip, busy elements and live refresh. Every button starts a run
// on the server and follows it over SSE; the room re-renders from the HTML
// the server sends on `done`, and refreshes itself when the room changes
// elsewhere (live stream).

// KC-0068: every same-origin request says which world this page shows (x-kc-tilstand: test iff the test band
// set window.KC_TEST). If another tab switched the device since this page loaded, the server refuses the write
// (409 + x-kc-tilstand-skiftet) and the page reloads into the right world. Installed before anything fetches;
// cross-origin calls (ElevenLabs) are left alone so they need no CORS preflight.
(function () {
  'use strict';
  var orig = window.fetch;
  if (!orig) return;
  var TILSTAND = window.KC_TEST ? 'test' : 'real';
  window.fetch = function (input, init) {
    var url = input instanceof Request ? input.url : String(input);
    if (new URL(url, location.href).origin !== location.origin) return orig.call(window, input, init);
    var h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
    h.set('x-kc-tilstand', TILSTAND);
    return orig.call(window, input, Object.assign({}, init, { headers: h })).then(function (r) {
      if (r.status === 409 && r.headers.get('x-kc-tilstand-skiftet')) { location.reload(); return new Promise(function () {}); }
      return r;
    });
  };
  // A page restored from the back/forward cache may show a world the device has left.
  window.addEventListener('pageshow', function (e) { if (e.persisted) location.reload(); });
})();

(function () {
  'use strict';
  var body = document.body;
  var roomId = body.dataset.room;
  var roomEl = document.getElementById('room');
  // KC-0064: record what the server rendered before the client adds anything, so a morph keeps the client's additions.
  if (roomEl) window.kcMorph.merk(roomEl);
  var chatEl = document.getElementById('chat');
  var statusEl = document.getElementById('hermes-status');
  var dotEl = document.getElementById('dot') || document.getElementById('hermes-dot');
  var chipEl = document.getElementById('kontekst');
  var chipWrap = document.getElementById('kontekst-wrap');
  var chipHint = document.getElementById('kontekst-hint');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var toggle = document.getElementById('chat-toggle');
  var toggleCount = document.getElementById('chat-toggle-count');
  var kontekst = '';
  var busy = 0;
  var lastDone = 0;
  var busyEl = null;

  function narrow() { return window.matchMedia('(max-width: 1139px)').matches; }
  // KC-0021: on a phone the chat sheet is fitted to what is visible (the keyboard shrinks it),
  // the page behind is pinned (iOS ignores overflow:hidden), and the keyboard only opens on a tap in the field.
  var phone = window.matchMedia ? window.matchMedia('(max-width: 1139px)') : null;
  var finePointer = window.matchMedia ? window.matchMedia('(pointer: fine)').matches : true;
  // KC-0024: telefon-tilstand = a narrow touch screen (same media query as app.css). Hermes answers short there.
  var telefon = window.matchMedia ? window.matchMedia('(max-width: 1139px) and (pointer: coarse)') : null;
  function enhed() { return telefon && telefon.matches ? 'telefon' : undefined; }
  var aabneFolds = {};
  function aabnFolds(root) {
    if (!root) return;
    root.querySelectorAll('[data-fold]').forEach(function (b) {
      var box = b.nextElementSibling;
      if (box && aabneFolds[foldNoegle(box)]) visFold(b, true);
    });
  }
  function foldNoegle(box) { return box.getAttribute('data-fold-id') || box.getAttribute('data-fold-navn') || ''; }
  function visFold(b, aaben) {
    var box = b.nextElementSibling;
    if (!box) return;
    var navn = box.getAttribute('data-fold-navn') || '';
    box.classList.toggle('is-aaben', aaben);
    b.setAttribute('aria-expanded', aaben ? 'true' : 'false');
    b.textContent = (aaben ? 'Skjul ' : 'Vis ') + navn;
    if (aaben) aabneFolds[foldNoegle(box)] = true; else delete aabneFolds[foldNoegle(box)];
  }
  // KC-0127: Start's step 2 — a provider in the cloud asks for a key, a local one for its address.
  document.addEventListener('change', function (ev) {
    var sel = ev.target && ev.target.matches && ev.target.matches('select[data-model-udbyder]') ? ev.target : null;
    if (!sel || !sel.form) return;
    var valgt = sel.options[sel.selectedIndex];
    var lokal = Boolean(valgt && valgt.hasAttribute('data-lokal'));
    var noegle = sel.form.querySelector('[data-model-felt="noegle"]');
    var url = sel.form.querySelector('[data-model-felt="url"]');
    if (noegle) { noegle.hidden = lokal; var inp = noegle.querySelector('input'); if (inp) inp.placeholder = lokal ? '' : (valgt.getAttribute('data-placeholder') || ''); }
    if (url) { url.hidden = !lokal; var ui = url.querySelector('input'); if (ui && lokal) ui.placeholder = valgt.getAttribute('data-placeholder') || ''; }
  });
  document.addEventListener('click', function (ev) {
    var b = ev.target && ev.target.closest ? ev.target.closest('[data-fold]') : null;
    if (b) visFold(b, b.getAttribute('aria-expanded') !== 'true');
  });
  // KC-0065: iOS 26 floats the bar above the keyboard over the page; KCArk keeps the sheet above it.
  var ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var fuldH = 0;
  function feltFokus() {
    var a = document.activeElement;
    return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(button|submit|checkbox|radio)$/.test(a.type)));
  }
  function fitSheet() {
    var vv = window.visualViewport;
    if (!vv) return;
    var fokus = feltFokus();
    if (!fokus || vv.height > fuldH) fuldH = vv.height;
    var ind = { vvH: vv.height, fuldH: fuldH, feltFokus: fokus, ios: ios };
    var h = window.KCArk ? window.KCArk.synligHoejde(ind) : vv.height;
    document.documentElement.classList.toggle('tastatur', !!window.KCArk && window.KCArk.tastaturAaben(ind));
    document.documentElement.style.setProperty('--vv-h', h + 'px');
    document.documentElement.style.setProperty('--vv-top', vv.offsetTop + 'px');
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitSheet); window.visualViewport.addEventListener('scroll', fitSheet);
    document.addEventListener('focusin', fitSheet); document.addEventListener('focusout', function () { setTimeout(fitSheet, 0); });
    fitSheet();
  }
  var pinnedY = null;
  function pinPage() {
    if (!phone || !phone.matches || pinnedY !== null) return;
    pinnedY = window.scrollY;
    body.style.position = 'fixed'; body.style.top = (-pinnedY) + 'px'; body.style.left = '0'; body.style.right = '0';
  }
  function unpinPage() {
    if (pinnedY === null) return;
    body.style.position = ''; body.style.top = ''; body.style.left = ''; body.style.right = '';
    window.scrollTo(0, pinnedY);
    pinnedY = null;
  }
  function openChat(focus) {
    body.classList.add('chat-open');
    pinPage();
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    if (focus && finePointer && input) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
  }
  function closeChat() { body.classList.remove('chat-open'); unpinPage(); fabY = window.scrollY; if (toggle) toggle.setAttribute('aria-expanded', 'false'); }
  // KC-0073: on the phone "Spørg Hermes" tucks away while Henrik scrolls down (rules in public/fab.js).
  // fabY moves only when a direction is decided, so a slow scroll still adds up.
  var fabY = window.scrollY;
  var fabRaf = false;
  if (toggle) window.addEventListener('scroll', function () {
    if (fabRaf) return;
    fabRaf = true;
    requestAnimationFrame(function () {
      fabRaf = false;
      var y = window.scrollY;
      if (body.classList.contains('chat-open')) { fabY = y; return; }
      var r = window.KCFab.vedScroll(fabY, y, document.documentElement.scrollHeight - window.innerHeight);
      if (r === 'skjul' && narrow()) body.classList.add('fab-vaek');
      else if (r === 'vis') body.classList.remove('fab-vaek');
      if (r) fabY = y;
    });
  }, { passive: true });

  function setStatus(text, state) {
    if (statusEl) statusEl.textContent = text;
    if (dotEl) dotEl.className = 'dot ' + (state === 'busy' ? 'dot-busy' : state === 'bad' ? 'dot-bad' : 'dot-ok');
    if (busyEl) busyEl.setAttribute('data-busy', 'Hermes ' + text);
  }
  function toast(text, isError) {
    var t = document.createElement('div');
    t.className = 'toast' + (isError ? ' toast-error' : '');
    t.textContent = text;
    body.appendChild(t);
    setTimeout(function () { t.remove(); }, isError ? 8000 : 3500);
  }
  // KC-0085: right after a handling that can be undone, the message offers Fortryd — one tap where Henrik just pressed.
  function fortrydIder() {
    return roomEl ? Array.prototype.map.call(roomEl.querySelectorAll('[data-fortryd], [data-hjem-fortryd]'), function (b) { return b.dataset.fortryd || b.dataset.hjemFortryd; }) : [];
  }
  function tilbydFortryd(foer, tekst) {
    var id = window.KCFortryd.ny(foer, fortrydIder());
    if (!id) return;
    var t = document.createElement('div');
    t.className = 'toast toast-fortryd';
    t.setAttribute('role', 'status');
    var s = document.createElement('span');
    s.textContent = tekst;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-ghost'; b.textContent = 'Fortryd';
    b.addEventListener('click', function () {
      t.remove();
      // The log's own button does the undo, so it runs exactly as if pressed there.
      var log = Array.prototype.find.call(roomEl.querySelectorAll('[data-fortryd], [data-hjem-fortryd]'), function (x) { return (x.dataset.fortryd || x.dataset.hjemFortryd) === id; });
      if (log && !log.disabled) log.click();
    });
    t.appendChild(s); t.appendChild(b);
    body.appendChild(t);
    setTimeout(function () { t.remove(); }, window.KCFortryd.VIS_MS);
  }
  // KC-0072: a calm band while Kontrolcenter cannot be reached (Tailscale down, a deploy restarting the
  // service). It shows only when a drop lasts, probes /health with a growing pause and goes away by itself.
  var baandEl = null;
  var tabtTimer = null;
  var proeveTimer = null;
  var proeveNr = 0;
  var nede = false;
  function forbindelseTabt() {
    if (nede || tabtTimer) return;
    tabtTimer = setTimeout(function () { tabtTimer = null; nede = true; visBaand(); proev(); }, window.KCForbindelse.VENT_FOER_BAAND);
  }
  function forbindelseOk() {
    if (tabtTimer) { clearTimeout(tabtTimer); tabtTimer = null; }
    if (!nede) return;
    nede = false; proeveNr = 0;
    if (proeveTimer) { clearTimeout(proeveTimer); proeveTimer = null; }
    if (baandEl) baandEl.hidden = true;
    toast('Forbindelsen er tilbage', false);
    window.dispatchEvent(new Event('kc-forbindelse-tilbage'));
  }
  function proev() {
    proeveTimer = null;
    fetch('/health', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); forbindelseOk(); })
      .catch(function () { if (nede) proeveTimer = setTimeout(proev, window.KCFrisk.genforbindOm(proeveNr++)); });
  }
  function visBaand() {
    if (!baandEl) {
      baandEl = document.createElement('div');
      baandEl.className = 'forbindelse-baand';
      baandEl.setAttribute('role', 'status');
      baandEl.textContent = window.KCForbindelse.ingenForbindelse() + ' — prøver igen …';
      body.appendChild(baandEl);
    }
    baandEl.hidden = false;
  }
  window.addEventListener('offline', forbindelseTabt);
  window.addEventListener('online', function () { if (nede) proev(); });
  // Every error Henrik reads goes through here: Danish, and a network failure also starts the band.
  function fejlTekst(err) {
    if (window.KCForbindelse.erNetfejl(err)) forbindelseTabt();
    return window.KCForbindelse.fejlTekst(err);
  }
  function klokke() { return new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }).replace(':', '.'); }
  function addMsg(fra, text, cls) {
    if (!chatEl) return null;
    var m = document.createElement('div');
    m.className = 'msg msg-' + fra + (cls ? ' ' + cls : '');
    var t = document.createElement('span'); t.className = 'mono msg-time'; t.textContent = klokke();
    var s = document.createElement('span'); s.className = 'msg-text'; s.textContent = text;
    m.appendChild(t); m.appendChild(s);
    if (fra === 'hermes' && !cls && stemmeOn) m.setAttribute('data-sig', text);
    chatEl.appendChild(m);
    decorate(m.parentNode === chatEl ? chatEl : m);
    chatEl.scrollTop = chatEl.scrollHeight;
    return s;
  }
  function setKontekst(text) {
    kontekst = text || '';
    if (chipEl) chipEl.textContent = 'Om: ' + kontekst;
    if (chipWrap) chipWrap.hidden = !kontekst;
    if (chipHint) chipHint.hidden = !!kontekst;
    if (input) input.placeholder = kontekst ? 'Skriv om: ' + kontekst : 'Skriv til Hermes …';
    if (toggleCount) { toggleCount.hidden = !kontekst; toggleCount.textContent = kontekst ? '1' : ''; }
    document.querySelectorAll('[data-element].is-selected').forEach(function (el) { el.classList.remove('is-selected'); });
    if (kontekst) {
      document.querySelectorAll('[data-element]').forEach(function (el) {
        if (el.dataset.element === kontekst) el.classList.add('is-selected');
      });
    }
  }
  function updateNav(venter) {
    if (!venter) return;
    var ialt = visVenter(venter);
    document.querySelectorAll('nav .rooms a').forEach(function (a) {
      var id = a.getAttribute('href').replace('/rum/', '');
      var count = a.querySelector('.count');
      // KC-0093: Hjem's number is everything that waits, the same as the Hjem page and the title.
      var n = id === 'hjem' ? ialt : venter[id] || 0;
      if (n && !count) { count = document.createElement('span'); count.className = 'count'; a.appendChild(count); }
      if (count) { if (n) count.textContent = String(n); else count.remove(); }
      // KC-0052: a room where something new now waits is relevant — it joins the nav (a univers lights Univers too);
      // a count of Henrik's own unfinished work (data-eget) does not.
      if (n && !a.parentElement.hasAttribute('data-eget')) for (var li = a.parentElement; li && li.tagName === 'LI'; li = li.parentElement.closest('li')) li.hidden = false;
    });
  }
  // KC-0079: the tab title and the home-screen icon say what waits; the nav marks own unfinished work data-eget.
  function visVenter(venter) {
    var n = window.KCTitel.antal(venter, function (id) {
      var a = document.querySelector('nav .rooms a[href="/rum/' + id + '"]');
      return !!(a && a.parentElement.hasAttribute('data-eget'));
    });
    visTal(n);
    return n;
  }
  function visTal(n) {
    if (body.dataset.titel) document.title = window.KCTitel.titel(body.dataset.titel, n);
    try {
      var p = n ? (navigator.setAppBadge && navigator.setAppBadge(n)) : (navigator.clearAppBadge && navigator.clearAppBadge());
      if (p && p.catch) p.catch(function () { /* no badge without permission: the title still says it */ });
    } catch (e) { /* no badge support */ }
  }
  // The first paint's count is Hjem's in the nav, as the server rendered it (KC-0093: it is everything that waits).
  (function () {
    var c = document.querySelector('nav .rooms a[href="/rum/hjem"] .count');
    visTal(c ? Number(c.textContent) || 0 : 0);
  })();
  function setBusy(el, text) {
    clearBusy();
    if (!el) return;
    busyEl = el;
    el.classList.add('is-busy');
    el.setAttribute('data-busy', 'Hermes ' + (text || 'arbejder …'));
  }
  function clearBusy() {
    if (busyEl) { busyEl.classList.remove('is-busy'); busyEl.removeAttribute('data-busy'); busyEl = null; }
  }
  // KC-0064 phase 3 (rule 5): an element this browser has not seen gets a dot until it has been
  // half in view for 2 s; a changed or moved element it has seen gets a short ring (also when it moves into Ordnet).
  var sete = window.kcMorph.SeteIds(lager(), 1000, 'kc-sete:' + (roomId || ''));
  function lager() { try { return window.localStorage; } catch (e) { return null; } }
  var venterSet = new WeakMap();
  var synlig = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var el = en.target;
      if (en.isIntersecting && en.intersectionRatio >= 0.5) {
        if (!venterSet.has(el)) venterSet.set(el, setTimeout(function () { settet(el); }, 2000));
      } else if (venterSet.has(el)) { clearTimeout(venterSet.get(el)); venterSet.delete(el); }
    });
  }, { threshold: 0.5 }) : null;
  function settet(el) {
    venterSet.delete(el);
    if (synlig) synlig.unobserve(el);
    if (!el.isConnected) return;
    sete.tilfoej([el.getAttribute('data-id')]);
    el.classList.remove('is-ny'); el.classList.add('is-set');
  }
  // els: the elements to look at (with everything under them); ring: the ones just inserted or replaced.
  function marker(els, ring) {
    var alle = [];
    els.forEach(function (el) {
      alle.push(el);
      el.querySelectorAll('[data-id]').forEach(function (d) { alle.push(d); });
    });
    if (sete.baseline || !synlig) { sete.tilfoej(alle.map(function (el) { return el.getAttribute('data-id'); })); return; }
    alle.forEach(function (el) {
      var id = el.getAttribute('data-id');
      if (!sete.har(id)) {
        // No dots in the folded Ordnet band: what lands there is seen at once.
        if (el.closest('[data-baand="ordnet"]')) sete.tilfoej([id]); else { el.classList.add('is-ny'); synlig.observe(el); }
        return;
      }
      if (ring.indexOf(el) < 0) return;
      el.classList.add('is-endret');
      setTimeout(function () { el.classList.remove('is-endret'); }, 1500);
    });
  }
  if (roomEl) marker(Array.prototype.slice.call(roomEl.querySelectorAll('[data-id]')).filter(function (el) { return !el.parentElement.closest('[data-id]'); }), []);

  // KC-0064: the room morphs in place — only what the server changed is replaced, the rest stays as Henrik left it.
  function morphRoom(html) {
    var r = window.kcMorph.morph(roomEl, html);
    // A button disabled while its run went is client state the morph keeps; the server never renders one disabled.
    roomEl.querySelectorAll('button[disabled]').forEach(function (b) { b.disabled = false; });
    clearBusy();
    setKontekst(kontekst);
    decorate(roomEl); aabnFolds(roomEl);
    var roert = r.nye.concat(r.endrede);
    marker(roert, roert);
  }
  function swapRoom(html) {
    if (!roomEl || !html) return;
    // KC-0030: the run's HTML is the univers page; on the meeting page the meeting view is fetched again instead.
    if (body.dataset.moedeId) { opfriskMoede(); return; }
    morphRoom(html);
  }

  function opfriskMoede() {
    fetch(location.pathname, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (t) {
      if (!t) return;
      var nyt = new DOMParser().parseFromString(t, 'text/html').getElementById('room');
      if (!nyt || !roomEl) return;
      morphRoom(nyt.innerHTML);
    }).catch(function () { /* the next change retries */ });
  }

  function follow(runId, opts) {
    var deltaEl = null;
    var forsoeg = 0;   // KC-0083: tries to pick the run up again after a dropped connection
    var forfra = false; // a reopened stream replays the run's events from the start
    busy++;
    setStatus(opts.startText || 'arbejder …', 'busy');
    function slut(text) {
      busy--;
      if (chatEl) chatEl.querySelectorAll('.msg-status').forEach(function (m) { m.remove(); });
      if (opts.chat) addMsg('hermes', 'Fejl: ' + text, 'msg-status'); else toast('Fejl: ' + text, true);
      setStatus('fejl: ' + text.slice(0, 60), 'bad');
      clearBusy();
      document.querySelectorAll('button[disabled]').forEach(function (b) { b.disabled = false; });
      if (opts.onDone) opts.onDone(null);
    }
    // KC-0083: the connection dropped, not the run — wait, look again, and follow it to its end.
    function samlOp() {
      var om = window.KCFoelg.ventOm(forsoeg++);
      if (om === null) { slut('forbindelsen kom ikke tilbage — Hermes arbejder måske videre'); return; }
      setStatus('forbindelsen røg — venter på den', 'busy');
      setTimeout(function () {
        fetch('/api/koe', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (k) {
          if (window.KCFoelg.skridt(k.runs || [], runId) === 'foelg') { forfra = true; aabn(); return; }
          // Gone (the server restarted mid-run): the room shows what it managed; Henrik decides whether to press again.
          busy--;
          clearBusy();
          document.querySelectorAll('button[disabled]').forEach(function (b) { b.disabled = false; });
          fetch('/api/rum/' + encodeURIComponent(roomId || 'hjem') + '/fragment').then(function (r) { return r.json(); }).then(function (d) { swapRoom(d.html); updateNav(d.venter); }).catch(function () { /* the live stream catches up */ });
          toast('Handlingen blev afbrudt undervejs. Rummet er hentet igen — tryk igen, hvis den mangler.', true);
          setStatus('Klar', 'ok');
          if (opts.onDone) opts.onDone(null);
        }).catch(samlOp);
      }, om);
    }
    function aabn() {
      var es = new EventSource('/api/runs/' + encodeURIComponent(runId) + '/events');
      es.addEventListener('open', function () { forsoeg = 0; });
      es.addEventListener('status', function (e) {
        var d = JSON.parse(e.data);
        setStatus(d.text, 'busy');
        if (opts.statusInChat && !deltaEl) addMsg('hermes', 'Hermes ' + d.text + ' …', 'msg-status');
      });
      es.addEventListener('delta', function (e) {
        var d = JSON.parse(e.data);
        if (!opts.chat) return;
        if (!deltaEl) {
          if (chatEl) chatEl.querySelectorAll('.msg-status').forEach(function (m) { m.remove(); });
          deltaEl = addMsg('hermes', '');
        }
        if (deltaEl && forfra) { deltaEl.textContent = ''; forfra = false; }
        if (deltaEl) deltaEl.textContent += d.text;
        if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
      });
      es.addEventListener('done', function (e) {
        var d = JSON.parse(e.data);
        es.close(); busy--; lastDone = Date.now();
        if (chatEl) chatEl.querySelectorAll('.msg-status').forEach(function (m) { m.remove(); });
        if (opts.chat && d.text) {
          if (deltaEl) { deltaEl.textContent = d.text; var mm = deltaEl.closest('.msg'); if (mm && stemmeOn) { mm.setAttribute('data-sig', d.text); decorate(chatEl); } } else addMsg('hermes', d.text);
          if (opts.spoken) sig(d.text, null);
        } else if (d.text && !opts.chat && !d.html) {
          toast(d.text, false);
        }
        if (d.html) swapRoom(d.html); else clearBusy();
        updateNav(d.venter);
        setStatus(d.hermesStatus || 'Klar', 'ok');
        if (opts.onDone) opts.onDone(d);
      });
      es.addEventListener('error', function (e) {
        es.close();
        var text = 'Hermes fejlede';
        if (e.data) { try { text = JSON.parse(e.data).text || text; } catch (err) { /* keep the plain text */ } slut(text); return; }
        forbindelseTabt();
        samlOp();
      });
    }
    aabn();
  }

  // KC-0122: a red button (data-kraever-ja) first asks the server for a one-time yes for exactly this press.
  function medJa(payload, ja) {
    if (!ja) return Promise.resolve(payload || {});
    return fetch('/api/graense/ja', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ja) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ja) throw new Error(j.error || ('HTTP ' + r.status)); return Object.assign({}, payload || {}, { ja: j.ja }); }); });
  }

  function start(url, payload, opts) {
    return medJa(payload, opts && opts.ja)
      .then(function (p) { return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }); })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) {
        if (j.aabn) { gaaTilRum(j); return; }
        // KC-0098: the chat answered itself (Hvad kan jeg sige?); no run to follow.
        if (j.svar) { addMsg('hermes', j.svar); return; }
        follow(j.runId, opts);
      })
      .catch(function (err) { toast('Fejl: ' + fejlTekst(err), true); setStatus('fejl', 'bad'); clearBusy(); document.querySelectorAll('button[disabled]').forEach(function (b) { b.disabled = false; }); });
  }

  // KC-0052: the chat asked for a room ("jeg vil skrive"): go there; the rest of the sentence follows to its chat.
  function gaaTilRum(j) {
    if (j.videre) { try { sessionStorage.setItem('kc-videre', j.videre); } catch (e) { /* the room opens anyway */ } }
    location.assign(j.aabn);
  }

  // KC-0096: the one open Senere choice (if any), closed again; Esc and a second choice use this.
  function senereAaben() { return document.querySelector('[data-senere-valg]:not([hidden])'); }
  function lukSenere() {
    var valg = senereAaben();
    if (!valg) return null;
    valg.hidden = true;
    var kortEl = valg.closest('[data-kort-id]');
    var aabn = kortEl ? kortEl.querySelector('[data-senere-aabn]') : null;
    if (aabn) aabn.setAttribute('aria-expanded', 'false');
    return aabn;
  }

  function elementOf(btn) { return btn.closest('[data-element]') || btn.closest('.card') || null; }

  // KC-0028: the cards of Hjem. The server answers {runId} (a Hermes run to follow) or {ok} (done at once);
  // either way Hjem is fetched again so the cards, the counts and the log are what the server now says.
  function refetchHjem() {
    return fetch('/api/rum/hjem/fragment').then(function (r) { return r.json(); }).then(function (d) { swapRoom(d.html); updateNav(d.venter); }).catch(function () { /* next click retries */ });
  }
  // KC-0128: a Start connect card goes straight to the connector registry; then to the login, to Nu, or the page again.
  function kildeForbind(btn) {
    var f = document.getElementById(btn.dataset.form);
    if (f && typeof f.reportValidity === 'function' && !f.reportValidity()) return;
    var par = [];
    var laes = [];
    var forStor = null;
    // KC-0137: a file field sends the file's text (an OPML export); the server checks the size again.
    if (f) new FormData(f).forEach(function (v, k) {
      if (v && typeof v === 'object' && typeof v.text === 'function') {
        var felt = f.elements[k];
        var maks = felt && felt.dataset ? Number(felt.dataset.maks) : 0;
        if (maks && v.size > maks) forStor = 'Filen er for stor';
        laes.push(v.text().then(function (t) { par.push([k, t]); }));
      } else par.push([k, v]);
    });
    if (forStor) { toast('Fejl: ' + forStor, true); return; }
    btn.disabled = true;
    setBusy(elementOf(btn), (btn.dataset.status || btn.textContent.trim()) + ' …');
    Promise.all(laes)
      .then(function () { return fetch('/api/kilder/' + encodeURIComponent(btn.dataset.kildeForbind) + '/forbind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(window.KCKilde.krop(par)) }); })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) { location.assign(window.KCKilde.naeste(j, btn.dataset.efter || null, location.pathname)); })
      .catch(function (err) { btn.disabled = false; clearBusy(); toast('Fejl: ' + fejlTekst(err), true); });
  }

  // KC-0139: "Fjern forbindelsen" on a connection card takes two taps (it removes the access); then Nu is fetched again.
  function kildeFjern(btn) {
    if (!btn.hasAttribute('data-bekraeft')) { btn.setAttribute('data-bekraeft', ''); btn.textContent = 'Fjern? Tryk igen'; return; }
    btn.disabled = true;
    fetch('/api/kilder/' + encodeURIComponent(btn.dataset.kildeFjern) + '/frakobl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); }); })
      .then(refetchHjem)
      .catch(function (err) { btn.disabled = false; btn.removeAttribute('data-bekraeft'); btn.textContent = 'Fjern forbindelsen'; toast('Fejl: ' + fejlTekst(err), true); });
  }

  function kortPost(btn, url, payload, busyText, okText) {
    var kort = btn.closest('[data-kort-id]') || btn.closest('[data-regnskab-id]') || btn.closest('.log-row');
    var foer = fortrydIder();
    var udfoert = function () { tilbydFortryd(foer, busyText.charAt(0).toUpperCase() + busyText.slice(1) + ' — udført'); };
    btn.disabled = true;
    setBusy(kort, busyText + ' …');
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) {
        if (j.runId) follow(j.runId, { startText: busyText + ' …', onDone: function (d) { refetchHjem().then(function () { if (d) udfoert(); }); } });
        else { if (okText) toast(okText, false); return refetchHjem().then(udfoert); }
      })
      .catch(function (err) { toast('Fejl: ' + fejlTekst(err), true); clearBusy(); btn.disabled = false; });
  }
  // KC-0144: Ja / Nej tak on "Skal jeg gøre det til en regel?". Ja fetches a one-time yes for exactly this proposal (a real tap
  // on the button, never a script of Hermes'); then the server writes the rule and Hjem shows the log line with its Fortryd.
  function regelforslagSvar(btn, hvad, id) {
    var foer = fortrydIder();
    btn.disabled = true;
    medJa({}, hvad === 'godkend' ? { rum: 'hjem', slags: 'forslag', id: id } : null)
      .then(function (p) { return fetch('/api/tillid/forslag/' + encodeURIComponent(id) + '/' + hvad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }); })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function () {
        if (hvad === 'afvis') toast('Nej tak. Jeg foreslår det ikke igen de næste 30 dage.', false);
        return refetchHjem().then(function () { if (hvad === 'godkend') tilbydFortryd(foer, 'Det er nu en regel'); });
      })
      .catch(function (err) { toast('Fejl: ' + fejlTekst(err), true); btn.disabled = false; });
  }
  // KC-0145: the Sunday sample. Rigtigt / Skulle have vist mig det on one line, and the stop question; the server records
  // each answer once, and Nu redraws (the card folds away when every line is answered).
  function soendagSvar(btn, url, body, okText) {
    btn.disabled = true;
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function () { if (okText) toast(okText, false); return refetchHjem(); })
      .catch(function (err) { toast('Fejl: ' + fejlTekst(err), true); btn.disabled = false; });
  }
  function kopier(text) {
    // The clipboard API needs permission/a secure page; the textarea fallback works without.
    function gammel() {
      return new Promise(function (resolve, reject) {
        var t = document.createElement('textarea');
        t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
        document.body.appendChild(t); t.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        t.remove();
        if (ok) resolve(); else reject(new Error('kunne ikke kopiere'));
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(gammel);
    return gammel();
  }
  // One canonical copy + confirmation, shared by Kopiér and Del's laptop fallback (KC-0102).
  function kopierMedBesked(text, besked) {
    return kopier(text).then(function () { toast(besked, false); }).catch(function (err) { toast('Kunne ikke kopiere: ' + fejlTekst(err), true); });
  }
  // KC-0102: Del opens the device's share sheet; without one (most laptops) the link is copied. Cancelling the sheet is silent.
  function del(titel, url) {
    if (!navigator.share) return kopierMedBesked(url, 'Link kopieret');
    return navigator.share({ title: titel, url: url }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      return kopierMedBesked(url, 'Link kopieret');
    });
  }
  function kortHandling(btn) {
    // A card, or a row of "Skrevet i regnskab" (a written row whose card is gone): both are addressed by card id.
    var kortEl = btn.closest('[data-kort-id]');
    var raekkeEl = kortEl ? null : btn.closest('[data-regnskab-id]');
    var kortId = kortEl ? kortEl.getAttribute('data-kort-id') : raekkeEl ? raekkeEl.getAttribute('data-regnskab-id') : '';
    var base = kortId ? '/api/rum/hjem/kort/' + encodeURIComponent(kortId) : '';
    if (btn.dataset.kortHandling) {
      kortPost(btn, '/api/rum/hjem/kort/' + encodeURIComponent(btn.dataset.kortHandling) + '/handling', {}, btn.textContent.trim());
      return true;
    }
    if (btn.dataset.ccKort) {
      var betyder = kortEl ? (kortEl.querySelector('.betydning') || {}).textContent || '' : '';
      // KC-0046: an app-made sentence Henrik can edit — never Hermes' words (the card is data).
      var fast = btn.dataset.ccProjektNavn ? 'Se på kortet og ret fejlen i ' + btn.dataset.ccProjektNavn + '.' : '';
      aabnCc({ kortId: btn.dataset.ccKort }, btn.dataset.ccTitel || '', fast, betyder, btn.dataset.ccProjekt);
      return true;
    }
    // KC-0045: Henrik answers Claude Code's question with one of its options.
    if (btn.dataset.ccSvar) {
      kortPost(btn, '/api/udvikling/opgaver/' + encodeURIComponent(btn.dataset.ccSvar) + '/svar', { svar: btn.dataset.svar }, 'sender dit svar', 'Svaret er sendt. Claude Code tager den op, næste gang den arbejder i projektet.');
      return true;
    }
    if (btn.dataset.luk) {
      var grund = window.prompt('Hvorfor lukker du det? (fx "klaret i Claude Code" eller "ikke relevant for mig" — Hermes husker det)', '');
      if (grund === null) return true;
      kortPost(btn, '/api/rum/hjem/kort/' + encodeURIComponent(btn.dataset.luk) + '/luk', grund.trim() ? { grund: grund.trim().slice(0, 300) } : {}, 'lukker kortet');
      return true;
    }
    // KC-0096: Senere opens its two choices in the card (no dialog); a choice sends the card away until then.
    if (btn.dataset.senereAabn) {
      var valg = kortEl ? kortEl.querySelector('[data-senere-valg]') : null;
      if (valg) {
        if (valg.hidden) lukSenere();
        valg.hidden = !valg.hidden;
        btn.setAttribute('aria-expanded', valg.hidden ? 'false' : 'true');
        if (!valg.hidden) fokus(valg.querySelector('button'));
      }
      return true;
    }
    if (btn.dataset.senere) {
      kortPost(btn, '/api/rum/hjem/kort/' + encodeURIComponent(btn.dataset.senereKort) + '/senere', { til: btn.dataset.senere }, 'udsætter kortet');
      return true;
    }
    if (btn.dataset.regnskab) {
      var hvad = btn.dataset.regnskab;
      kortPost(btn, base + '/regnskab/' + hvad, {}, hvad === 'fortryd' ? 'fortryder' : hvad === 'flyt' ? 'flytter' : 'skriver i regnskabet', hvad === 'fortryd' ? 'Regnskabslinjen er fjernet.' : 'Regnskabet er opdateret.');
      return true;
    }
    if (btn.dataset.regelforslagJa) { regelforslagSvar(btn, 'godkend', btn.dataset.regelforslagJa); return true; }
    if (btn.dataset.regelforslagNej) { regelforslagSvar(btn, 'afvis', btn.dataset.regelforslagNej); return true; }
    if (btn.dataset.stikproeveSvar) {
      var forkert = btn.dataset.stikproeveSvar === 'forkert';
      soendagSvar(btn, '/api/tillid/stikproeve/' + encodeURIComponent(btn.dataset.uge) + '/' + encodeURIComponent(btn.dataset.id), { svar: btn.dataset.stikproeveSvar },
        forkert ? 'Noteret. Hermes ser på, hvad der skal ændres; et forslag kommer i Nu.' : '');
      return true;
    }
    if (btn.dataset.soendagstjekStopSvar) {
      var stopJa = btn.dataset.soendagstjekStopSvar === 'ja';
      soendagSvar(btn, '/api/tillid/soendagstjek/stop', { svar: btn.dataset.soendagstjekStopSvar }, stopJa ? 'Søndagstjekket er stoppet. Fortryd i loggen tænder det igen.' : 'Søndagstjekket fortsætter.');
      return true;
    }
    if (btn.dataset.hjemFortryd) {
      kortPost(btn, '/api/rum/hjem/fortryd/' + encodeURIComponent(btn.dataset.hjemFortryd), {}, 'fortryder', 'Fortrudt.');
      return true;
    }
    if (btn.dataset.kopier !== undefined) {
      var fra = btn.dataset.kopierFra ? document.getElementById(btn.dataset.kopierFra) : null;
      kopierMedBesked(fra && fra.value.trim() ? fra.value : btn.dataset.kopier, 'Kopieret');
      return true;
    }
    if (btn.dataset.delUrl) {
      del(btn.dataset.delTitel || '', btn.dataset.delUrl);
      return true;
    }
    return false;
  }

  // KC-0041: Send til Claude Code — one dialog for a card and for the chat. Only Henrik's sentence is the task;
  // a card goes as its id (the server copies it), the chat's element as its name.
  var ccDialog = document.getElementById('cc-dialog');
  var ccForm = document.getElementById('cc-form');
  var ccGrundlag = document.getElementById('cc-grundlag');
  var ccKilde = {};
  function aabnCc(kilde, titel, tekst, mere, projekt) {
    if (!ccDialog || !ccForm) return;
    ccKilde = kilde;
    ccForm.elements.saetning.value = tekst || '';
    if (ccGrundlag) { ccGrundlag.hidden = !titel; ccGrundlag.textContent = titel ? (kilde.kortId ? 'Kortet følger med: ' : 'Om: ') + titel : ''; }
    // A card that names a project picks it; otherwise the last choice stays.
    var hay = (titel + ' ' + (mere || '')).toLowerCase();
    ccForm.querySelectorAll('input[name="projekt"]').forEach(function (r) {
      var navn = (r.nextElementSibling ? r.nextElementSibling.textContent : '').toLowerCase();
      if (navn && hay.indexOf(navn) >= 0) r.checked = true;
    });
    // KC-0046: Kuratoren named the project — that one is chosen.
    if (projekt) ccForm.querySelectorAll('input[name="projekt"]').forEach(function (r) { r.checked = r.value === projekt; });
    if (ccDialog.showModal) ccDialog.showModal(); else ccDialog.setAttribute('open', '');
    ccForm.elements.saetning.focus();
  }
  function lukCc() { if (!ccDialog) return; if (ccDialog.close) ccDialog.close(); else ccDialog.removeAttribute('open'); }
  var ccAnnuller = document.getElementById('cc-annuller');
  if (ccAnnuller) ccAnnuller.addEventListener('click', lukCc);
  var ccChat = document.getElementById('cc-chat');
  if (ccChat) ccChat.addEventListener('click', function () {
    var valgt = document.querySelector('.kort.is-selected[data-kort-id]');
    var knap = valgt ? valgt.querySelector('[data-cc-kort]') : null;
    if (knap) aabnCc({ kortId: knap.dataset.ccKort, fraChat: true }, knap.dataset.ccTitel || '', input ? input.value : '', (valgt.querySelector('.betydning') || {}).textContent || '');
    else aabnCc({ kontekst: kontekst || undefined, fraChat: true }, kontekst, input ? input.value : '', '');
  });
  if (ccForm) ccForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var saetning = ccForm.elements.saetning.value.trim();
    if (!saetning) return;
    var payload = { projekt: ccForm.elements.projekt.value, saetning: saetning };
    if (ccKilde.kortId) payload.kortId = ccKilde.kortId; else if (ccKilde.kontekst) payload.kontekst = ccKilde.kontekst;
    var send = ccForm.querySelector('button[type="submit"]');
    send.disabled = true;
    fetch('/api/udvikling/opgaver', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function () {
        send.disabled = false;
        lukCc();
        if (ccKilde.fraChat && input) input.value = '';
        toast('Sendt til Claude Code. Den henter opgaven, næste gang den arbejder i projektet.', false);
        if (roomId === 'hjem') refetchHjem();
      })
      .catch(function (err) { send.disabled = false; toast('Fejl: ' + fejlTekst(err), true); });
  });

  // KC-0146: a rule's Slå fra / Slå til igen on /viden — the rules file changes only with a fresh human tap (KC-0123).
  if (roomEl) roomEl.addEventListener('submit', function (ev) {
    var f = ev.target.closest('form[data-regel-form]');
    if (!f) return;
    ev.preventDefault();
    var knap = f.querySelector('button[type="submit"]');
    if (knap) knap.disabled = true;
    medJa({}, { rum: 'viden', slags: 'regel', id: f.dataset.regelForm })
      .then(function (p) { return fetch(f.getAttribute('action'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }); })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); location.assign('/viden'); }); })
      .catch(function (err) { if (knap) knap.disabled = false; toast('Fejl: ' + fejlTekst(err), true); });
  });

  // KC-0045: ... or in his own words.
  if (roomEl) roomEl.addEventListener('submit', function (ev) {
    var f = ev.target.closest('form[data-cc-svar-form]');
    if (!f) return;
    ev.preventDefault();
    var svar = f.elements.svar.value.trim();
    if (svar) kortPost(f.querySelector('button[type="submit"]'), '/api/udvikling/opgaver/' + encodeURIComponent(f.dataset.ccSvarForm) + '/svar', { svar: svar }, 'sender dit svar', 'Svaret er sendt. Claude Code tager den op, næste gang den arbejder i projektet.');
  });

  if (roomEl) {
    roomEl.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (btn) {
        if (btn.dataset.lyt !== undefined || btn.dataset.mic !== undefined || btn.dataset.sig !== undefined) return; // handled by the stemme layer
        if (kortHandling(btn)) return;
        if (btn.dataset.kildeForbind) { kildeForbind(btn); return; }
        if (btn.dataset.kildeFjern) { kildeFjern(btn); return; }
        if (btn.dataset.handling) {
          btn.disabled = true;
          setBusy(elementOf(btn), btn.textContent.trim() + ' …');
          var foerH = fortrydIder(), navnH = btn.textContent.trim();
          start('/api/rum/' + roomId + '/handlinger/' + encodeURIComponent(btn.dataset.handling), {}, { ja: btn.hasAttribute('data-kraever-ja') ? { rum: roomId, slags: 'handling', id: btn.dataset.handling } : null, startText: navnH + ' …', onDone: function (d) { if (d) tilbydFortryd(foerH, navnH + ' — udført'); } });
          return;
        }
        if (btn.dataset.fortryd) {
          btn.disabled = true;
          setBusy(btn.closest('.log-row'), 'fortryder …');
          start('/api/rum/' + roomId + '/log/' + encodeURIComponent(btn.dataset.fortryd) + '/fortryd', {}, { startText: 'fortryder …' });
          return;
        }
        if (btn.dataset.opdater) {
          btn.disabled = true;
          setBusy(roomEl.querySelector('.card'), btn.dataset.opdater === 'hent' ? 'henter …' : 'bygger rummet …');
          start('/api/rum/' + roomId + '/opdater', { mode: btn.dataset.opdater }, { startText: btn.dataset.opdater === 'hent' ? 'henter dagens data …' : 'bygger rummet …' });
          return;
        }
        if (btn.dataset.aktion) {
          if (btn.dataset.confirm && !window.confirm(btn.dataset.confirm)) return;
          var arg = {};
          try { arg = btn.dataset.arg ? JSON.parse(btn.dataset.arg) : {}; } catch (err) { arg = {}; }
          if (btn.dataset.prompt) {
            var fields = btn.dataset.prompt.split('|');
            for (var k = 0; k < fields.length; k++) {
              var parts = fields[k].split('=');
              var v = window.prompt(parts[1] || parts[0], '');
              if (v === null) return;
              arg[parts[0]] = v;
            }
          }
          if (btn.dataset.form) {
            var f = document.getElementById(btn.dataset.form);
            if (f) { new FormData(f).forEach(function (val, key) { arg[key] = val; }); }
          }
          btn.disabled = true;
          setBusy(elementOf(btn), (btn.dataset.status || btn.textContent.trim()) + ' …');
          // A new or archived univers names where to go next (so the nav shows it).
          var foerA = fortrydIder(), navnA = btn.textContent.trim();
          start('/api/rum/' + roomId + '/aktion/' + encodeURIComponent(btn.dataset.aktion), arg, { ja: btn.hasAttribute('data-kraever-ja') ? { rum: roomId, slags: 'aktion', id: btn.dataset.aktion, body: arg } : null, startText: (btn.dataset.status || navnA) + ' …', onDone: function (d) { if (d && d.url && d.url !== location.pathname) { location.assign(d.url); return; } if (d) tilbydFortryd(foerA, navnA + ' — udført'); } });
          return;
        }
        if (btn.dataset.visAlle) {
          document.querySelectorAll('.' + btn.dataset.visAlle).forEach(function (el) { el.hidden = false; });
          btn.closest('.row').remove();
          return;
        }
        if (btn.dataset.ask !== undefined) {
          setKontekst(btn.dataset.ask);
          openChat(true);
          return;
        }
      }
      if (ev.target.closest('a')) return;
      if (ev.target.closest('input, textarea, select, label')) return;
      var el = ev.target.closest('[data-element]');
      if (el) {
        setKontekst(el.dataset.element === kontekst ? '' : el.dataset.element);
        if (kontekst && narrow()) { /* keep the page where it is; the toggle shows the marker */ }
      }
    });
  }

  // KC-0030: a page may preset the chat context (the meeting page: "Mødet: <titel>"); the server renders the chip, the client adopts it.
  if (chipWrap && chipEl && !chipWrap.hidden) setKontekst(chipEl.textContent.replace(/^Om: /, ''));
  var ryd = document.getElementById('kontekst-ryd');
  if (ryd) ryd.addEventListener('click', function () { setKontekst(''); });
  if (toggle) toggle.addEventListener('click', function () { openChat(true); });
  var close = document.getElementById('chat-close');
  if (close) close.addEventListener('click', closeChat);
  // KC-0090: Esc closes one thing per press, the innermost first (order in public/esc.js), and the
  // keyboard lands back on the button that opened it. Native dialogs close themselves.
  function fokus(el) { if (el && el.getClientRects().length) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } } }
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || document.querySelector('dialog[open]')) return;
    var hvad = window.KCEsc.foerst({
      senere: !!senereAaben(),
      koe: !!(koePanel && !koePanel.hidden),
      samtale: !!(samPanel && !samPanel.hidden),
      chat: body.classList.contains('chat-open') && narrow(),
      kontekst: !!kontekst,
    });
    if (!hvad) return;
    ev.preventDefault();
    if (hvad === 'senere') fokus(lukSenere());
    else if (hvad === 'koe') { koePanel.hidden = true; koeToggle.setAttribute('aria-expanded', 'false'); fokus(koeToggle); }
    else if (hvad === 'samtale') { endSamtale(); samPanel.hidden = true; fokus(samToggle); }
    else if (hvad === 'chat') { closeChat(); fokus(toggle); }
    else setKontekst('');
  });
  // KC-0080: shortcuts on the laptop (rules in public/genveje.js; the help is one ? away).
  var genvejeDialog = document.getElementById('genveje-dialog');
  document.addEventListener('keydown', function (ev) {
    if (document.querySelector('dialog[open]')) return; // an open dialog has the keyboard
    var el = ev.target;
    var iFelt = !!(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
    var h = window.KCGenveje.handling({ key: ev.key, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, altKey: ev.altKey, iFelt: iFelt });
    if (!h) return;
    if (h.type === 'rum') {
      // The n-th room the menu shows now (KC-0052: hidden rooms have no number).
      var vist = Array.prototype.filter.call(document.querySelectorAll('nav .rooms > li'), function (li) { return !li.hidden; });
      var maal = vist[h.nr - 1] && vist[h.nr - 1].querySelector('a');
      if (!maal) return;
      ev.preventDefault();
      maal.click();
    } else if (h.type === 'chat') {
      if (!input) return;
      ev.preventDefault();
      openChat(true);
      input.focus();
    } else if (genvejeDialog && genvejeDialog.showModal) {
      ev.preventDefault();
      genvejeDialog.showModal();
    }
  });

  if (form && input) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var besked = input.value.trim();
      if (!besked) return;
      addMsg('henrik', besked);
      input.value = '';
      window.KCKladde.gem(lager(), chatRoom(), '');
      var spoken = input.dataset.spoken === '1'; input.dataset.spoken = '';
      // KC-0077: the suggestions are for starting; once Henrik has said something they go.
      var forslag = document.getElementById('chat-forslag'); if (forslag) forslag.remove();
      start('/api/rum/' + roomId + '/chat', { besked: besked, kontekst: kontekst || undefined, enhed: enhed(), aabn: true }, { chat: true, statusInChat: true, startText: 'svarer …', spoken: spoken });
    });
    // The same path as typing and pressing Send: the sentence goes into the field and the form submits.
    function sendSomTastet(tekst) { input.value = tekst; if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true })); }
    // KC-0077: a tap on a suggestion in the empty chat.
    var forslagEl = document.getElementById('chat-forslag');
    if (forslagEl) forslagEl.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-forslag]') : null;
      if (b) sendSomTastet(b.getAttribute('data-forslag'));
    });
    var videre = null;
    try { videre = sessionStorage.getItem('kc-videre'); sessionStorage.removeItem('kc-videre'); } catch (e) { /* no storage: nothing to send on */ }
    if (videre) { openChat(false); sendSomTastet(videre); }
    // KC-0087: what Henrik was writing is still there after a reload or a trip to another room.
    else if (!input.value) input.value = window.KCKladde.hent(lager(), chatRoom());
    input.addEventListener('input', function () { window.KCKladde.gem(lager(), chatRoom(), input.value); });
  }

  // Live refresh: when the room changes elsewhere (morning build, another tab), refetch the fragment.
  // KC-0071: also when a change may have been missed — the stream reconnected, the phone slept,
  // the tab was in the background, the network came back (rules in public/frisk.js).
  if (roomEl && roomId && body.dataset.live && window.EventSource) {
    var known = -1;
    var refetchTimer = null;
    var forsoeg = 0;
    var skjultSiden = null;
    function refetch() {
      refetchTimer = null;
      if (busy > 0 || Date.now() - lastDone < 1500) { refetchTimer = setTimeout(refetch, 1500); return; }
      fetch('/api/rum/' + roomId + '/fragment').then(function (r) { return r.json(); }).then(function (d) {
        if (typeof d.version === 'number') known = d.version;
        swapRoom(d.html); updateNav(d.venter); setStatus(d.hermesStatus || 'Klar', 'ok');
      }).catch(function () { /* next change will retry */ });
    }
    function hentSnart() { if (!refetchTimer) refetchTimer = setTimeout(refetch, busy > 0 || Date.now() - lastDone < 1500 ? 1500 : 0); }
    function aabnLive() {
      var live = new EventSource('/api/rum/' + roomId + '/live');
      live.addEventListener('hello', function (e) {
        forsoeg = 0;
        forbindelseOk();
        var h = window.KCFrisk.vedHello(known, JSON.parse(e.data).version);
        known = h.kendt;
        if (h.hent) hentSnart();
      });
      live.addEventListener('changed', function (e) {
        var v = JSON.parse(e.data).version;
        if (v === known) return;
        known = v;
        hentSnart();
      });
      // The browser retries a dropped stream by itself, but gives up for good on an error answer
      // (502 while the service restarts after a deploy) — then we open a new one.
      live.addEventListener('error', function () {
        forbindelseTabt();
        if (live.readyState === EventSource.CLOSED) setTimeout(aabnLive, window.KCFrisk.genforbindOm(forsoeg++));
      });
    }
    aabnLive();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { skjultSiden = Date.now(); return; }
      if (window.KCFrisk.vedSynlig(skjultSiden, Date.now())) hentSnart();
      skjultSiden = null;
    });
    window.addEventListener('online', hentSnart);
    window.addEventListener('kc-forbindelse-tilbage', hentSnart);
  }

  // Queue panel + notifications (all rooms): what Hermes is doing, and a word when something is ready.
  var koeToggle = document.getElementById('koe-toggle');
  var koePanel = document.getElementById('koe-panel');
  var koeList = document.getElementById('koe-list');
  var koeCount = document.getElementById('koe-count');
  var notifBtn = document.getElementById('notif-btn');
  var ROOM_NAMES = { hjem: 'Nu', dagen: 'Dagen', mail: 'Mail', skrive: 'Skrive', nyheder: 'Nyheder', univers: 'Univers' };
  function fmtTime(ms) { return new Date(ms).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }).replace(':', '.'); }
  function renderKoe(runsList, nuMs) {
    if (!koeList) return;
    koeList.textContent = '';
    if (!runsList.length) { var p = document.createElement('p'); p.className = 'muted row'; p.textContent = 'Intet i gang.'; koeList.appendChild(p); return; }
    runsList.slice(0, 15).forEach(function (r) {
      var row = document.createElement('div'); row.className = 'koe-row';
      var time = document.createElement('span'); time.className = 'mono time'; time.textContent = fmtTime(r.finishedAt || r.startedAt);
      var main = document.createElement('span'); main.className = 'row-main';
      var title = document.createElement('span'); title.className = 'row-title'; title.textContent = r.label;
      main.appendChild(title);
      // A failed run's own text is an error message for developers; Henrik gets the plain fact.
      var tekst = r.status === 'failed' ? 'Det lykkedes ikke. Prøv igen.' : r.text;
      if (tekst) { var note = document.createElement('span'); note.className = 'row-note'; note.textContent = tekst.slice(0, 140); main.appendChild(note); }
      var st = document.createElement('span'); st.className = 'koe-status ' + r.status;
      st.textContent = window.KCKoe.status(r, nuMs);
      row.appendChild(time); row.appendChild(main); row.appendChild(st);
      if (r.room && r.room !== roomId) { var a = document.createElement('a'); a.href = '/rum/' + r.room; a.className = 'btn btn-ghost'; a.textContent = 'Åbn'; row.appendChild(a); }
      koeList.appendChild(row);
    });
  }
  // KC-0124: "Hvad Clawco har gjort" — the server renders the lines (escaped); the filter shows only the refusals.
  var revisionListe = document.querySelector('[data-revision="liste"]');
  var revisionFilter = document.querySelector('[data-revision-filter]');
  if (revisionFilter && revisionListe) revisionFilter.addEventListener('click', function () {
    var paa = revisionFilter.getAttribute('aria-pressed') !== 'true';
    revisionFilter.setAttribute('aria-pressed', paa ? 'true' : 'false');
    if (paa) revisionListe.setAttribute('data-kun-nej', ''); else revisionListe.removeAttribute('data-kun-nej');
  });
  // KC-0120: "Kilder" — the server renders the connected sources (escaped) while the panel is open; Frakobl takes two taps.
  var kilderPanel = document.querySelector('[data-kilder="panel"]');
  if (kilderPanel) kilderPanel.addEventListener('click', function (e) {
    var b = e.target.closest('[data-kilde-frakobl]');
    if (!b || b.disabled) return;
    if (!b.hasAttribute('data-bekraeft')) { b.setAttribute('data-bekraeft', ''); b.textContent = 'Frakobl? Tryk igen'; return; }
    b.disabled = true;
    fetch('/api/kilder/' + encodeURIComponent(b.getAttribute('data-kilde-frakobl')) + '/frakobl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'HTTP ' + r.status); }); loadKoe(); })
      .catch(function (err) {
        b.disabled = false; b.removeAttribute('data-bekraeft'); b.textContent = 'Frakobl';
        var note = b.closest('.kilde-row') && b.closest('.kilde-row').querySelector('.row-note');
        if (note) note.textContent = err.message;
      });
  });
  var omkostningerPanel = document.querySelector('[data-omkostninger="panel"]');
  function loadKoe() {
    var medKilder = kilderPanel && koePanel && !koePanel.hidden;
    fetch('/api/koe' + (medKilder ? '?kilder=1' : '')).then(function (r) { return r.json(); }).then(function (d) {
      renderKoe(d.runs, d.nu); // the server's clock: a phone running minutes off still reads "startet for 2 min siden" right
      if (revisionListe && typeof d.revision === 'string' && d.revision) revisionListe.innerHTML = d.revision;
      // A tap waiting for its confirmation is not swept away by the 15-second refresh.
      if (kilderPanel && typeof d.kilder === 'string' && !kilderPanel.querySelector('[data-bekraeft]:not([disabled])')) { kilderPanel.innerHTML = d.kilder; kilderPanel.hidden = !d.kilder; }
      // KC-0212: the owner's cost card, rendered (escaped) by the server while the panel is open; '' = no card.
      if (omkostningerPanel && typeof d.omkostninger === 'string') { omkostningerPanel.innerHTML = d.omkostninger; omkostningerPanel.hidden = !d.omkostninger; }
      var active = d.runs.filter(function (r) { return r.status === 'running' || r.status === 'queued'; }).length;
      if (koeCount) { koeCount.hidden = !active; koeCount.textContent = String(active); }
    }).catch(function () {});
  }
  // KC-0124: Stop alt (one tap, no question: it is the emergency stop) and Start igen. The page reloads into the new state.
  document.querySelectorAll('[data-nodstop="stop"], [data-nodstop="genoptag"]').forEach(function (b) {
    b.addEventListener('click', function () {
      var url = b.getAttribute('data-nodstop') === 'stop' ? '/api/nodstop' : '/api/nodstop/genoptag';
      b.disabled = true;
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || 'HTTP ' + r.status); }); location.reload(); })
        .catch(function (err) {
          b.disabled = false;
          var note = b.closest('.nodstop, .pause-baand') && b.closest('.nodstop, .pause-baand').querySelector('.row-note');
          if (note) note.textContent = err.message;
        });
    });
  });
  if (koeToggle && koePanel) {
    koeToggle.addEventListener('click', function () {
      var open = koePanel.hidden;
      koePanel.hidden = !open;
      koeToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) loadKoe();
    });
    var koeClose = document.getElementById('koe-close');
    if (koeClose) koeClose.addEventListener('click', function () { koePanel.hidden = true; koeToggle.setAttribute('aria-expanded', 'false'); fokus(koeToggle); });
    loadKoe();
    // While the panel is open the "startet for … siden" words keep up, and runs started elsewhere show.
    setInterval(function () { if (!koePanel.hidden && !document.hidden) loadKoe(); }, 15000);
  }
  // KC-0068: the per-device test switch. Real mode: "Testtilstand" turns it on; in test mode (window.KC_TEST) the same button turns it off.
  var testKnap = document.getElementById('test-knap');
  if (testKnap) {
    var testHint = document.getElementById('test-hint');
    var testFejl = document.getElementById('test-fejl');
    var testTil = !!window.KC_TEST;
    if (testTil) { testKnap.textContent = 'Sluk testtilstand'; if (testHint) testHint.hidden = true; }
    testKnap.addEventListener('click', function () {
      testKnap.disabled = true;
      if (testFejl) testFejl.textContent = '';
      fetch(testTil ? '/test/sluk' : '/test/taend', { method: 'POST' }).then(function (r) {
        return r.text().then(function (t) {
          var d = null;
          try { d = JSON.parse(t); } catch (e) { /* plain text */ }
          if (r.ok && d && typeof d.url === 'string') { location.href = d.url; return; }
          throw new Error((d && d.error) || t || 'Testtilstand fejlede');
        });
      }).catch(function (e) {
        testKnap.disabled = false;
        if (testFejl) testFejl.textContent = e && e.message ? e.message : 'Testtilstand fejlede';
      });
    });
  }
  if (notifBtn && window.Notification) {
    notifBtn.hidden = Notification.permission === 'granted' || Notification.permission === 'denied';
    notifBtn.addEventListener('click', function () { Notification.requestPermission().then(function () { notifBtn.hidden = Notification.permission !== 'default'; }); });
  }
  var indForm = document.getElementById('indstillinger');
  var indGem = document.getElementById('indstillinger-gem');
  var indStatus = document.getElementById('indstillinger-status');
  // KC-0100: the stored value stays the model's id; Henrik reads a human name under the field.
  function visModelNavne() {
    ['lille', 'taenker'].forEach(function (felt) {
      var spot = indForm.querySelector('[data-model-navn="' + felt + '"]');
      // An empty field already says "Hermes' standard"; the line only names a model that was typed.
      if (spot) { var v = indForm.elements[felt].value.trim(); spot.textContent = v ? 'Bruger: ' + window.KCKoe.modelNavn(v) : ''; spot.hidden = !v; }
    });
  }
  function loadIndstillinger() {
    if (!indForm) return;
    fetch('/api/indstillinger').then(function (r) { return r.json(); }).then(function (d) {
      indForm.elements.lille.value = d.modeller.lille || '';
      indForm.elements.taenker.value = d.modeller.taenker || '';
      visModelNavne();
      if (indForm.elements.voiceId) indForm.elements.voiceId.value = (d.stemme && d.stemme.voiceId) || '';
    }).catch(function () {});
  }
  if (indGem && indForm) {
    loadIndstillinger();
    indForm.addEventListener('input', visModelNavne);
    visModelNavne();
    indGem.addEventListener('click', function () {
      var payload = { modeller: { lille: indForm.elements.lille.value, taenker: indForm.elements.taenker.value } };
      if (indForm.elements.voiceId) payload.stemme = { voiceId: indForm.elements.voiceId.value };
      fetch('/api/indstillinger', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); })
        .then(function (d) { indForm.elements.lille.value = d.modeller.lille || ''; indForm.elements.taenker.value = d.modeller.taenker || ''; visModelNavne(); if (indStatus) { indStatus.textContent = 'Gemt. Gælder, næste gang Hermes går i gang.'; setTimeout(function () { indStatus.textContent = ''; }, 4000); } })
        .catch(function () { if (indStatus) indStatus.textContent = 'Kunne ikke gemme.'; });
    });
  }
  function notify(label, text, room) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = label + (text ? ': ' + text.slice(0, 120) : '');
    if (room && room !== roomId) { var a = document.createElement('a'); a.href = '/rum/' + room; a.textContent = 'Åbn ' + (ROOM_NAMES[room] || room); t.appendChild(a); }
    body.appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
    if (window.Notification && Notification.permission === 'granted' && document.hidden) {
      try { new Notification(label, { body: text || '', tag: label }); } catch (e) { /* ignore */ }
    }
  }
  if (window.EventSource) {
    var global = new EventSource('/api/live');
    global.addEventListener('run.done', function (e) {
      var d = JSON.parse(e.data);
      if (d.room === roomId && busy > 0) return; // this page is already following it
      if (d.room === roomId && Date.now() - lastDone < 1500) return;
      notify((d.status === 'failed' ? 'Fejl: ' : 'Klar: ') + d.label, d.text, d.room);
      loadKoe();
    });
    global.addEventListener('hello', function () { loadKoe(); });
  }


  // ---------------------------------------------------------------------
  // KC-0030: the situation layer. A meeting is active from ten minutes before it starts until it ends.
  // Hjem/Dagen switch to the meeting view by themselves (unless Henrik left it); other rooms get a slim bar; the meeting page leaves for Dagen when it is over.
  var SIT_MS = 30000;
  function forladt(id) { try { return !!window.sessionStorage.getItem('kc-forladt-' + id); } catch (e) { return false; } }
  function markerForladt(id) { try { window.sessionStorage.setItem('kc-forladt-' + id, '1'); } catch (e) { /* storage blocked: the page just may pull back once */ } }
  function moedeIdFra(url) { try { return decodeURIComponent(String(url).split('/').pop()); } catch (e) { return ''; } }

  // The meeting page is the one with a meeting id; Hjem also says data-situation="moede" during a meeting (KC-0114).
  if (body.dataset.moedeId) {
    var moedeSlut = Date.parse(body.dataset.moedeSlut || '');
    var tjekSlut = function () { if (document.visibilityState === 'visible' && !isNaN(moedeSlut) && Date.now() >= moedeSlut) window.location.assign('/rum/dagen'); };
    setInterval(tjekSlut, SIT_MS);
    document.addEventListener('visibilitychange', tjekSlut);
    tjekSlut();
    // "Til Dagen" and the nav leave the meeting for good: Hjem/Dagen must not pull him back.
    document.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-forlad-moede], nav a') : null;
      if (!t) return;
      var id = t.getAttribute('data-forlad-moede') || body.dataset.moedeId;
      if (id) markerForladt(id);
    });
  } else if (roomEl) {
    var sitBar = null;
    var fjernBar = function () { if (sitBar) { sitBar.remove(); sitBar = null; } };
    var visBar = function (m) {
      var min = Math.ceil((Date.parse(m.start) - Date.now()) / 60000);
      var tekst = min > 0 ? 'starter om ' + min + ' min' : 'er i gang';
      if (!sitBar) {
        sitBar = document.createElement('div');
        sitBar.className = 'uv-situation-bar';
        sitBar.setAttribute('role', 'status');
        sitBar.appendChild(document.createElement('span'));
        var a = document.createElement('a');
        a.className = 'btn'; a.textContent = 'Åbn mødevisningen';
        sitBar.appendChild(a);
        roomEl.parentNode.insertBefore(sitBar, roomEl);
      }
      sitBar.firstChild.textContent = 'Mødet "' + m.titel + '" ' + tekst;
      sitBar.lastChild.setAttribute('href', m.url);
    };
    var skiftRum = roomId === 'hjem' || roomId === 'dagen';
    var tjekSituation = function () {
      if (document.visibilityState !== 'visible') return;
      fetch('/api/situation', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        var m = d && d.moede;
        if (m && skiftRum && !forladt(moedeIdFra(m.url))) { window.location.assign(m.url); return; }
        if (m) visBar(m); else fjernBar();
      }).catch(function () { /* the next check retries */ });
    };
    setInterval(tjekSituation, SIT_MS);
    document.addEventListener('visibilitychange', tjekSituation);
    tjekSituation();
  }

  // ---------------------------------------------------------------------
  // KC-0015: the stemme layer. Mic wherever you can type, Lyt on every
  // element that has data-sig, and Samtale (the ElevenLabs agent) whose
  // tools run here in the browser and call the same endpoints as the buttons.
  var stemmeOn = !!body.dataset.stemme;
  var agentOn = body.dataset.stemme === 'samtale'; // the ElevenLabs agent may be tried; otherwise Samtale is the Hermes loop (KC-0022)
  var player = null;          // the one <audio> for Lyt, unlocked by the first tap
  var playingBtn = null;
  var SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
  function unlockAudio() {
    if (!player) {
      player = document.createElement('audio');
      player.setAttribute('playsinline', '');
      player.id = 'stemme-player'; player.hidden = true;
      body.appendChild(player);
      // Only the real clip (a blob URL) clears the playing state; the silent unlock clip ends at once.
      player.addEventListener('ended', function () { if (player.src.indexOf('blob:') === 0) markPlaying(null); });
    }
    if (!player.src || player.paused) { try { player.src = SILENT; var p = player.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* no gesture */ } }
  }
  function markPlaying(btn) {
    if (playingBtn) playingBtn.classList.remove('is-playing');
    playingBtn = btn;
    if (btn) btn.classList.add('is-playing');
  }
  var sigSeq = 0;
  function stopSig() { sigSeq++; if (player) { try { player.pause(); } catch (e) { /* ignore */ } } markPlaying(null); }
  /** Reads text aloud; btn (optional) shows the playing state and toggles off on a second tap; onEnd (optional) runs once when the clip is over or failed. */
  function sig(text, btn, onEnd) {
    var ended = false;
    function end() { if (!ended) { ended = true; if (onEnd) onEnd(); } }
    if (!stemmeOn || !text) { end(); return; }
    if (btn && btn === playingBtn) { stopSig(); return; }
    if (playingBtn) stopSig();
    unlockAudio(); // plays a silent clip inside the tap, so the real clip may play after the fetch (iOS)
    markPlaying(btn);
    var seq = ++sigSeq;
    fetch('/api/stemme/sig', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tekst: String(text).slice(0, 2000) }) })
      .then(function (r) { if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || ('HTTP ' + r.status)); }); return r.blob(); })
      .then(function (blob) {
        if (seq !== sigSeq) { end(); return; } // a newer Lyt or a stop won
        var url = URL.createObjectURL(blob);
        player.src = url;
        player.onended = function () { URL.revokeObjectURL(url); markPlaying(null); end(); };
        var p = player.play();
        if (p && p.catch) p.catch(function (err) { toast('Kunne ikke afspille: ' + fejlTekst(err), true); markPlaying(null); end(); });
      })
      .catch(function (err) { if (seq !== sigSeq) { end(); return; } toast('Oplæsning fejlede: ' + fejlTekst(err), true); markPlaying(null); end(); });
  }

  // Mic: press to record, press again to stop; the text lands where you were typing.
  var rec = null, recChunks = [], recBtn = null, recTimer = null, recStream = null;
  function micMime() {
    if (!window.MediaRecorder) return '';
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < types.length; i++) { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; }
    return '';
  }
  function stopRec() {
    if (recTimer) { clearTimeout(recTimer); recTimer = null; }
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (e) { /* ignore */ } }
  }
  function startRec(btn) {
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Mikrofonen virker ikke i denne browser.', true); return; }
    if (rec && rec.state === 'recording') { stopRec(); return; }
    unlockAudio();
    var mime = micMime();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recStream = stream;
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recChunks = []; recBtn = btn;
      btn.classList.add('is-recording'); btn.setAttribute('aria-pressed', 'true');
      setStatus('lytter …', 'busy');
      rec.addEventListener('dataavailable', function (e) { if (e.data && e.data.size) recChunks.push(e.data); });
      rec.addEventListener('stop', function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        recStream = null;
        btn.classList.remove('is-recording'); btn.setAttribute('aria-pressed', 'false');
        var type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
        var blob = new Blob(recChunks, { type: type });
        rec = null;
        if (blob.size < 1000) { setStatus('Klar', 'ok'); return; }
        sendRec(blob, type, btn);
      });
      rec.start(250);
      recTimer = setTimeout(stopRec, 60000);
    }).catch(function (err) { toast('Ingen adgang til mikrofonen: ' + fejlTekst(err), true); });
  }
  function sendRec(blob, type, btn) {
    setStatus('skriver ned …', 'busy');
    btn.classList.add('is-transcribing');
    var fd = new FormData();
    fd.append('file', blob, type.indexOf('mp4') >= 0 ? 'speech.m4a' : type.indexOf('ogg') >= 0 ? 'speech.ogg' : 'speech.webm');
    fd.append('rum', roomId || '');
    fetch('/api/stemme/lyt', { method: 'POST', body: fd })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) {
        btn.classList.remove('is-transcribing');
        setStatus('Klar', 'ok');
        var text = (j.tekst || '').trim();
        if (!text) { toast('Jeg hørte ikke noget.', false); return; }
        deliver(btn, text);
      })
      .catch(function (err) { btn.classList.remove('is-transcribing'); setStatus('Klar', 'ok'); toast('Kunne ikke forstå optagelsen: ' + fejlTekst(err), true); });
  }
  /** Where the words go: the chat sends them at once; a field gets them at the caret. */
  function deliver(btn, text) {
    if (btn.dataset.mic === 'chat') {
      if (!input || !form) return;
      input.value = text;
      input.dataset.spoken = '1';
      openChat(false);
      if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true }));
      return;
    }
    var field = btn.dataset.mic ? document.getElementById(btn.dataset.mic) : null;
    if (!field) return;
    var v = field.value || '';
    var a = typeof field.selectionStart === 'number' ? field.selectionStart : v.length;
    var b = typeof field.selectionEnd === 'number' ? field.selectionEnd : a;
    var before = v.slice(0, a), after = v.slice(b);
    var sep = before && !/\s$/.test(before) ? ' ' : '';
    field.value = before + sep + text + after;
    var pos = (before + sep + text).length;
    try { field.setSelectionRange(pos, pos); } catch (e) { /* input types without selection */ }
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
  }
  var micSeq = 0;
  /** Adds mic buttons to text fields and Lyt buttons to data-sig elements under root (idempotent). */
  function decorate(root) {
    if (!stemmeOn || !root) return;
    root.querySelectorAll('.field textarea, .field input[type="text"], .kladde textarea').forEach(function (f) {
      if (f.dataset.micDone || f.closest('#indstillinger')) return; // settings hold ids, not prose
      if (f.dataset.udenStemme !== undefined) return; // KC-0146: a word that must be typed (Slet alt's SLET), never spoken
      f.dataset.micDone = '1';
      if (!f.id) f.id = 'felt-' + (++micSeq);
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn mic mic-field'; b.dataset.mic = f.id; b.dataset.klient = '';
      b.setAttribute('aria-label', 'Tal ind i feltet'); b.title = 'Tal (tryk, tal, tryk igen)';
      b.innerHTML = '<span class="mic-icon" aria-hidden="true"></span>';
      f.insertAdjacentElement('afterend', b);
      var lab = f.closest('.field'); if (lab) lab.classList.add('has-mic');
    });
    root.querySelectorAll('[data-sig]').forEach(function (el) {
      if (el.tagName === 'BUTTON') return;
      // KC-0064: a morph keeps unchanged elements, so decorate runs over them again — one Lyt per slot.
      var slot = el.querySelector(':scope .actions') || el;
      if (slot.querySelector(':scope > .lyt')) return;
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-ghost lyt'; b.dataset.lyt = ''; b.dataset.klient = '';
      b.setAttribute('aria-label', 'Læs op'); b.title = 'Læs op'; b.textContent = 'Lyt';
      slot.appendChild(b);
    });
  }
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn || !stemmeOn) return;
    if (btn.dataset.mic !== undefined) { ev.preventDefault(); ev.stopPropagation(); startRec(btn); return; }
    if (btn.dataset.lyt !== undefined) {
      ev.preventDefault(); ev.stopPropagation();
      var host = btn.closest('[data-sig]');
      if (host) sig(host.dataset.sig, btn);
      return;
    }
    if (btn.dataset.sig !== undefined) { ev.preventDefault(); ev.stopPropagation(); sig(btn.dataset.sig, btn); }
  }, true);
  decorate(document);

  // Samtale: the ElevenLabs agent in the browser; its tools call our server.
  var conv = null;
  var samToggle = document.getElementById('samtale-toggle');
  var samPanel = document.getElementById('samtale-panel');
  var samLog = document.getElementById('samtale-log');
  var samStatus = document.getElementById('samtale-status');
  var samDot = document.getElementById('samtale-dot');
  var samStop = document.getElementById('samtale-stop');
  var samLyd = document.getElementById('samtale-lyd');
  var muted = false;
  function samSay(text, state) {
    if (samStatus) samStatus.textContent = text;
    if (samDot) samDot.className = 'dot ' + (state === 'busy' ? 'dot-busy' : state === 'bad' ? 'dot-bad' : 'dot-ok');
  }
  function samLine(who, text) {
    if (!samLog) return;
    if (samLog.firstElementChild && samLog.firstElementChild.classList.contains('muted')) samLog.innerHTML = '';
    var m = document.createElement('div');
    m.className = 'msg msg-' + (who === 'user' ? 'henrik' : 'hermes');
    var t = document.createElement('span'); t.className = 'mono msg-time'; t.textContent = klokke();
    var s = document.createElement('span'); s.className = 'msg-text'; s.textContent = text;
    m.appendChild(t); m.appendChild(s);
    samLog.appendChild(m);
    samLog.scrollTop = samLog.scrollHeight;
  }
  function chatRoom() { return roomId || 'hjem'; } // KC-0019: Hjem has a chat with the overview of every room
  var clientTools = {
    hent_oversigt: function () {
      return fetch('/api/stemme/oversigt').then(function (r) { return r.json(); }).then(function (o) { return o.tekst || 'Intet venter.'; }).catch(function (err) { return 'Kunne ikke hente oversigten: ' + fejlTekst(err); });
    },
    udfoer: function (p) {
      var id = p && p.id ? String(p.id).trim() : '';
      return fetch('/api/stemme/udfoer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
        .then(function (j) {
          samLine('app', 'Sat i gang: ' + j.label);
          follow(j.runId, { startText: j.label + ' …', onDone: function (d) {
            var res = d ? (d.text || 'gjort') : 'fejlede';
            samLine('app', 'Hermes er færdig med "' + j.label + '": ' + res.slice(0, 200));
            if (conv) { try { conv.sendContextualUpdate('Hermes er færdig med "' + j.label + '": ' + res.slice(0, 600)); } catch (e) { /* session ended */ } }
          } });
          return 'Sat i gang: ' + j.label + '. Gå videre; jeg siger til når Hermes er færdig.';
        })
        .catch(function (err) { return 'Kunne ikke: ' + fejlTekst(err); });
    },
    spoerg_hermes: function (p) {
      var besked = p && p.besked ? String(p.besked).trim().slice(0, 2000) : '';
      if (!besked) return 'Spørgsmålet var tomt.';
      addMsg('henrik', besked);
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () { if (!done) { done = true; resolve('Hermes svarede ikke i tide.'); } }, 70000);
        fetch('/api/rum/' + chatRoom() + '/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ besked: besked, enhed: enhed() }) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
          .then(function (j) {
            follow(j.runId, { chat: true, statusInChat: true, startText: 'svarer …', onDone: function (d) {
              if (done) return; done = true; clearTimeout(timer);
              resolve(d && d.text ? d.text.slice(0, 1500) : 'Hermes svarede ikke.');
            } });
          })
          .catch(function (err) { if (!done) { done = true; clearTimeout(timer); resolve('Kunne ikke spørge Hermes: ' + fejlTekst(err)); } });
      });
    }
  };
  function samLive(on) {
    if (!samToggle) return;
    samToggle.classList.toggle('is-live', on);
    samToggle.setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  // KC-0022: Samtale with Hermes itself — Hermes reads what waits, listens until
  // Henrik pauses, answers in this room (Hjem: every room), reads the answer aloud,
  // and listens again until Henrik says stop or taps Stop. Uses only lyt, chat and sig.
  var hs = null;
  function hsStop(reason) {
    if (!hs) return;
    var h = hs; hs = null;
    if (h.timer) clearInterval(h.timer);
    if (h.rec && h.rec.state !== 'inactive') { h.rec.discard = true; try { h.rec.stop(); } catch (e) { /* ignore */ } }
    h.stream.getTracks().forEach(function (t) { t.stop(); });
    if (h.ctx) { try { h.ctx.close(); } catch (e) { /* ignore */ } }
    stopSig();
    samSay(reason || 'slut', 'ok');
    samLive(false);
  }
  function hsSpeak(h, text, next) {
    if (hs !== h) return;
    samSay('taler', 'busy');
    if (muted) { next(); return; }
    sig(text, null, function () { if (hs === h) next(); });
  }
  function hsListen(h) {
    if (hs !== h) return;
    samSay('lytter — tal, og hold en pause når du er færdig', 'ok');
    var mime = micMime();
    var rec = mime ? new MediaRecorder(h.stream, { mimeType: mime }) : new MediaRecorder(h.stream);
    var chunks = [];
    h.rec = rec;
    rec.addEventListener('dataavailable', function (e) { if (e.data && e.data.size) chunks.push(e.data); });
    rec.addEventListener('stop', function () {
      if (rec.discard || hs !== h) return;
      var type = (rec.mimeType || mime || 'audio/webm').split(';')[0];
      hsHeard(h, new Blob(chunks, { type: type }), type);
    });
    rec.start(250);
    var m = window.KCLyt.maaler();
    var buf = new Float32Array(h.analyser.fftSize);
    var started = performance.now();
    h.timer = setInterval(function () {
      h.analyser.getFloatTimeDomainData(buf);
      var sum = 0; for (var i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      var now = performance.now();
      var st = m.feed(Math.sqrt(sum / buf.length), now);
      if (st === 'faerdig' || now - started > 60000) { clearInterval(h.timer); h.timer = null; rec.stop(); }
      else if (st === 'stille') { clearInterval(h.timer); h.timer = null; hsStop('sluttede — jeg hørte ikke noget'); }
    }, 50);
  }
  function hsHeard(h, blob, type) {
    samSay('skriver ned …', 'busy');
    var fd = new FormData();
    fd.append('file', blob, type.indexOf('mp4') >= 0 ? 'speech.m4a' : type.indexOf('ogg') >= 0 ? 'speech.ogg' : 'speech.webm');
    fd.append('rum', roomId || '');
    fetch('/api/stemme/lyt', { method: 'POST', body: fd })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
      .then(function (j) {
        if (hs !== h) return;
        var tekst = (j.tekst || '').trim();
        if (!tekst) { hsListen(h); return; }
        samLine('user', tekst);
        if (window.KCLyt.erStop(tekst)) { hsStop('slut'); return; }
        addMsg('henrik', tekst);
        samSay('Hermes tænker …', 'busy');
        return fetch('/api/rum/' + chatRoom() + '/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ besked: tekst, enhed: enhed() }) })
          .then(function (r) { return r.json().then(function (k) { if (!r.ok) throw new Error(k.error || ('HTTP ' + r.status)); return k; }); })
          .then(function (k) {
            follow(k.runId, { chat: true, statusInChat: true, startText: 'svarer …', onDone: function (d) {
              if (hs !== h) return;
              var svar = d && d.text ? d.text : 'Hermes kunne ikke svare. Prøv igen.';
              samLine('ai', svar);
              hsSpeak(h, svar, function () { hsListen(h); });
            } });
          });
      })
      .catch(function (err) {
        if (hs !== h) return;
        samLine('app', 'Fejl: ' + fejlTekst(err));
        hsListen(h);
      });
  }
  /** ctx: an AudioContext made inside Henrik's tap (iOS only lets it run then). */
  function hermesSamtale(ctx) {
    if (!navigator.mediaDevices || !window.MediaRecorder || !window.KCLyt || !ctx) { toast('Samtale virker ikke i denne browser.', true); samLive(false); samSay('slut', 'ok'); return; }
    if (samPanel) samPanel.hidden = false;
    samLive(true);
    samSay('starter …', 'busy');
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      var h = { stream: stream, ctx: ctx, analyser: analyser, timer: null, rec: null };
      hs = h;
      return fetch('/api/stemme/oversigt').then(function (r) { return r.json(); }).then(function (o) {
        var intro = (o && o.tekst ? o.tekst + '\n' : '') + 'Hvad vil du?';
        samLine('ai', intro);
        hsSpeak(h, intro, function () { hsListen(h); });
      }).catch(function () { hsListen(h); });
    }).catch(function (err) { try { ctx.close(); } catch (e) { /* ignore */ } samLive(false); samSay('fejl', 'bad'); toast('Ingen adgang til mikrofonen: ' + fejlTekst(err), true); });
  }

  function endSamtale() {
    if (conv) { var c = conv; conv = null; try { c.endSession(); } catch (e) { /* ignore */ } }
    hsStop('slut');
    samSay('slut', 'ok');
    samLive(false);
  }
  function startSamtale() {
    if (conv || hs) { endSamtale(); return; }
    stopSig();
    unlockAudio();
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = Ctx ? new Ctx() : null;
    if (ctx && ctx.resume) { try { ctx.resume(); } catch (e) { /* ignore */ } }
    if (!agentOn || !window.ElevenLabsClient || !window.ElevenLabsClient.Conversation) { hermesSamtale(ctx); return; }
    if (samPanel) samPanel.hidden = false;
    samSay('starter …', 'busy');
    samLive(true);
    var mic = navigator.mediaDevices ? navigator.mediaDevices.getUserMedia({ audio: true }) : Promise.reject(new Error('ingen mikrofon'));
    Promise.all([mic, fetch('/api/stemme/samtale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rum: roomId || 'hjem' }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })])
      .then(function (both) {
        both[0].getTracks().forEach(function (t) { t.stop(); }); // the SDK opens its own
        var j = both[1];
        return window.ElevenLabsClient.Conversation.startSession({
          conversationToken: j.token,
          connectionType: 'webrtc',
          dynamicVariables: j.dynamiskeVariabler,
          clientTools: clientTools,
          useWakeLock: true,
          onConnect: function () { samSay('lytter', 'ok'); },
          onDisconnect: function () { conv = null; samSay('slut', 'ok'); if (samToggle) { samToggle.classList.remove('is-live'); samToggle.setAttribute('aria-expanded', 'false'); } },
          onModeChange: function (m) { samSay(m && m.mode === 'speaking' ? 'taler' : 'lytter', m && m.mode === 'speaking' ? 'busy' : 'ok'); },
          onStatusChange: function (s) { if (s && s.status === 'connecting') samSay('forbinder …', 'busy'); },
          onMessage: function (m) { if (m && m.message) samLine(m.source === 'user' ? 'user' : 'ai', m.message); },
          onError: function (msg) { samSay('fejl', 'bad'); toast('Samtale: ' + msg, true); }
        });
      })
      .then(function (c) { conv = c; if (ctx) { try { ctx.close(); } catch (e) { /* ignore */ } } if (muted) { try { c.setVolume({ volume: 0 }); } catch (e) { /* ignore */ } } })
      .catch(function (err) {
        // The agent cannot start (today: the key lacks the convai scopes) — talk to Hermes directly instead.
        conv = null;
        samLine('app', 'Stemme-agenten kunne ikke starte (' + fejlTekst(err) + '). Jeg taler med Hermes direkte.');
        hermesSamtale(ctx);
      });
  }
  if (stemmeOn && samToggle) {
    samToggle.addEventListener('click', function () { if (conv || hs) { endSamtale(); } else { startSamtale(); } });
    if (samStop) samStop.addEventListener('click', function () { endSamtale(); if (samPanel) samPanel.hidden = true; });
    if (samLyd) samLyd.addEventListener('click', function () {
      muted = !muted;
      samLyd.textContent = muted ? 'Lyd til' : 'Lyd fra';
      samLyd.setAttribute('aria-pressed', muted ? 'true' : 'false');
      if (conv) { try { conv.setVolume({ volume: muted ? 0 : 1 }); } catch (e) { /* ignore */ } }
    });
    window.addEventListener('pagehide', function () { if (conv || hs) endSamtale(); });
  }
  // KC-0129: Start's import. The chosen files are read as text here and folded into the form's one hidden field
  // `filer` ([{navn, tekst}]), so the action's JSON body carries them; the server checks type, size and names.
  document.addEventListener('change', function (ev) {
    var inp = ev.target;
    if (!inp || !inp.matches || !inp.matches('input[data-import-filer]')) return;
    var form = inp.form;
    var felt = form && form.elements.filer;
    if (!felt) return;
    var knap = form.querySelector('[data-aktion]');
    var liste = Array.prototype.slice.call(inp.files || []);
    felt.value = '';
    if (!liste.length) return;
    if (knap) knap.disabled = true;
    Promise.all(liste.map(function (f) {
      return new Promise(function (ok) {
        var r = new FileReader();
        r.onload = function () { ok({ navn: f.name, tekst: String(r.result || '') }); };
        r.onerror = function () { ok(null); };
        r.readAsText(f);
      });
    })).then(function (filer) {
      felt.value = JSON.stringify(filer.filter(Boolean));
      if (knap) knap.disabled = false;
    });
  });
  window.addEventListener('beforeunload', function (ev) { if (busy > 0) { ev.preventDefault(); ev.returnValue = ''; } });
})();
