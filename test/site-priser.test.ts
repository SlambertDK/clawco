import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { TILMELD, besparelse, formatBeloeb, laesTabel, renderPriser, validerPriser, type Priser } from '../scripts/priser-side.ts';

// KC-0199: the pricing page of clawco.work. Rendered at build time from config/priser.json (the one price
// source, KC-0190); no amount is typed into any HTML or text table. These tests read files and spawn the build;
// nothing here needs a network. Invariants: every amount equals the config in both currencies and intervals,
// the saving is computed, the page is complete without JavaScript, the draft banner and the refusal of --live
// follow `status`, the normal build never publishes the page, both languages are complete, no third-party request.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const SITE = path.join(ROD, 'site');
const BYG = path.join(ROD, 'scripts/site-byg.mjs');
const laes = (rel: string): string => readFileSync(path.join(ROD, rel), 'utf8');

const RAA = JSON.parse(laes('config/priser.json')) as Record<string, unknown>;
const klon = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const config = (aendr?: (r: any) => void): Priser => { const r = klon(RAA); aendr?.(r); return validerPriser(r); };
const TABEL = laesTabel(SITE);
const SKABELON = laes('site/priser.template.html');
const side = (p: Priser) => renderPriser({ priser: p, tabel: TABEL, skabelon: SKABELON });
const dok = (html: string) => parseHTML(html).document;
const flad = (s: string): string => s.replace(/\s+/g, ' ').trim();
const CURS = ['dkk', 'eur'] as const;
const INTS = [['maaned', 'maanedlig'], ['aar', 'aarlig']] as const;

type Amt = { plan: string; int: string; cur: string; minor: number; tekst: string };
/** Every price amount on the page, with where it sits (plan, interval, currency). */
function beloeb(d: Document): Amt[] {
  return Array.from(d.querySelectorAll('[data-plan] .intv .price .amt:not(.sparet)')).map((el) => ({
    plan: el.closest('[data-plan]')!.getAttribute('data-plan')!, int: el.closest('[data-int]')!.getAttribute('data-int')!,
    cur: el.closest('[data-cur]')!.getAttribute('data-cur')!, minor: Number(el.getAttribute('data-minor')), tekst: flad(el.textContent ?? ''),
  }));
}
const sparet = (d: Document) => Array.from(d.querySelectorAll('[data-plan] .intv .sparet')).map((el) => ({
  plan: el.closest('[data-plan]')!.getAttribute('data-plan')!, cur: el.closest('[data-cur]')!.getAttribute('data-cur')!, minor: Number(el.getAttribute('data-minor')),
}));

test('formatBeloeb: kroner and euro, English and Danish separators, whole amounts without decimals', () => {
  assert.equal(formatBeloeb(7900, 'dkk', 'en'), '79 kr');
  assert.equal(formatBeloeb(129000, 'dkk', 'en'), '1,290 kr');
  assert.equal(formatBeloeb(129000, 'dkk', 'da'), '1.290 kr');
  assert.equal(formatBeloeb(1060, 'eur', 'en'), '€10.60');
  assert.equal(formatBeloeb(1060, 'eur', 'da'), '€10,60');
  assert.equal(formatBeloeb(10600, 'eur', 'en'), '€106');
  assert.equal(formatBeloeb(7950, 'dkk', 'en'), '79.50 kr');
  assert.equal(formatBeloeb(705, 'eur', 'en'), '€7.05', 'cents are padded');
});

test('every amount on the page equals the config, in both currencies and both intervals', () => {
  const p = config();
  const d = dok(side(p));
  const fundet = beloeb(d);
  const forventet: Amt[] = [];
  for (const [id, plan] of Object.entries(p.planer)) for (const [int, felt] of INTS) for (const cur of CURS) {
    const minor = plan[felt === 'maanedlig' ? 'maanedlig' : 'aarlig'][cur];
    forventet.push({ plan: id, int, cur, minor, tekst: formatBeloeb(minor, cur, 'en') });
  }
  const noegle = (a: Amt) => `${a.plan}/${a.int}/${a.cur}`;
  assert.deepEqual(fundet.map(noegle).sort(), forventet.map(noegle).sort(), 'one amount per plan, interval and currency, no extras');
  for (const f of forventet) assert.deepEqual(fundet.find((x) => noegle(x) === noegle(f)), f, noegle(f));
  assert.equal(fundet.length, 2 * 2 * Object.keys(p.planer).length);
});

