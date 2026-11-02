// clawco.work (KC-0164): the language toggle and the copy button, and on the pricing page (KC-0199) the currency and
// billing-interval toggles. Nothing else. No cookies, no requests, no analytics. What is stored is the language,
// currency and interval choice, in localStorage, and every access is wrapped because browsers may block it.
(() => {
  'use strict';
  // Which hero headline a visitor sees first (marketing strategy section 1): 1 or 2.
  // A preview can compare both with ?tagline=2 without a redeploy.
  const TAGLINE_DEFAULT = 1;
  const KEY = 'clawco-lang';
  const T = globalThis.CLAWCO_TEXT;
  const params = new URLSearchParams(location.search);
  const store = {
    get(k = KEY) { try { return localStorage.getItem(k); } catch { return null; } },
    set(v, k = KEY) { try { localStorage.setItem(k, v); } catch { /* blocked: the choice lasts for this page view */ } },
  };
  const valid = (l) => (l === 'en' || l === 'da' ? l : null);
  let lang = valid(params.get('lang')) || valid(store.get()) || 'en';
  const tagline = params.get('tagline') === '2' ? 2 : TAGLINE_DEFAULT;

  const text = (key) => {
    const k = tagline === 2 && (key + '.2') in T.en ? key + '.2' : key;
    return T[lang][k];
  };

  // Pricing page: the amounts are written into the page at build time from config/priser.json (data-minor holds the
  // exact amount in øre/cent); the script only chooses which currency and interval are shown and formats the amount
  // for the language (the same rule as formatBeloeb in scripts/priser-side.ts, held equal by test/site-priser.test.ts).
  const CURS = ['eur', 'dkk'];
  const INTS = ['maaned', 'aar'];
  const money = (minor, valuta, l) => {
    let n = String(Math.trunc(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, l === 'da' ? '.' : ',');
    if (minor % 100) n += (l === 'da' ? ',' : '.') + String(minor % 100).padStart(2, '0');
    return valuta === 'eur' ? '\u20AC' + n : n + ' kr';
  };
  const browserLang = () => String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase();
  const chosen = (name, key, list) => {
    const fromAddress = params.get(name);
    if (list.includes(fromAddress)) return fromAddress;
    const kept = store.get(key);
    return list.includes(kept) ? kept : null;
  };
  let cur = chosen('cur', 'clawco-cur', CURS) || (/^da\b|-dk$/.test(browserLang()) ? 'dkk' : 'eur');
  let interval = chosen('interval', 'clawco-int', INTS) || 'maaned';
  function showPrices() {
    for (const el of document.querySelectorAll('[data-cur]')) {
      if (el.getAttribute('data-cur') === cur) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
    }
    for (const el of document.querySelectorAll('[data-int]')) {
      if (el.getAttribute('data-int') === interval) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
    }
    for (const b of document.querySelectorAll('[data-set-cur]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-set-cur') === cur));
    for (const b of document.querySelectorAll('[data-set-int]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-set-int') === interval));
  }

  function apply() {
    document.documentElement.setAttribute('lang', lang);
    for (const el of document.querySelectorAll('[data-i]')) el.textContent = text(el.getAttribute('data-i'));
    for (const el of document.querySelectorAll('.amt[data-minor]')) el.textContent = money(Number(el.getAttribute('data-minor')), el.getAttribute('data-valuta'), lang);
    for (const el of document.querySelectorAll('[data-i-attr]')) {
      for (const pair of el.getAttribute('data-i-attr').split(';')) {
        const [attr, key] = pair.split(':');
        el.setAttribute(attr, text(key));
      }
    }
    // Internal links keep the language when it was chosen by the link or the toggle (no cookie to carry it).
    for (const a of document.querySelectorAll('a[href^="/"]')) {
      if (!a.hasAttribute('data-href')) a.setAttribute('data-href', a.getAttribute('href'));
      const base = a.getAttribute('data-href');
      if (base.endsWith('.sh') || lang === 'en') { a.setAttribute('href', base); continue; }
      // A page that exists in Danish under its own address (the legal index) names it; no query needed.
      if (a.hasAttribute('data-href-da')) { a.setAttribute('href', a.getAttribute('data-href-da')); continue; }
      const [path, hash] = base.split('#');
      a.setAttribute('href', path + (path.includes('?') ? '&' : '?') + 'lang=da' + (hash ? '#' + hash : ''));
    }
  }

  function addressBar() {
    const p = new URLSearchParams(location.search);
    if (lang === 'da') p.set('lang', 'da'); else p.delete('lang');
    const q = p.toString();
    try { history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + (location.hash || '')); } catch { /* not essential */ }
  }

  for (const b of document.querySelectorAll('[data-lang-toggle]')) {
    b.addEventListener('click', () => {
      lang = lang === 'da' ? 'en' : 'da';
      store.set(lang);
      apply();
      addressBar();
    });
  }

  // Without this script the page shows every currency and interval; with it, the toggles appear and one pair is shown.
  const toggles = document.querySelector('[data-toggles]');
  if (toggles) {
    toggles.removeAttribute('hidden');
    for (const b of document.querySelectorAll('[data-set-cur]')) {
      b.addEventListener('click', () => { cur = b.getAttribute('data-set-cur'); store.set(cur, 'clawco-cur'); showPrices(); });
    }
    for (const b of document.querySelectorAll('[data-set-int]')) {
      b.addEventListener('click', () => { interval = b.getAttribute('data-set-int'); store.set(interval, 'clawco-int'); showPrices(); });
    }
    showPrices();
  }

  function copyWithSelection(value) {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.className = 'copy-sink';
    document.body.appendChild(ta);
    if (ta.select) ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  for (const b of document.querySelectorAll('[data-copy]')) {
    b.addEventListener('click', () => {
      const source = document.querySelector('[data-cmd="' + b.getAttribute('data-copy') + '"]');
      const value = source.textContent.trim().replace(/\s+/g, ' ');
      let timer;
      const say = (ok) => {
        b.textContent = T[lang][ok ? 'js.copied' : 'js.copyfail'];
        clearTimeout(timer);
        timer = setTimeout(() => { b.textContent = text(b.getAttribute('data-i')); }, 2000);
        if (timer && timer.unref) timer.unref();
      };
      const fallback = () => say(copyWithSelection(value));
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(() => say(true), fallback);
      else fallback();
    });
  }

  apply();
})();
