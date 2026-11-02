// KC-0198: the sign-up pages. Both language tables complete; every screen (test data in eksempler.ts, one per
// state — the testtilstand rule for Sky) is a well-formed page with one heading and nothing loaded from or
// linked to a third-party host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { TEKSTER } from '../../src/tilmelding/tekster.ts';
import { tilmeldingSide } from '../../src/tilmelding/render.ts';
import { EKSEMPLER, PUBLIC } from '../../src/tilmelding/eksempler.ts';
import { FASER, type Visning } from '../../src/tilmelding/trin.ts';
import { laesSamtykke } from '../../src/tilmelding/samtykke.ts';

/** Keys and value shapes of a text table, recursively (functions by arity). */
function form(v: unknown): unknown {
  if (typeof v === 'function') return `fn/${v.length}`;
  if (typeof v === 'string') return 'tekst';
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, form(x)]));
  return typeof v;
}

function tomme(v: unknown, sti = ''): string[] {
  if (typeof v === 'string') return v.trim() ? [] : [sti];
  if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => tomme(x, `${sti}.${k}`));
  return [];
}

test('Danish and English have exactly the same keys and shapes, and no empty string', () => {
  assert.deepEqual(form(TEKSTER.en), form(TEKSTER.da));
  assert.deepEqual(tomme(TEKSTER.da), []);
  assert.deepEqual(tomme(TEKSTER.en), []);
});

test('English is actually English (no Danish string copied over)', () => {
  const ens = Object.entries(TEKSTER.da).filter(([k, v]) => typeof v === 'string' && v === (TEKSTER.en as Record<string, unknown>)[k]).map(([k]) => k);
  // Language names are written in their own language in both tables.
  assert.deepEqual(ens.sort(), ['sprogDa', 'sprogEn']);
});

const VARIANTER: string[] = [
  'konto', 'profil', 'samtykke', 'invitation', 'plan', 'betaling', 'abonnement', 'aabn', 'slettes',
  ...FASER.map((f) => `klargoering:${f}:i-gang`), 'klargoering:startet:langsom', 'klargoering:startet:fejlet',
];
const noegle = (v: Visning): string => (v.trin === 'klargoering' ? `klargoering:${v.fase}:${v.status}` : v.trin);

test('every screen has test data (progress, slow, failed, ready …)', () => {
  const har = new Set(Object.values(EKSEMPLER).map((e) => noegle(e.side.visning)));
  for (const v of VARIANTER) assert.ok(har.has(v), `ingen eksempel for ${v}`);
});

const STRIPE = new Set(['https://checkout.stripe.com', 'https://billing.stripe.com']);
// The legal texts live on the public site: a plain link (never a form target or a resource) may lead there.
const SITE = 'https://clawco.work';

for (const sprog of ['da', 'en'] as const) {
  for (const [navn, e] of Object.entries(EKSEMPLER)) {
    test(`${navn} (${sprog}): title, one h1, lang, viewport, at most one primary button, no third-party src/href`, () => {
      const side = tilmeldingSide({ ...e.faelles, sprog }, e.side);
      const { document } = parseHTML(side);
      assert.equal(document.documentElement.getAttribute('lang'), sprog);
      assert.ok(document.querySelector('title')?.textContent?.trim(), 'title');
      assert.equal(document.querySelectorAll('h1').length, 1, 'one h1');
      assert.match(document.querySelector('meta[name=viewport]')?.getAttribute('content') ?? '', /width=device-width/);
      assert.ok(document.querySelectorAll('.primaer').length <= 1, 'one primary button');
      for (const el of document.querySelectorAll('[href], [src], [action]')) {
        const raa = el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('action') ?? '';
        const u = new URL(raa, PUBLIC);
        assert.ok(u.origin === new URL(PUBLIC).origin || STRIPE.has(u.origin) || (u.origin === SITE && el.tagName === 'A'), `${navn}: ${raa}`);
      }
    });
  }
}

test('plan: the plans given (from config/priser.json in production), the account country rides along, Checkout returns into the flow', () => {
  const e = EKSEMPLER['plan']!;
  const { document } = parseHTML(tilmeldingSide(e.faelles, e.side));
  // KC-0209: the plan step leads to the statement (a plain GET: nothing is bought here); Checkout is its button.
  const f = document.querySelector('form[action="/konto/abonnement/bekraeft"]');
  assert.ok(f);
  assert.equal(f.getAttribute('method'), 'get');
  assert.equal(f.querySelector('input[name=retur]')?.getAttribute('value'), 'tilmelding');
  assert.equal(f.querySelector('input[name=land]')?.getAttribute('value'), 'DK');
  assert.ok(!f.querySelector('input[name=csrf]'));
  assert.equal(document.querySelector('form[action="/api/abonnement/checkout"]'), null);
  assert.match(f.querySelector('button')?.textContent ?? '', /Videre til bekræftelse/);
  const tekst = document.body.textContent ?? '';
  assert.match(tekst, /Sky Solo/);
  assert.match(tekst, /Sky Husstand/);
  assert.ok(tekst.includes(TEKSTER.da.pris(1000, 10000)), tekst);
  assert.match(tekst, /14 dage gratis, intet kort/);
});