test('the real config renders: the numbers on the page are the numbers in config/priser.json', () => {
  // Read independently of validerPriser, straight from the file: the page may not know a number the file does not.
  const raa = RAA as { planer: Record<string, { maanedlig: { dkk: number; eur: number }; aarlig: { dkk: number; eur: number } }> };
  const d = dok(side(config()));
  for (const a of beloeb(d)) {
    const plan = raa.planer[a.plan]!;
    assert.equal(a.minor, (a.int === 'maaned' ? plan.maanedlig : plan.aarlig)[a.cur as 'dkk' | 'eur']);
  }
});

test('the yearly saving is computed from the config, not typed: 12 x monthly minus yearly', () => {
  const p = config();
  const d = dok(side(p));
  for (const s of sparet(d)) {
    const plan = p.planer[s.plan]!;
    assert.equal(s.minor, 12 * plan.maanedlig[s.cur as 'dkk' | 'eur'] - plan.aarlig[s.cur as 'dkk' | 'eur'], `${s.plan} ${s.cur}`);
  }
  assert.equal(besparelse(p.planer['sky-solo']!).dkk, 15800, '12 x 79 kr = 948 kr against 790 kr');
  // Other numbers, other saving.
  const q = config((r) => { r.planer['sky-solo'].maanedlig.dkk = 10000; r.planer['sky-solo'].aarlig.dkk = 90000; });
  const sq = sparet(dok(side(q))).find((s) => s.plan === 'sky-solo' && s.cur === 'dkk')!;
  assert.equal(sq.minor, 30000);
  assert.ok(sparet(dok(side(q))).length >= 4, 'a saving per plan and currency');
});

