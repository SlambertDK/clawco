// KC-0064 phase 3: the keyed morph. A live change replaces only the elements the
// server changed; everything the client added (decorations, classes, open details,
// typed text, focus) stays. Children match by data-id, then by a band/group/fold
// attribute, then by tag and position. Never touches the global document, so it
// runs in node tests on a linkedom DOM.
(function (root) {
  'use strict';
  var attrs = new WeakMap();  // element -> the attributes the server rendered
  var kilde = new WeakMap();  // [data-id] element -> the server's outerHTML
  var tekst = new WeakMap();  // text/comment node -> the server's text
  var NOEGLER = ['data-baand', 'data-gruppe', 'data-fold-id', 'data-fold-navn'];
  var FELTER = 'input, textarea, select';

  function serverAttrs(el) {
    var o = Object.create(null);
    for (var i = 0; i < el.attributes.length; i++) o[el.attributes[i].name] = el.attributes[i].value;
    return o;
  }
  function merkTrae(n) {
    if (n.nodeType === 3 || n.nodeType === 8) { tekst.set(n, n.data); return; }
    if (n.nodeType !== 1) return;
    attrs.set(n, serverAttrs(n));
    if (n.hasAttribute('data-id')) kilde.set(n, n.outerHTML);
    for (var c = n.firstChild; c; c = c.nextSibling) merkTrae(c);
  }
  // Called once on load, before the client decorates anything.
  function merk(rootEl) { for (var c = rootEl.firstChild; c; c = c.nextSibling) merkTrae(c); }

  function erKlient(n) { return n.nodeType === 1 && n.hasAttribute('data-klient'); }
  function noegle(c) {
    if (c.nodeType !== 1) return '#' + c.nodeType;
    var id = c.getAttribute('data-id');
    if (id !== null) return 'id ' + id;
    for (var i = 0; i < NOEGLER.length; i++) {
      var v = c.getAttribute(NOEGLER[i]);
      if (v !== null) return c.tagName + ' ' + NOEGLER[i] + '=' + v;
    }
    return c.tagName;
  }
  // The server children of a node with their keys; a repeated key gets its occurrence number.
  function boern(parent) {
    var tael = Object.create(null), ud = [];
    for (var c = parent.firstChild; c; c = c.nextSibling) {
      if (erKlient(c)) continue;
      var k = noegle(c);
      tael[k] = (tael[k] || 0) + 1;
      ud.push({ k: k + '#' + tael[k], n: c });
    }
    return ud;
  }

  function klasser(el, foer, nu) {
    var f = foer.split(/\s+/).filter(Boolean), n = nu.split(/\s+/).filter(Boolean);
    f.forEach(function (t) { if (n.indexOf(t) < 0) el.classList.remove(t); });
    n.forEach(function (t) { if (f.indexOf(t) < 0) el.classList.add(t); });
  }
  // Only what the server changed: set new/changed attributes, remove ones it dropped.
  function opdaterAttrs(o, n) {
    var foer = attrs.get(o) || Object.create(null), nu = serverAttrs(n), k;
    for (k in nu) {
      if (k === 'class') klasser(o, foer[k] || '', nu[k]);
      else if (foer[k] !== nu[k]) o.setAttribute(k, nu[k]);
    }
    for (k in foer) {
      if (k in nu) continue;
      if (k === 'class') klasser(o, foer[k], ''); else o.removeAttribute(k);
    }
    attrs.set(o, nu);
  }

  function liste(el, sel) {
    var a = Array.prototype.slice.call(el.querySelectorAll(sel));
    if (el.matches && el.matches(sel)) a.unshift(el);
    return a;
  }
  // A changed [data-id] element: the new one takes its place, keeping open details and the typed field.
  function erstat(o, n, ctx) {
    merkTrae(n);
    var od = liste(o, 'details'), nd = liste(n, 'details');
    for (var i = 0; i < od.length && i < nd.length; i++) {
      if (od[i].hasAttribute('open')) nd[i].setAttribute('open', ''); else nd[i].removeAttribute('open');
    }
    if (ctx.akt && o.contains(ctx.akt)) {
      var of = liste(o, FELTER), nf = liste(n, FELTER), navn = ctx.akt.getAttribute('name'), maal = null;
      if (navn) nf.forEach(function (f) { if (!maal && f.getAttribute('name') === navn) maal = f; });
      if (!maal) maal = nf[of.indexOf(ctx.akt)] || null;
      if (maal) { if ('value' in ctx.akt) maal.value = ctx.akt.value; ctx.fokus = maal; }
    }
    o.parentNode.replaceChild(n, o);
    ctx.endrede.push(n);
    return n;
  }
  // The outermost [data-id] elements of a newly inserted subtree.
  function nyeIder(n, ud) {
    if (n.nodeType !== 1) return;
    if (n.hasAttribute('data-id')) { ud.push(n); return; }
    for (var c = n.firstElementChild; c; c = c.nextElementSibling) nyeIder(c, ud);
  }
  // Put node right after forrige (past any client nodes that follow it); no-op when already there.
  function plaser(parent, node, forrige) {
    var ref = forrige ? forrige.nextSibling : parent.firstChild;
    while (ref && erKlient(ref)) ref = ref.nextSibling;
    if (ref !== node) parent.insertBefore(node, ref);
  }

  function morphBoern(gammel, ny, ctx) {
    var gamle = Object.create(null);
    boern(gammel).forEach(function (p) { gamle[p.k] = p.n; });
    var forrige = null;
    boern(ny).forEach(function (p) {
      var n = p.n, o = gamle[p.k], res;
      var samme = o && o.nodeType === n.nodeType && (n.nodeType !== 1 || o.tagName === n.tagName);
      if (samme) {
        delete gamle[p.k];
        if (n.nodeType !== 1) {
          if (tekst.get(o) !== n.data && o.data !== n.data) o.data = n.data;
          tekst.set(o, n.data);
          res = o;
        } else if (n.hasAttribute('data-id')) {
          res = kilde.get(o) === n.outerHTML ? o : erstat(o, n, ctx);
        } else {
          opdaterAttrs(o, n);
          morphBoern(o, n, ctx);
          res = o;
        }
      } else {
        merkTrae(n);
        nyeIder(n, ctx.nye);
        res = n;
      }
      plaser(gammel, res, forrige);
      forrige = res;
    });
    for (var k in gamle) if (gamle[k].parentNode === gammel) gammel.removeChild(gamle[k]);
  }

  function morph(rootEl, html) {
    var doc = rootEl.ownerDocument;
    var ny = doc.createElement('div');
    ny.innerHTML = html;
    var akt = doc.activeElement && rootEl.contains(doc.activeElement) ? doc.activeElement : null;
    var valg = akt && typeof akt.selectionStart === 'number' ? [akt.selectionStart, akt.selectionEnd] : null;
    var ctx = { nye: [], endrede: [], akt: akt, fokus: null };
    morphBoern(rootEl, ny, ctx);
    // A moved or replaced field loses focus in a browser: give it back, caret included.
    var maal = ctx.fokus || (akt && rootEl.contains(akt) ? akt : null);
    if (maal && doc.activeElement !== maal && typeof maal.focus === 'function') {
      maal.focus({ preventScroll: true });
      if (valg && typeof maal.setSelectionRange === 'function') {
        try { maal.setSelectionRange(valg[0], valg[1]); } catch (e) { /* not a text field */ }
      }
    }
    return { nye: ctx.nye, endrede: ctx.endrede };
  }

  // The ids this browser has seen (localStorage key `noegle`, one per room; oldest dropped beyond cap).
  // No seen-set yet = a baseline: everything on screen is recorded without dots, so the first visit to
  // a room is calm. Without storage it stays a baseline, so nothing is ever marked new.
  function SeteIds(storage, cap, noegle) {
    cap = cap || 1000;
    noegle = noegle || 'kc-sete';
    var ids = [], har = Object.create(null), s = { baseline: true };
    try {
      var raa = storage ? storage.getItem(noegle) : null;
      var liste = raa ? JSON.parse(raa) : null;
      if (Array.isArray(liste)) { ids = liste.map(String); s.baseline = false; }
    } catch (e) { /* blocked or garbled: a baseline */ }
    ids.forEach(function (id) { har[id] = true; });
    s.har = function (id) { return har[id] === true; };
    s.tilfoej = function (nye) {
      nye.forEach(function (id) { if (!har[id]) { har[id] = true; ids.push(id); } });
      while (ids.length > cap) delete har[ids.shift()];
      try {
        if (!storage) return;
        storage.setItem(noegle, JSON.stringify(ids));
        s.baseline = false;
      } catch (e) { /* no storage: stays a baseline */ }
    };
    return s;
  }

  root.kcMorph = { merk: merk, morph: morph, SeteIds: SeteIds };
})(typeof window !== 'undefined' ? window : globalThis);