test('plan: the pricing page link preselects plan and interval', () => {
  const e = EKSEMPLER['plan']!;
  const side = tilmeldingSide(e.faelles, { ...e.side, valg: { plan: 'sky-husstand', interval: 'aar' } } as typeof e.side);
  const { document } = parseHTML(side);
  assert.ok(document.querySelector('input[name=plan][value="sky-husstand"][checked]'));
  assert.ok(document.querySelector('input[name=interval][value="aar"][checked]'));
});

test('profile: two required consent boxes linking to /vilkaar and /privatliv on our host', () => {
  const e = EKSEMPLER['profil']!;
  const { document } = parseHTML(tilmeldingSide(e.faelles, e.side));
  for (const navn of ['vilkaar', 'privatliv']) {
    const boks = document.querySelector(`input[type=checkbox][name=${navn}]`);
    assert.ok(boks?.hasAttribute('required'), navn);
  }
  assert.ok(document.querySelector('select[name=land][required]'));
});

test('the consent links lead to the texts on the public site, in the page language (the account host serves none)', () => {
  for (const navn of ['profil', 'samtykke']) {
    const e = EKSEMPLER[navn]!;
    const da = parseHTML(tilmeldingSide({ ...e.faelles, sprog: 'da' }, e.side)).document;
    assert.equal(da.querySelector('a[href="https://clawco.work/vilkaar"]')?.getAttribute('target'), '_blank', navn);
    assert.ok(da.querySelector('a[href="https://clawco.work/privatliv"]'), navn);
    const en = parseHTML(tilmeldingSide({ ...e.faelles, sprog: 'en' }, e.side)).document;
    assert.ok(en.querySelector('a[href="https://clawco.work/en/vilkaar"]'), navn);
    assert.ok(en.querySelector('a[href="https://clawco.work/en/privatliv"]'), navn);
    assert.equal(da.querySelector('a[rel~="noopener"]')?.getAttribute('rel'), 'noopener');
  }
});

test('KC-0204 re-accept screen: says what changed, shows the current versions, two required boxes, delete stays reachable', () => {
  const e = EKSEMPLER['samtykke']!;
  const da = parseHTML(tilmeldingSide(e.faelles, e.side)).document;
  assert.match(da.querySelector('h1')?.textContent ?? '', /Vilkårene er ændret/);
  const S = laesSamtykke();
  assert.equal(da.querySelector('input[type=checkbox][name=vilkaar]')?.getAttribute('value'), S.vilkaar.version);
  assert.equal(da.querySelector('input[type=checkbox][name=privatliv]')?.getAttribute('value'), S.privatliv.version);
  for (const n of ['vilkaar', 'privatliv']) assert.ok(da.querySelector(`input[name=${n}]`)?.hasAttribute('required'));
  assert.equal(da.querySelector('form')?.getAttribute('action'), '/tilmeld/samtykke');
  assert.ok(da.querySelector('a[href="/konto/slet"]'), 'delete');
  assert.ok(da.querySelector('a[href="/konto"]'), 'the account page');
  assert.equal(da.querySelectorAll('select, input[name=land], input[name=sprog]').length, 0, 'no profile questions again');
  const en = parseHTML(tilmeldingSide({ ...e.faelles, sprog: 'en' }, e.side)).document;
  assert.match(en.querySelector('h1')?.textContent ?? '', /terms have changed/i);
});

test('provisioning shows the real stages in words, never a percentage, and polls the status endpoint', () => {
  const e = EKSEMPLER['klargoering-startet']!;
  const side = tilmeldingSide(e.faelles, e.side);
  assert.doesNotMatch(side, /%|<progress/);
  const { document } = parseHTML(side);
  const faser = [...document.querySelectorAll('ol.faser li')];
  assert.equal(faser.length, 4);
  assert.deepEqual(faser.map((l) => l.getAttribute('data-tilstand')), ['faerdig', 'faerdig', 'i-gang', 'venter']);
  const p = document.querySelector('[data-poll]');
  assert.equal(p?.getAttribute('data-poll'), '/api/tilmelding/status');
  assert.equal(p?.getAttribute('data-noegle'), 'klargoering:startet:i-gang');
});

test('failed: a retry form (POST with CSRF); slow: the "longer than usual" line, no retry', () => {
  const f = EKSEMPLER['klargoering-fejlet']!;
  const { document } = parseHTML(tilmeldingSide(f.faelles, f.side));
  assert.ok(document.querySelector('form[action="/api/tilmelding/igen"][method=post] input[name=csrf]'));
  const l = EKSEMPLER['klargoering-langsom']!;
  const ls = tilmeldingSide(l.faelles, l.side);
  assert.match(ls, /længere end normalt/);
  assert.doesNotMatch(ls, /\/api\/tilmelding\/igen/);
});

test('ready: one button, "Åbn Clawco", to the way in', () => {
  const e = EKSEMPLER['aabn']!;
  const { document } = parseHTML(tilmeldingSide(e.faelles, e.side));
  const a = document.querySelector('a.primaer');
  assert.equal(a?.textContent, 'Åbn Clawco');
  assert.equal(a?.getAttribute('href'), (e.side as { aabnUrl: string }).aabnUrl);
});

test('user text is escaped', () => {
  const e = EKSEMPLER['konto']!;
  const side = tilmeldingSide(e.faelles, { ...e.side, til: '/tilmeld?plan="><script>' } as typeof e.side);
  assert.doesNotMatch(side, /"><script>/);
});