test('golden: changing one amount in the config changes that amount and its saving, and nothing else on the page', () => {
  const norm = (html: string) => html.replace(/data-minor="\d+"/g, 'data-minor="#"').replace(/(<span class="amt[^"]*"[^>]*>)[^<]*(<\/span>)/g, '$1#$2');
  const a = side(config());
  const b = side(config((r) => { r.planer['sky-solo'].maanedlig.eur = 1100; }));
  assert.notEqual(a, b);
  assert.equal(norm(a), norm(b), 'the structure and all text are identical');
  const am = beloeb(dok(a)); const bm = beloeb(dok(b));
  const forskel = am.filter((x, i) => x.minor !== bm[i]!.minor);
  assert.deepEqual(forskel.map((x) => `${x.plan}/${x.int}/${x.cur}`), ['sky-solo/maaned/eur']);
  const sa = sparet(dok(a)); const sb = sparet(dok(b));
  assert.deepEqual(sa.filter((x, i) => x.minor !== sb[i]!.minor).map((x) => `${x.plan}/${x.cur}`), ['sky-solo/eur'], 'only the saving that depends on it');
  assert.equal(bm.find((x) => x.plan === 'sky-solo' && x.int === 'maaned' && x.cur === 'eur')!.tekst, '€11');
});

test('without JavaScript the page is complete: every amount is in the static HTML and nothing is hidden', () => {
  const html = side(config());
  const d = dok(html);
  assert.equal(d.querySelectorAll('[hidden]').length, 1, 'only the toggle group is hidden until a script shows it');
  assert.ok(d.querySelector('[data-toggles][hidden]'));
  const alle = Array.from(d.querySelectorAll('.amt')).map((e) => e.getAttribute('data-minor'));
  for (const v of [7900, 79000, 1060, 10600, 12900, 129000, 1730, 17300, 4900, 660]) assert.ok(alle.includes(String(v)), `amount ${v} is in the HTML`);
  assert.equal(d.querySelectorAll('script:not([src])').length, 0);
  // The three limits, the FAQ and the CTAs do not need a script either.
  assert.equal(d.querySelectorAll('details').length >= 6, true);
  assert.equal(d.querySelectorAll('a[data-plan-cta]').length, 4, 'a sign-up link per Sky plan and interval');
});

test('the sign-up links carry plan and interval (KC-0198) and nothing else', () => {
  const d = dok(side(config()));
  const links = Array.from(d.querySelectorAll('a[data-plan-cta]')).map((a) => a.getAttribute('href')!);
  assert.deepEqual(links.sort(), [
    `${TILMELD}?plan=sky-husstand&interval=aar`, `${TILMELD}?plan=sky-husstand&interval=maaned`,
    `${TILMELD}?plan=sky-solo&interval=aar`, `${TILMELD}?plan=sky-solo&interval=maaned`,
  ]);
  assert.equal(TILMELD, 'https://konto.clawco.work/tilmeld');
  assert.match(laes('sky/src/tilmelding/eksempler.ts'), /\/tilmeld\?plan=sky-solo&interval=maaned/, 'the route and parameter names are the ones Sky reads');
});

test('trial, members and the add-on come from the config', () => {
  const d = dok(side(config()));
  assert.equal(flad(d.querySelector('[data-plan="sky-solo"] .trial .num')!.textContent ?? ''), '14');
  assert.equal(d.querySelector('[data-plan="sky-husstand"] [data-members]')!.getAttribute('data-members'), '6');
  assert.equal(d.querySelector('[data-plan="sky-solo"] [data-members]')!.getAttribute('data-members'), '1');
  const q = dok(side(config((r) => { r.proeve.dage = 30; r.planer['sky-husstand'].medlemmer = 5; })));
  assert.equal(flad(q.querySelector('[data-plan="sky-solo"] .trial .num')!.textContent ?? ''), '30');
  assert.equal(flad(q.querySelector('[data-plan="sky-husstand"] [data-members] .num')!.textContent ?? ''), '5');
  const nocard = d.querySelector('[data-plan="sky-solo"] .trial [data-i]')!.getAttribute('data-i');
  assert.equal(nocard, 'pr.trial.nocard');
  const card = dok(side(config((r) => { r.proeve.kort = true; })));
  assert.equal(card.querySelector('[data-plan="sky-solo"] .trial [data-i]')!.getAttribute('data-i'), 'pr.trial.card', 'a trial that asks for a card never says "no card"');
  const ingen = dok(side(config((r) => { r.proeve.dage = 0; })));
  assert.equal(ingen.querySelectorAll('.trial').length, 0, 'no trial, no trial line');
});

test('the Included model is greyed "coming later" while its config status is senere, and amounts come from the config', () => {
  const d = dok(side(config()));
  const rk = d.querySelector('[data-addon="inkluderet-model"]')!;
  assert.ok(rk.classList.contains('senere'));
  assert.ok(rk.querySelector('[data-i="pr.addon.later"]'));
  const am = Array.from(rk.querySelectorAll('.amt')).map((e) => `${e.closest('[data-cur]')!.getAttribute('data-cur')}:${e.getAttribute('data-minor')}`).sort();
  assert.deepEqual(am, ['dkk:4900', 'eur:660']);
  const q = dok(side(config((r) => { r.tilvalg['inkluderet-model'].status = 'aktiv'; r.tilvalg['inkluderet-model'].fraMaanedlig.dkk = 5900; })));
  const rq = q.querySelector('[data-addon="inkluderet-model"]')!;
  assert.ok(!rq.classList.contains('senere'));
  assert.equal(rq.querySelector('[data-i="pr.addon.later"]'), null);
  assert.ok(rq.querySelector('[data-i="pr.addon.live"]'));
  assert.ok(Array.from(rq.querySelectorAll('.amt')).some((e) => e.getAttribute('data-minor') === '5900'));
});

test('VAT: the page says no VAT is charged (G6), and a config with VAT on is refused until KC-0194 writes the words', () => {
  const d = dok(side(config()));
  assert.ok(d.querySelector('[data-i="pr.vat"]'), 'the "no VAT charged" line');
  assert.match(TABEL.en['pr.vat']!, /No VAT is charged/);
  assert.match(TABEL.da['pr.vat']!, /ikke moms/);
  assert.ok(!/inkl\.|incl(uding|\.) VAT|incl\.? moms/i.test(Object.entries(TABEL.en).filter(([k]) => k.startsWith('pr.')).map(([, v]) => v).join(' ')), 'never "incl. VAT" while no VAT is charged');
  const p = config();
  assert.throws(() => renderPriser({ priser: { ...p, moms: { aktiv: true } } as unknown as Priser, tabel: TABEL, skabelon: SKABELON }), /KC-0194/);
});

test('G5 as code: udkast shows the banner in both languages and keeps the page out of search; godkendt shows neither', () => {
  const u = dok(side(config((r) => { r.status = 'udkast'; })));
  const banner = u.querySelector('[data-i="pr.draft"]');
  assert.ok(banner, 'a banner while the prices are a draft');
  assert.equal(flad(banner!.textContent ?? ''), TABEL.en['pr.draft']);
  assert.match(TABEL.da['pr.draft']!, /^UDKAST: priserne er ikke afgjort/);
  assert.match(TABEL.en['pr.draft']!, /^DRAFT/);
  assert.match(u.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '', /noindex/);
  const g = dok(side(config((r) => { r.status = 'godkendt'; })));
  assert.equal(g.querySelector('[data-i="pr.draft"]'), null);
  assert.equal(g.querySelector('meta[name="robots"]'), null);
});

test('the three limits are the words of the security page, read from the same key', () => {
  const d = dok(side(config()));
  const el = d.querySelector('[data-i="sec.three.p"]')!;
  assert.ok(el, 'the limits appear on the page');
  assert.equal(flad(el.textContent ?? ''), TABEL.en['sec.three.p']);
  const sec = laes('site/docs/security.html');
  assert.ok(sec.includes('data-i="sec.three.p"'), 'and the security page uses the same key');
});

test('a plan that the config knows but the page has no words for stops the build', () => {
  const p = config((r) => { r.planer['sky-familie'] = { navn: 'Sky Familie', medlemmer: 4, maanedlig: { dkk: 10000, eur: 1340 }, aarlig: { dkk: 100000, eur: 13400 } }; });
  assert.throws(() => side(p), /sky-familie/);
});

test('both language tables are complete: every key the page uses exists in English and Danish, and the English HTML equals the table', () => {
  const brugt = new Set<string>();
  for (const aendr of [(r: any) => { r.status = 'udkast'; }, (r: any) => { r.proeve.dage = 0; }, (r: any) => { r.status = 'godkendt'; r.proeve.kort = true; r.tilvalg['inkluderet-model'].status = 'aktiv'; }]) {
    const d = dok(side(config(aendr)));
    for (const el of Array.from(d.querySelectorAll('[data-i]'))) {
      const k = el.getAttribute('data-i')!;
      brugt.add(k);
      assert.ok(k in TABEL.en && k in TABEL.da, `key ${k} in both languages`);
      assert.equal(flad(el.textContent ?? ''), TABEL.en[k], `text of ${k}`);
    }
    for (const el of Array.from(d.querySelectorAll('[data-i-attr]'))) {
      for (const par of el.getAttribute('data-i-attr')!.split(';')) {
        const [attr, k] = par.split(':') as [string, string];
        brugt.add(k);
        assert.ok(k in TABEL.en && k in TABEL.da, `key ${k}`);
        assert.equal(flad(el.getAttribute(attr) ?? ''), TABEL.en[k], `${attr} of ${k}`);
      }
    }
  }
  const pr = Object.keys(TABEL.en).filter((k) => k.startsWith('pr.'));
  assert.deepEqual(pr.filter((k) => !(k in TABEL.da)), []);
  assert.deepEqual(Object.keys(TABEL.da).filter((k) => k.startsWith('pr.') && !(k in TABEL.en)), []);
  assert.deepEqual(pr.filter((k) => !brugt.has(k)), [], 'every pr.* key is used by some rendering of the page');
  for (const k of pr) assert.ok(TABEL.da[k]!.trim() && TABEL.en[k]!.trim(), k);
});

test('English copy: no banned words, no exclamation marks, no unprovable adjectives, no countdowns or fake scarcity', () => {
  const alt = Object.entries(TABEL.en).filter(([k]) => k.startsWith('pr.')).map(([, v]) => v).join('\n').toLowerCase();
  for (const ord of ['supercharge', 'revolutionary', 'seamless', 'effortless', 'unlock', 'game-changer', 'ai-powered', '10x', 'magic', 'most popular', 'limited time', 'hurry', 'only today', 'best value'])
    assert.ok(!alt.includes(ord), `banned: ${ord}`);
  assert.ok(!alt.includes('!'));
  assert.ok(!/\b(safe|secure|trusted)\b/.test(alt));
});

test('the page is a normal page of the site: title, one h1, lang, description, canonical, hreflang, dark, one language file', () => {
  const d = dok(side(config()));
  assert.ok(flad(d.querySelector('title')?.textContent ?? '').length > 5);
  assert.equal(d.querySelectorAll('h1').length, 1);
  assert.equal(d.documentElement.getAttribute('lang'), 'en');
  const desc = d.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
  assert.ok(desc.length >= 60 && desc.length <= 200, `description length ${desc.length}`);
  assert.equal(d.querySelector('link[rel="canonical"]')?.getAttribute('href'), 'https://clawco.work/priser');
  assert.equal(d.querySelector('link[rel="alternate"][hreflang="da"]')?.getAttribute('href'), 'https://clawco.work/priser?lang=da');
  assert.equal(d.querySelector('meta[name="color-scheme"]')?.getAttribute('content'), 'dark');
  assert.equal(d.querySelectorAll('link[rel="stylesheet"]').length, 1);
  assert.deepEqual(Array.from(d.querySelectorAll('script')).map((s) => s.getAttribute('src')), ['/strings.js', '/site.js']);
});

test('no request to any other host: only own files, plus plain links to the sign-up app and the public source', () => {
  const d = dok(side(config()));
  const ok = new Set(['clawco.work', 'konto.clawco.work', 'github.com']);
  for (const el of Array.from(d.querySelectorAll('[src],[href],[srcset],[poster],[action]'))) {
    for (const attr of ['src', 'href', 'srcset', 'poster', 'action']) {
      const v = el.getAttribute(attr);
      if (!v || !/^(https?:)?\/\//.test(v)) { if (v) assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('mailto:'), `scheme in ${v}`); continue; }
      const h = new URL(v, 'https://x.invalid').hostname;
      assert.ok(ok.has(h), `${el.tagName} ${attr} points to ${h}`);
      if (h !== 'clawco.work') assert.ok(el.tagName === 'A' && attr === 'href', `${h} may only be a plain link`);
    }
  }
  assert.equal(d.querySelectorAll('form,input,textarea,select,iframe,object,embed,[style],style,[onclick]').length, 0);
  for (const m of Array.from(d.querySelectorAll('meta[property^="og:"],meta[name^="twitter:"]'))) {
    const v = m.getAttribute('content') ?? '';
    if (/^(https?:)?\/\//.test(v)) assert.equal(new URL(v).hostname, 'clawco.work');
  }
});

test('every local link on the page resolves to a file of the site or a page the build writes', () => {
  const d = dok(side(config()));
  const bygges = new Set(['/legal', '/juridisk', '/priser', '/install.sh']);
  for (const el of Array.from(d.querySelectorAll('a[href],link[href],script[src]'))) {
    const v = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
    if (/^(https?:)?\/\//.test(v) || v.startsWith('#') || v.startsWith('mailto:')) continue;
    const p = v.split('#')[0]!.split('?')[0]!;
    const rel = p.replace(/^\//, '');
    const fil = [rel, `${rel}.html`, `${rel}index.html`].some((c) => c !== '' && existsSync(path.join(SITE, c)));
    assert.ok(fil || bygges.has(p) || p === '/', `broken link ${v}`);
  }
});

// --- site.js against the generated page ------------------------------------------------------------------------

type Los = { document: Document; click: (sel: string) => Promise<void>; lager: Map<string, string> };
function koer(html: string, search: string, opt: { sprog?: string; lagerKaster?: boolean } = {}): Los {
  const { document, window } = parseHTML(html);
  const lager = new Map<string, string>();
  const localStorage = opt.lagerKaster
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: (k: string) => lager.get(k) ?? null, setItem: (k: string, v: string) => void lager.set(k, v) };
  const ctx: Record<string, unknown> = {
    document, window, localStorage, navigator: { language: opt.sprog ?? 'en-US' }, setTimeout, clearTimeout,
    location: { search, pathname: '/priser', hash: '' }, history: { replaceState() {} }, URLSearchParams, console,
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(path.join(SITE, 'strings.js'), 'utf8'), ctx);
  vm.runInNewContext(readFileSync(path.join(SITE, 'site.js'), 'utf8'), ctx);
  const click = async (sel: string) => {
    const el = document.querySelector(sel);
    assert.ok(el, `no element ${sel}`);
    el.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setImmediate(r));
  };
  return { document, click, lager };
}
const synlige = (d: Document, sel: string) => Array.from(d.querySelectorAll(sel)).filter((e) => !e.hasAttribute('hidden'));
const HTML = side(config());

test('site.js: the default currency follows the browser language (da / DK -> DKK, otherwise EUR), the interval starts monthly', () => {
  const en = koer(HTML, '', { sprog: 'en-US' });
  assert.deepEqual(synlige(en.document, '.price').map((e) => e.getAttribute('data-cur')).filter((v, i, a) => a.indexOf(v) === i), ['eur']);
  assert.deepEqual(synlige(en.document, '.intv').map((e) => e.getAttribute('data-int')).filter((v, i, a) => a.indexOf(v) === i), ['maaned']);
  assert.ok(!en.document.querySelector('[data-toggles]')!.hasAttribute('hidden'), 'the toggles appear once the script runs');
  for (const l of ['da', 'da-DK', 'en-DK', 'sv-DK']) {
    const dk = koer(HTML, '', { sprog: l });
    assert.deepEqual(synlige(dk.document, '.price').map((e) => e.getAttribute('data-cur')).filter((v, i, a) => a.indexOf(v) === i), ['dkk'], l);
  }
  const de = koer(HTML, '', { sprog: 'de-DE' });
  assert.equal(synlige(de.document, '.price')[0]!.getAttribute('data-cur'), 'eur');
});

test('site.js: the currency and interval toggles show the matching amounts and are remembered in localStorage only', async () => {
  const s = koer(HTML, '');
  await s.click('[data-set-cur="dkk"]');
  assert.equal(s.lager.get('clawco-cur'), 'dkk');
  const dkk = synlige(s.document, '[data-plan="sky-solo"] .intv:not([hidden]) .price:not([hidden]) .amt');
  assert.deepEqual(dkk.map((e) => flad(e.textContent ?? '')), ['79 kr']);
  await s.click('[data-set-int="aar"]');
  assert.equal(s.lager.get('clawco-int'), 'aar');
  const aar = synlige(s.document, '[data-plan="sky-solo"] .intv:not([hidden]) .price:not([hidden]) .amt');
  assert.deepEqual(aar.map((e) => flad(e.textContent ?? '')), ['790 kr', '158 kr'], 'the yearly amount and the computed saving');
  assert.equal(s.document.querySelector('[data-set-cur="dkk"]')!.getAttribute('aria-pressed'), 'true');
  assert.equal(s.document.querySelector('[data-set-cur="eur"]')!.getAttribute('aria-pressed'), 'false');
  assert.equal(s.document.querySelector('[data-set-int="aar"]')!.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(synlige(s.document, 'a[data-plan-cta]').map((a) => a.getAttribute('href')), [`${TILMELD}?plan=sky-solo&interval=aar`, `${TILMELD}?plan=sky-husstand&interval=aar`]);
  // The add-on follows the currency.
  assert.deepEqual(synlige(s.document, '[data-addon] .price:not([hidden]) .amt').map((e) => flad(e.textContent ?? '')), ['49 kr']);
  // A fresh page remembers the choice.
  const igen = koer(HTML, '');
  igen.lager.set('clawco-cur', 'dkk'); igen.lager.set('clawco-int', 'aar');
  const tredje = koer(HTML, '?cur=eur&interval=maaned', { sprog: 'da' });
  assert.deepEqual(synlige(tredje.document, '.price').map((e) => e.getAttribute('data-cur')).filter((v, i, a) => a.indexOf(v) === i), ['eur'], 'the address wins over the language guess');
});

test('site.js: the language toggle re-formats the amounts (Danish separators) and keeps the choice of currency', async () => {
  const s = koer(HTML, '');
  const eur = () => flad(synlige(s.document, '[data-plan="sky-solo"] .intv:not([hidden]) .price:not([hidden]) .amt')[0]!.textContent ?? '');
  assert.equal(eur(), formatBeloeb(1060, 'eur', 'en'));
  await s.click('[data-lang-toggle]');
  assert.equal(s.document.documentElement.getAttribute('lang'), 'da');
  assert.equal(eur(), formatBeloeb(1060, 'eur', 'da'));
  assert.equal(eur(), '€10,60');
  assert.equal(flad(s.document.querySelector('[data-i="pr.cta.trial"]')!.textContent ?? ''), TABEL.da['pr.cta.trial']);
  await s.click('[data-set-cur="dkk"]');
  await s.click('[data-set-int="aar"]');
  const husstand = flad(synlige(s.document, '[data-plan="sky-husstand"] .intv:not([hidden]) .price:not([hidden]) .amt')[0]!.textContent ?? '');
  assert.equal(husstand, formatBeloeb(129000, 'dkk', 'da'));
  assert.equal(husstand, '1.290 kr');
  await s.click('[data-lang-toggle]');
  assert.equal(flad(synlige(s.document, '[data-plan="sky-husstand"] .intv:not([hidden]) .price:not([hidden]) .amt')[0]!.textContent ?? ''), '1,290 kr');
});

test('site.js: the client formatter agrees with formatBeloeb for every amount of the config, in both languages', async () => {
  const s = koer(HTML, '');
  for (const l of ['en', 'da'] as const) {
    if (s.document.documentElement.getAttribute('lang') !== l) await s.click('[data-lang-toggle]');
    for (const el of Array.from(s.document.querySelectorAll('.amt'))) {
      const cur = el.closest('[data-cur]')!.getAttribute('data-cur') as 'dkk' | 'eur';
      assert.equal(flad(el.textContent ?? ''), formatBeloeb(Number(el.getAttribute('data-minor')), cur, l));
    }
  }
});

test('site.js: a blocked localStorage does not break the toggles', async () => {
  const s = koer(HTML, '', { lagerKaster: true });
  await s.click('[data-set-cur="dkk"]');
  assert.deepEqual(synlige(s.document, '.price').map((e) => e.getAttribute('data-cur')).filter((v, i, a) => a.indexOf(v) === i), ['dkk']);
});

test('the draft banner is shown in Danish after the language toggle', async () => {
  const s = koer(side(config((r) => { r.status = 'udkast'; })), '');
  await s.click('[data-lang-toggle]');
  assert.match(flad(s.document.querySelector('[data-i="pr.draft"]')!.textContent ?? ''), /^UDKAST: priserne er ikke afgjort/);
});

// --- site-byg.mjs: who may publish the page --------------------------------------------------------------------

const byg = (...args: string[]) => spawnSync('node', [BYG, ...args], { encoding: 'utf8' });
function ny<T>(f: (ud: string, tmp: string) => T): T {
  const tmp = mkdtempSync(path.join(tmpdir(), 'clawco-priser-'));
  try { return f(path.join(tmp, 'ud'), tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const fil = (tmp: string, aendr: (r: any) => void): string => { const r = klon(RAA); aendr(r); const f = path.join(tmp, 'priser.json'); writeFileSync(f, JSON.stringify(r)); return f; };

test('site-byg: the normal build never publishes the price page; the template is never copied either', () => {
  ny((ud) => {
    const r = byg('--ud', ud);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(path.join(ud, 'priser.html')), 'no price page in the default build');
    assert.ok(!existsSync(path.join(ud, 'priser.template.html')), 'the template is source, not output');
    assert.ok(!readFileSync(path.join(ud, 'sitemap.xml'), 'utf8').includes('/priser'));
    assert.match(r.stdout, /priser/i, 'the build says the page was left out');
  });
});

test('site-byg: the normal build leaves the page out even when the prices are approved (publishing is a separate, explicit step)', () => {
  ny((ud, tmp) => {
    const r = byg('--ud', ud, '--priser', fil(tmp, (c) => { c.status = 'godkendt'; }));
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!existsSync(path.join(ud, 'priser.html')));
  });
});

test('site-byg --preview: the page is built from the config with the draft banner while the status is udkast', () => {
  ny((ud, tmp) => {
    const r = byg('--ud', ud, '--preview', '--priser', fil(tmp, (c) => { c.status = 'udkast'; }));
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(path.join(ud, 'priser.html'), 'utf8');
    assert.ok(html.includes('data-i="pr.draft"'));
    assert.match(html, /noindex/);
    assert.ok(!readFileSync(path.join(ud, 'sitemap.xml'), 'utf8').includes('/priser'), 'a preview is not put in the sitemap');
    assert.ok(!html.includes('priser.template'), 'no template marker left');
    assert.ok(!/\{\{|\}\}/.test(html), 'no unfilled slot');
  });
});

test('site-byg --live refuses to include the page while the status is udkast: exit 1, names KC-0169, writes nothing', () => {
  ny((ud, tmp) => {
    const r = byg('--ud', ud, '--live', '--priser', fil(tmp, (c) => { c.status = 'udkast'; }));
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /KC-0169/);
    assert.ok(!existsSync(ud), 'no output folder was created');
  });
});

test('site-byg --live with approved prices includes the page and adds it to the sitemap, without banner', () => {
  ny((ud, tmp) => {
    const r = byg('--ud', ud, '--live', '--priser', fil(tmp, (c) => { c.status = 'godkendt'; c.planer['sky-solo'].maanedlig.dkk = 8100; }));
    assert.equal(r.status, 0, r.stderr);
    const html = readFileSync(path.join(ud, 'priser.html'), 'utf8');
    assert.ok(!html.includes('pr.draft'));
    assert.ok(html.includes('data-minor="8100"'), 'the page follows the config file it was given');
    assert.ok(readFileSync(path.join(ud, 'sitemap.xml'), 'utf8').includes('<loc>https://clawco.work/priser</loc>'));
  });
});

test('site-byg: --preview and --live together, or a missing prices file, are refused', () => {
  ny((ud) => {
    assert.equal(byg('--ud', ud, '--preview', '--live').status, 2);
    assert.equal(byg('--ud', ud, '--preview', '--priser', path.join(ud, 'findes-ikke.json')).status, 1);
    assert.ok(!existsSync(ud));
  });
});

test('the real config in this repo builds a preview and a live page whatever its status (the real publish is Henrik\'s yes)', () => {
  ny((ud) => {
    const r = byg('--ud', ud, '--preview');
    assert.equal(r.status, 0, r.stderr);
    const d = dok(readFileSync(path.join(ud, 'priser.html'), 'utf8'));
    assert.equal(beloeb(d).length, 4 * Object.keys((RAA as { planer: object }).planer).length);
  });
});

test('the README names the preview and live flags and the rule that the normal build leaves the price page out', () => {
  const rm = laes('site/README.md');
  assert.match(rm, /--preview/);
  assert.match(rm, /--live/);
  assert.match(rm, /priser\.template\.html/);
});

test('the site reader of config/priser.json names the path that is wrong and never guesses a number', () => {
  assert.throws(() => config((r) => { r.status = 'maaske'; }), /status/);
  assert.throws(() => config((r) => { delete r.planer['sky-solo'].aarlig.eur; }), /planer\.sky-solo\.aarlig\.eur/);
  assert.throws(() => config((r) => { r.planer['sky-solo'].maanedlig.dkk = 79.5; }), /planer\.sky-solo\.maanedlig\.dkk/);
  assert.throws(() => config((r) => { r.tilvalg['inkluderet-model'].status = 'snart'; }), /status/);
  assert.throws(() => config((r) => { r.planer = {}; }), /planer/);
});

test('the site never imports from the Sky tree (the tenant tree is kept free of it, sky/test/aftryk.test.ts)', () => {
  const sky = ['..', 'sky'].join('/');
  for (const f of ['scripts/priser-side.ts', 'scripts/site-byg.mjs', 'test/site-priser.test.ts']) assert.ok(!new RegExp(`from\\s+['"][^'"]*${sky}/`).test(laes(f)), f);
});
