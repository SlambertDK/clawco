// clawco.work/status (KC-0202): reads Clawco Sky's public status feed from the visitor's browser and shows it. This is the
// only script on the site that makes a request, and it makes exactly one kind: a plain GET of the feed, no credentials,
// no cookies, never cached. The invariant is FAIL CLOSED: silence is never green. A feed that cannot be fetched, is not
// a 200, cannot be parsed, has no readable time, or is older than five minutes (or dated more than five minutes ahead,
// which a visitor's wrong clock could cause) is shown as unknown for every part and for the banner. `vurder` is the one
// function that decides a state; the rest of this file only draws what it returns. The HTML as written already says
// unknown, so a visitor without this script (or without JavaScript) never sees a green page either.
(() => {
  'use strict';
  const FEED_URL = 'https://konto.clawco.work/status.json';
  // The fail-closed limit from the ticket: a feed whose own time differs from the visitor's clock by more than this is unknown.
  const STALE_MS = 5 * 60 * 1000;
  const POLL_MS = 60 * 1000;
  // A day with every expected pass ok is fully working; a day with at least this uptime is degraded; below it, down.
  const DAG_NEDE_UNDER = 95;
  const DAGE = 90;
  const MAX_HAENDELSER = 20;
  const IDER = ['login', 'adgang', 'oprettelse', 'sikkerhedskopi', 'mail', 'clawco'];
  const STATER = ['ok', 'nedsat', 'nede'];

  const erObjekt = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  const procent = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100 ? x : null);
  const tidOk = (x) => typeof x === 'string' && !Number.isNaN(Date.parse(x));
  const ukendtKomponent = () => ({ state: 'ukendt', oppetid: null, dage: [], andel: null });
  const ukendt = (opdateret = null) => ({
    state: 'ukendt',
    komponenter: Object.fromEntries(IDER.map((id) => [id, ukendtKomponent()])),
    haendelser: [],
    opdateret,
  });

  function dagTilstand(oppetid) {
    if (oppetid === null) return 'ukendt';
    if (oppetid === 100) return 'ok';
    return oppetid >= DAG_NEDE_UNDER ? 'nedsat' : 'nede';
  }

  /** Exactly 90 days, oldest first: a short series is padded with unknown at the start, a long one cut to the last 90, and
   *  an entry that is not a date with a percentage is unknown, never a made-up value. */
  function dageRaekke(x) {
    const liste = Array.isArray(x) ? x.slice(-DAGE) : [];
    const rest = liste.map((d) => {
      const dag = erObjekt(d) && typeof d.dag === 'string' && /^\d{4}-\d\d-\d\d$/.test(d.dag) ? d.dag : null;
      const oppetid = dag !== null ? procent(d.oppetid) : null;
      return { dag, oppetid, state: dagTilstand(oppetid) };
    });
    const pad = Array.from({ length: DAGE - rest.length }, () => ({ dag: null, oppetid: null, state: 'ukendt' }));
    return pad.concat(rest);
  }

  /** Judges a feed against the visitor's clock. Returns { state, komponenter, haendelser, opdateret }; never throws. */
  function vurder(feed, nuMs) {
    if (!erObjekt(feed) || !tidOk(feed.opdateret)) return ukendt();
    const t = Date.parse(feed.opdateret);
    const opdateret = new Date(t).toISOString();
    if (!Number.isFinite(nuMs) || Math.abs(nuMs - t) > STALE_MS) return ukendt(opdateret);
    if (!STATER.includes(feed.samlet) || !Array.isArray(feed.komponenter) || !Array.isArray(feed.haendelser)) return ukendt(opdateret);
    const haendelser = [];
    for (const h of feed.haendelser) {
      if (!erObjekt(h) || typeof h.titel !== 'string' || typeof h.tekst !== 'string' || !tidOk(h.start) || !(h.slut === null || tidOk(h.slut))) return ukendt(opdateret);
      haendelser.push({ titel: h.titel, tekst: h.tekst, start: h.start, slut: h.slut });
    }
    const komponenter = {};
    for (const id of IDER) {
      const k = feed.komponenter.find((x) => erObjekt(x) && x.id === id);
      komponenter[id] = k && STATER.includes(k.status)
        ? { state: k.status, oppetid: procent(k.oppetid90d), dage: dageRaekke(k.dage), andel: id === 'clawco' ? procent(k.andelSund) : null }
        : ukendtKomponent();
    }
    // The banner is the feed's overall state, but never greener than the parts: a part we know nothing about, or one that is
    // not ok under an "ok" total, keeps it from saying everything works.
    let state = feed.samlet;
    const dele = Object.values(komponenter);
    if (state === 'ok' && dele.some((k) => k.state !== 'ok')) state = dele.some((k) => k.state === 'ukendt') ? 'ukendt' : 'nedsat';
    return { state, komponenter, haendelser: haendelser.slice(0, MAX_HAENDELSER), opdateret };
  }

  globalThis.CLAWCO_STATUS = { vurder };

  // ---- drawing (a browser only; the pure part above is tested on its own) ----
  if (typeof document === 'undefined') return;
  const T = globalThis.CLAWCO_TEXT;
  const sprog = () => (document.documentElement.getAttribute('lang') === 'da' ? 'da' : 'en');
  const tekst = (key, vars) => {
    let s = T[sprog()][key];
    for (const [k, v] of Object.entries(vars || {})) s = s.replace('{' + k + '}', v);
    return s;
  };
  const tal = (n) => String(n).replace('.', sprog() === 'da' ? ',' : '.');
  const tid = (iso) => new Date(iso).toLocaleString(sprog() === 'da' ? 'da-DK' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const q = (sel, rod = document) => rod.querySelector(sel);
  const skjul = (el, ja) => { if (ja) el.setAttribute('hidden', ''); else el.removeAttribute('hidden'); };
  // The text keeps its key, so the language toggle (site.js) translates it again without this script.
  const saet = (el, key) => { el.setAttribute('data-i', key); el.textContent = tekst(key); };
  const toem = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };
  const lav = (navn, tekstIndhold, attrs) => {
    const el = document.createElement(navn);
    if (tekstIndhold !== undefined) el.textContent = tekstIndhold;
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    return el;
  };

  function tegnKomponent(id, k) {
    const li = q('li[data-k="' + id + '"]');
    if (!li) return;
    li.setAttribute('data-state', k.state);
    const status = q('.st-status', li);
    status.setAttribute('data-state', k.state);
    saet(status, 'js.st.s.' + k.state);
    q('.st-oppetid', li).textContent = k.state === 'ukendt' ? '' : k.oppetid === null ? tekst('js.st.oppetid.ingen') : tekst('js.st.oppetid', { p: tal(k.oppetid) });
    const stribe = q('.st-dage', li);
    toem(stribe);
    const antal = { ok: 0, nedsat: 0, nede: 0, ukendt: 0 };
    if (k.state !== 'ukendt') {
      for (const d of k.dage) {
        antal[d.state]++;
        const hvad = d.oppetid === null ? tekst('js.st.nodata') : tal(d.oppetid) + ' %';
        stribe.appendChild(lav('li', undefined, { 'data-state': d.state, title: d.dag ? d.dag + ': ' + hvad : hvad }));
      }
    }
    const dele = ['ok', 'nedsat', 'nede', 'ukendt'].filter((s) => antal[s] > 0).map((s) => tekst('js.st.d.' + s, { n: String(antal[s]) }));
    q('.st-sum', li).textContent = k.state === 'ukendt' ? '' : tekst('js.st.sum.pre') + ' ' + dele.join(', ');
    const andel = q('.st-andel', li);
    if (andel) {
      andel.textContent = k.andel === null ? '' : tekst('js.st.andel', { p: tal(k.andel) });
      skjul(andel, k.andel === null);
    }
  }

  function tegnHaendelser(v) {
    const liste = q('.st-haendelser');
    const ingen = q('.st-ingen');
    toem(liste);
    // Before a feed has been judged we do not know, and the text says so; only a loaded feed may say "none".
    const indlaest = Object.values(v.komponenter).some((k) => k.state !== 'ukendt');
    saet(ingen, indlaest ? 'js.st.h.ingen' : 'st.h.none');
    skjul(ingen, v.haendelser.length > 0);
    for (const h of v.haendelser) {
      const naar = tekst('js.st.h.startede', { t: tid(h.start) }) + ' · ' + (h.slut ? tekst('js.st.h.sluttede', { t: tid(h.slut) }) : tekst('js.st.h.igang'));
      const li = lav('li');
      li.appendChild(lav('h3', h.titel));
      li.appendChild(lav('p', naar, { class: 'muted' }));
      li.appendChild(lav('p', h.tekst));
      liste.appendChild(li);
    }
  }

  function tegn(v) {
    const banner = q('.st-banner');
    banner.setAttribute('data-state', v.state);
    saet(banner, 'js.st.b.' + v.state);
    for (const id of IDER) tegnKomponent(id, v.komponenter[id]);
    tegnHaendelser(v);
    const sidst = q('.st-sidst');
    if (v.opdateret) {
      const t = q('.st-tid', sidst);
      t.textContent = tid(v.opdateret);
      t.setAttribute('datetime', v.opdateret);
    }
    skjul(sidst, !v.opdateret);
  }

  let sidste = null;
  let loeb = 0;
  const vis = () => tegn(vurder(sidste, Date.now()));

  async function hent() {
    const mit = ++loeb;
    let feed = null;
    try {
      if (typeof fetch === 'function') {
        const svar = await fetch(FEED_URL, { cache: 'no-store', credentials: 'omit', mode: 'cors' });
        if (svar.status === 200) feed = await svar.json();
      }
    } catch { feed = null; }
    if (mit !== loeb) return;
    sidste = feed;
    vis();
  }

  // Every minute: a visible tab asks again; a hidden one asks nothing but still judges what it has against the clock, so
  // a page left open turns unknown when Sky stops updating.
  const tik = () => { if (document.visibilityState === 'hidden') vis(); else hent(); };

  function start() {
    for (const b of document.querySelectorAll('[data-lang-toggle]')) b.addEventListener('click', vis);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') hent(); });
    setInterval(tik, POLL_MS);
    hent();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
