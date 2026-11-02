import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

// KC-0202: the public status page (site/status.html + site/status.js). Static, on other infrastructure than Clawco Sky; it
// reads Sky's public feed from the visitor's browser and FAILS CLOSED: a missing, stale, future-dated or unreadable feed is
// "unknown" for every part and the banner, never green. Invariants: (1) the HTML itself says unknown until the script has
// judged a fresh feed; (2) status.js is the only script that makes a request, to exactly one address; (3) one function
// (vurder) decides every state; (4) the page names no host but konto.clawco.work, and only for the Atom link; (5) a state is
// never conveyed by colour alone.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const SITE = path.join(ROD, 'site');
const FEED_URL = 'https://konto.clawco.work/status.json';
const ATOM_URL = 'https://konto.clawco.work/status.atom';
const IDER = ['login', 'adgang', 'oprettelse', 'sikkerhedskopi', 'mail', 'clawco'] as const;
const laes = (rel: string): string => readFileSync(path.join(ROD, rel), 'utf8');
const flad = (s: string): string => s.replace(/\s+/g, ' ').trim();
const dok = (rel: string) => parseHTML(readFileSync(path.join(SITE, rel), 'utf8')).document;

type Tabel = { en: Record<string, string>; da: Record<string, string> };
function laesTabel(): Tabel {
  const ctx: { globalThis?: unknown; CLAWCO_TEXT?: Tabel } = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(laes('site/strings.js'), ctx);
  return ctx.CLAWCO_TEXT!;
}
const T = laesTabel();

// --- the page as written (no script has run) -------------------------------------------------------------------------

test('the page exists, is in the sitemap, and lists the six parts in order', () => {
  const d = dok('status.html');
  assert.equal(d.querySelector('link[rel="canonical"]')!.getAttribute('href'), 'https://clawco.work/status');
  assert.ok(laes('site/sitemap.xml').includes('<loc>https://clawco.work/status</loc>'));
  assert.deepEqual(Array.from(d.querySelectorAll('li.st-k')).map((e) => e.getAttribute('data-k')), [...IDER]);
  assert.equal(flad(d.querySelector('h1')!.textContent ?? ''), 'Is Clawco Sky working right now?');
  assert.equal(T.da['st.h1'], 'Virker Clawco Sky lige nu?');
  for (const k of IDER) assert.equal(flad(d.querySelector(`li[data-k="${k}"] .st-navn`)!.textContent ?? ''), T.en[`st.k.${k}`]);
  assert.equal(T.en['st.k.login'], 'Sign-in and sign-up');
  assert.equal(T.da['st.k.clawco'], 'Kundernes Clawco');
  assert.ok(d.querySelector('li[data-k="clawco"] .st-andel'), 'the customers\' Clawco part has the share line');
  assert.equal(d.querySelectorAll('.st-andel').length, 1);
  for (const li of Array.from(d.querySelectorAll('li.st-k'))) assert.ok(li.querySelector('ol.st-dage[aria-label]'), 'a 90-day strip with an accessible name');
});

test('without the script the page says unknown: every part, the banner, and a noscript note; the last-measured line stays hidden', () => {
  const d = dok('status.html');
  const stat = Array.from(d.querySelectorAll('.st-status'));
  assert.equal(stat.length, IDER.length);
  for (const s of stat) {
    assert.equal(s.getAttribute('data-state'), 'ukendt');
    assert.equal(flad(s.textContent ?? ''), 'Unknown');
  }
  for (const li of Array.from(d.querySelectorAll('li.st-k'))) assert.equal(li.getAttribute('data-state'), 'ukendt');
  const b = d.querySelector('p.st-banner')!;
  assert.equal(b.getAttribute('data-state'), 'ukendt');
  assert.equal(b.getAttribute('role'), 'status');
  assert.equal(flad(b.textContent ?? ''), 'We cannot measure right now.');
  assert.equal(d.querySelectorAll('.st-dage > li').length, 0, 'no strip until a feed is judged');
  assert.ok(d.querySelector('.st-sidst')!.hasAttribute('hidden'));
  assert.ok(T.en['st.noscript']!.startsWith('This page needs JavaScript'));
  assert.ok(readFileSync(path.join(SITE, 'status.html'), 'utf8').includes('<noscript>'));
  // Honest default for the incident list: before the feed is loaded we do not know.
  assert.equal(flad(d.querySelector('.st-ingen')!.textContent ?? ''), 'No incidents in the last 90 days are known to this page until it has loaded the feed.');
});

test('the page names no host but konto.clawco.work, only for the Atom link (a[href] and link[rel=alternate])', () => {
  const d = dok('status.html');
  const fremmede: string[] = [];
  for (const el of Array.from(d.querySelectorAll('[src],[href]'))) {
    const v = el.getAttribute('src') ?? el.getAttribute('href')!;
    if (!/^(https?:)?\/\//.test(v)) continue;
    const vaert = new URL(v).hostname;
    if (vaert === 'clawco.work' || (vaert === 'github.com' && el.closest('footer'))) continue;
    assert.equal(v, ATOM_URL, `unexpected ${v}`);
    assert.ok((el.tagName === 'A') || (el.tagName === 'LINK' && el.getAttribute('rel') === 'alternate' && el.getAttribute('type') === 'application/atom+xml'), `${el.tagName} may not point at konto.clawco.work`);
    fremmede.push(el.tagName);
  }
  assert.deepEqual(fremmede.sort(), ['A', 'LINK']);
  assert.deepEqual(Array.from(d.querySelectorAll('script')).map((s) => s.getAttribute('src')), ['/strings.js', '/site.js', '/status.js'], 'status.js runs after site.js (it reads the language site.js applied)');
  assert.equal(flad(d.querySelector('a[href="' + ATOM_URL + '"]')!.textContent ?? ''), 'Subscribe (Atom)');
  assert.equal(T.da['st.atom'], 'Abonnér (Atom)');
});

test('the footer promise is the page\'s own and names the one request; the other footer links are the usual ones', () => {
  const d = dok('status.html');
  assert.equal(d.querySelector('footer p')!.getAttribute('data-i'), 'st.foot.promise');
  assert.match(T.en['st.foot.promise']!, /konto\.clawco\.work/);
  assert.match(T.en['st.foot.promise']!, /no cookies/);
  assert.ok(d.querySelector('footer a[href="https://github.com/SlambertDK/clawco"]'));
  assert.ok(d.querySelector('footer a[href="/legal"][data-href-da="/juridisk"]'));
  const how = Array.from(d.querySelectorAll('main p')).map((p) => p.textContent).join(' ');
  assert.match(how, /different place than Clawco Sky/);
  assert.match(how, /older than 5 minutes/);
});

test('every page of the site links the status page from its footer right after Help, with a key in both languages', () => {
  const filer: string[] = [];
  const gaa = (rel: string): void => {
    for (const e of readdirSync(path.join(SITE, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) gaa(r); else if (e.name.endsWith('.html')) filer.push(r);
    }
  };
  gaa('');
  assert.ok(filer.length > 20);
  for (const f of filer) {
    const a = dok(f).querySelector('footer a[href="/status"]');
    assert.ok(a, `${f}: no footer link to /status`);
    assert.equal(a.getAttribute('data-i'), 'c.nav.status', f);
    assert.equal(a.previousElementSibling?.getAttribute('href'), '/hjaelp', `${f}: Status goes right after Help`);
  }
  assert.equal(T.en['c.nav.status'], 'Status');
  assert.equal(T.da['c.nav.status'], 'Status');
});

// --- fetch: one script, one address ---------------------------------------------------------------------------------

test('status.js is the only script that makes a request, to exactly one constant address; nothing sets a cookie', () => {
  const js = readdirSync(SITE).filter((f) => f.endsWith('.js'));
  assert.deepEqual(js.sort(), ['site.js', 'status.js', 'strings.js']);
  for (const f of js) {
    const kode = laes(`site/${f}`);
    assert.ok(!/document\.cookie|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts/.test(kode), `${f}: forbidden API`);
    const n = (kode.match(/\bfetch\s*\(/g) ?? []).length;
    assert.equal(n, f === 'status.js' ? 1 : 0, `${f}: fetch calls`);
  }
  const kode = laes('site/status.js');
  assert.equal((kode.match(/https?:\/\/[^\s'"`)]+/g) ?? []).filter((u) => !u.startsWith('https://www.w3.org')).length, 1, 'one address in the script');
  assert.ok(kode.includes(`const FEED_URL = '${FEED_URL}';`));
  assert.ok(/fetch\(FEED_URL, \{[^}]*cache: 'no-store'[^}]*credentials: 'omit'[^}]*mode: 'cors'[^}]*\}\)/.test(kode) || /fetch\(FEED_URL, \{[^}]*credentials: 'omit'[^}]*\}\)/.test(kode), 'no credentials, no cache');
  assert.ok(/const STALE_MS = 5 \* 60 \* 1000;/.test(kode), 'the 5-minute limit is one named constant');
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(kode), 'it stores nothing; the language comes from the page');
});

// --- vurder: the one place that decides a state --------------------------------------------------------------------

const NU = Date.parse('2026-11-02T10:00:00.000Z');
type Vurdering = { state: string; opdateret: string | null; haendelser: { titel: string; tekst: string; start: string; slut: string | null }[]; komponenter: Record<string, { state: string; oppetid: number | null; dage: { dag: string | null; oppetid: number | null; state: string }[]; andel: number | null }> };
function hent(): { vurder: (f: unknown, nu: number) => Vurdering } {
  const ctx: Record<string, unknown> = { console };
  ctx.globalThis = ctx;
  vm.runInNewContext(laes('site/status.js'), ctx);
  const s = ctx.CLAWCO_STATUS as { vurder: (f: unknown, nu: number) => Vurdering } | undefined;
  assert.ok(s && typeof s.vurder === 'function', 'status.js exposes CLAWCO_STATUS.vurder');
  // The result comes from another realm; a JSON round trip makes it comparable (and proves it is plain data).
  return { vurder: (f, nu) => JSON.parse(JSON.stringify(s.vurder(f, nu))) as Vurdering };
}

function dage90(slut = '2026-11-02', n = 90): { dag: string; oppetid: number | null }[] {
  const ud: { dag: string; oppetid: number | null }[] = [];
  for (let i = n - 1; i >= 0; i--) ud.push({ dag: new Date(Date.parse(slut + 'T00:00:00Z') - i * 86_400_000).toISOString().slice(0, 10), oppetid: 100 });
  return ud;
}
const antalSkjult = { sund: 7777, traeg: 0, syg: 0, opdaterer: 0 };
function feed(o: { alder?: number; status?: Record<string, string>; samlet?: string; uden?: string[]; dage?: { dag: string; oppetid: number | null }[]; opdateret?: string; haendelser?: unknown[] } = {}): Record<string, unknown> {
  const opdateret = o.opdateret ?? new Date(NU - (o.alder ?? 20_000)).toISOString();
  const komponenter = IDER.filter((k) => !(o.uden ?? []).includes(k)).map((id) => ({
    id, navn: id, status: o.status?.[id] ?? 'ok', oppetid90d: 99.98, dage: o.dage ?? dage90(),
    ...(id === 'clawco' ? { andelSund: 94, antal: antalSkjult } : {}),
  }));
  return { opdateret, samlet: o.samlet ?? 'ok', komponenter, haendelser: o.haendelser ?? [] };
}
const ukendtAlt = (v: Vurdering): void => {
  assert.equal(v.state, 'ukendt');
  assert.deepEqual(Object.keys(v.komponenter), [...IDER]);
  for (const k of IDER) {
    assert.equal(v.komponenter[k]!.state, 'ukendt', k);
    assert.equal(v.komponenter[k]!.oppetid, null, k);
    assert.equal(v.komponenter[k]!.andel, null, k);
    assert.deepEqual(v.komponenter[k]!.dage, [], `${k}: the strip stays empty when nothing is known`);
  }
  assert.deepEqual(v.haendelser, []);
};

test('vurder: a fresh feed, everything ok, is ok; the numbers and the share come through', () => {
  const v = hent().vurder(feed(), NU);
  assert.equal(v.state, 'ok');
  for (const k of IDER) { assert.equal(v.komponenter[k]!.state, 'ok'); assert.equal(v.komponenter[k]!.oppetid, 99.98); assert.equal(v.komponenter[k]!.dage.length, 90); assert.equal(v.komponenter[k]!.dage.at(-1)!.state, 'ok'); }
  assert.equal(v.komponenter['clawco']!.andel, 94);
  assert.equal(v.komponenter['login']!.andel, null);
  assert.equal(v.opdateret, new Date(NU - 20_000).toISOString());
  assert.ok(!JSON.stringify(v).includes('7777'), 'the bucket counts never leave vurder');
});

test('vurder: a fresh feed with one part nede shows that part nede and the banner from samlet', () => {
  const v = hent().vurder(feed({ status: { login: 'nede' }, samlet: 'nede' }), NU);
  assert.equal(v.komponenter['login']!.state, 'nede');
  assert.equal(v.komponenter['mail']!.state, 'ok');
  assert.equal(v.state, 'nede');
  const n = hent().vurder(feed({ status: { sikkerhedskopi: 'nede' }, samlet: 'nedsat' }), NU);
  assert.equal(n.komponenter['sikkerhedskopi']!.state, 'nede');
  assert.equal(n.state, 'nedsat');
});

test('vurder: the 5-minute boundary, in both directions of the clock', () => {
  const { vurder } = hent();
  assert.equal(vurder(feed({ alder: 4 * 60_000 + 59_000 }), NU).state, 'ok', '4 min 59 s old is fresh');
  assert.equal(vurder(feed({ alder: 5 * 60_000 }), NU).state, 'ok', 'exactly 5 minutes is not older than 5 minutes');
  ukendtAlt(vurder(feed({ alder: 5 * 60_000 + 1_000 }), NU));
  ukendtAlt(vurder(feed({ alder: -(5 * 60_000 + 1_000) }), NU));
  assert.equal(vurder(feed({ alder: -(4 * 60_000 + 59_000) }), NU).state, 'ok', 'a small clock difference is tolerated');
  // Stale data never carries a state, even a bad one: nothing is claimed.
  ukendtAlt(vurder(feed({ alder: 10 * 60_000, status: { login: 'nede' }, samlet: 'nede' }), NU));
});

test('vurder: a stale feed still reports its own time, so the page can say when it last measured', () => {
  const v = hent().vurder(feed({ alder: 10 * 60_000 }), NU);
  assert.equal(v.opdateret, new Date(NU - 10 * 60_000).toISOString());
});

test('vurder: nothing usable is unknown, never a throw and never green', () => {
  const { vurder } = hent();
  for (const x of [null, undefined, 'ok', 42, [], {}, { opdateret: 'ikke en tid', samlet: 'ok', komponenter: [], haendelser: [] }, { ...feed(), opdateret: undefined }, { ...feed(), opdateret: 123 }, { ...feed(), komponenter: 'ok' }, { ...feed(), haendelser: 'ingen' }, { ...feed(), samlet: 'fint' }, { ...feed(), samlet: undefined }]) {
    ukendtAlt(vurder(x, NU));
  }
  ukendtAlt(vurder(feed(), Number.NaN));
});

test('vurder: a part missing from the feed, or with an unknown status, is unknown and the banner is not green', () => {
  const { vurder } = hent();
  const mangler = vurder(feed({ uden: ['mail'] }), NU);
  assert.equal(mangler.komponenter['mail']!.state, 'ukendt');
  assert.equal(mangler.komponenter['login']!.state, 'ok');
  assert.equal(mangler.state, 'ukendt', 'samlet says ok but one part is unknown: not green');
  const mystisk = vurder(feed({ status: { adgang: 'fremragende' } }), NU);
  assert.equal(mystisk.komponenter['adgang']!.state, 'ukendt');
  assert.equal(mystisk.komponenter['adgang']!.oppetid, null);
  assert.equal(mystisk.state, 'ukendt');
  // A known bad state is not hidden by a missing part.
  assert.equal(vurder(feed({ uden: ['mail'], status: { login: 'nede' }, samlet: 'nede' }), NU).state, 'nede');
  // An inconsistent feed (samlet ok, a part degraded) is not green either.
  assert.equal(vurder(feed({ status: { mail: 'nedsat' }, samlet: 'ok' }), NU).state, 'nedsat');
});

test('vurder: the 90-day series is padded with unknown at the start, cut to the last 90, and a bad entry is unknown, not 100', () => {
  const { vurder } = hent();
  const kort = vurder(feed({ dage: dage90('2026-11-02', 5) }), NU).komponenter['login']!.dage;
  assert.equal(kort.length, 90);
  assert.deepEqual(kort.slice(0, 85).map((d) => [d.dag, d.oppetid, d.state]), Array(85).fill([null, null, 'ukendt']));
  assert.equal(kort[85]!.dag, '2026-10-29');
  assert.equal(kort.at(-1)!.dag, '2026-11-02');
  const lang = vurder(feed({ dage: dage90('2026-11-02', 120) }), NU).komponenter['login']!.dage;
  assert.equal(lang.length, 90);
  assert.equal(lang.at(-1)!.dag, '2026-11-02');
  const blandet = dage90();
  blandet[89] = { dag: '2026-11-02', oppetid: 100 };
  blandet[88] = { dag: '2026-11-01', oppetid: 97.5 };
  blandet[87] = { dag: '2026-10-31', oppetid: 40 };
  blandet[86] = { dag: '2026-10-30', oppetid: null };
  blandet[85] = { dag: '2026-10-29', oppetid: 140 };
  blandet[84] = { dag: '2026-10-28', oppetid: '100' as unknown as number };
  const d = vurder(feed({ dage: blandet }), NU).komponenter['login']!.dage;
  assert.deepEqual(d.slice(84).map((x) => x.state), ['ukendt', 'ukendt', 'ukendt', 'nede', 'nedsat', 'ok']);
  assert.equal(vurder(feed({ dage: 'nej' as unknown as [] }), NU).komponenter['login']!.dage.every((x) => x.state === 'ukendt'), true);
});

test('vurder: incidents are passed through as data; a malformed incident makes the whole feed unreadable', () => {
  const { vurder } = hent();
  const h = [{ titel: 'Langsom login', tekst: 'Det var <b>langsomt</b>.', start: '2026-11-01T08:00:00.000Z', slut: null }];
  const v = vurder(feed({ haendelser: h }), NU);
  assert.deepEqual(v.haendelser, h);
  ukendtAlt(vurder(feed({ haendelser: [{ titel: 'x' }] }), NU));
  ukendtAlt(vurder(feed({ haendelser: [{ titel: 'x', tekst: 'y', start: 'aldrig', slut: null }] }), NU));
  assert.equal(vurder(feed({ haendelser: Array.from({ length: 30 }, (_, i) => ({ titel: `h${i}`, tekst: 't', start: '2026-11-01T08:00:00.000Z', slut: null })) }), NU).haendelser.length, 20, 'at most the 20 the feed promises');
});

// --- the DOM: status.js against the page, with a stubbed fetch ----------------------------------------------------

type Svar = { ok?: boolean; status?: number; json?: () => Promise<unknown> };
function koer(opt: { fetch?: (url: string, init: Record<string, unknown>) => Promise<Svar>; lang?: string; nu?: number } = {}) {
  const klok = { nu: opt.nu ?? Date.now() };
  const { document, window } = parseHTML(readFileSync(path.join(SITE, 'status.html'), 'utf8'));
  const kald: { url: string; init: Record<string, unknown> }[] = [];
  const intervaller: { fn: () => void; ms: number }[] = [];
  const lager = new Map<string, string>();
  const ctx: Record<string, unknown> = {
    document, window, console, URLSearchParams, setTimeout, clearTimeout,
    localStorage: { getItem: (k: string) => lager.get(k) ?? null, setItem: (k: string, v: string) => void lager.set(k, v) },
    navigator: { language: 'en-GB' },
    location: { search: opt.lang ? `?lang=${opt.lang}` : '', pathname: '/status', hash: '' },
    history: { replaceState() {} },
    setInterval: (fn: () => void, ms: number) => { intervaller.push({ fn, ms }); return intervaller.length; },
    clearInterval() {},
    fetch: opt.fetch ? (url: string, init: Record<string, unknown>) => { kald.push({ url, init }); return opt.fetch!(url, init); } : undefined,
  };
  ctx.globalThis = ctx;
  if (opt.nu !== undefined) {
    const D = Date;
    ctx.Date = class extends D { static override now(): number { return klok.nu; } };
  }
  vm.runInNewContext(laes('site/strings.js'), ctx);
  vm.runInNewContext(laes('site/site.js'), ctx);
  vm.runInNewContext(laes('site/status.js'), ctx);
  const vent = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  const klik = async (sel: string): Promise<void> => { document.querySelector(sel)!.dispatchEvent(new window.Event('click', { bubbles: true })); await vent(); };
  return { document, window, kald, intervaller, vent, klik, klok };
}
const ok = (f: unknown) => async (): Promise<Svar> => ({ ok: true, status: 200, json: async () => f });
const tekst = (d: Document, sel: string): string => flad(d.querySelector(sel)?.textContent ?? '');
const tilstande = (d: Document): string[] => Array.from(d.querySelectorAll('.st-status')).map((e) => e.getAttribute('data-state')!);

test('DOM: a fresh feed renders labels, uptime, the 90-day strip, the share, the time and the incidents — with text, not only colour', async () => {
  const nu = Date.now();
  const f = feed({ opdateret: new Date(nu - 10_000).toISOString(), status: { sikkerhedskopi: 'nedsat' }, samlet: 'nedsat', haendelser: [{ titel: 'Backup <slow>', tekst: 'Kopien tog længere tid <img src=x onerror=alert(1)>.', start: new Date(nu - 3_600_000).toISOString(), slut: null }] });
  f.komponenter = (f.komponenter as { id: string; dage: unknown[] }[]).map((k) => (k.id === 'mail' ? { ...k, dage: dage90('2026-11-02').map((d, i) => (i === 89 ? { ...d, oppetid: 80 } : i === 88 ? { ...d, oppetid: 99.4 } : i === 87 ? { ...d, oppetid: null } : d)) } : k));
  const s = koer({ fetch: ok(f), nu });
  await s.vent();
  assert.equal(s.kald.length, 1);
  assert.equal(s.kald[0]!.url, FEED_URL);
  assert.equal(s.kald[0]!.init['credentials'], 'omit');
  assert.equal(s.kald[0]!.init['cache'], 'no-store');
  assert.equal(s.kald[0]!.init['mode'], 'cors');
  const d = s.document;
  assert.deepEqual(tilstande(d), ['ok', 'ok', 'ok', 'nedsat', 'ok', 'ok']);
  assert.equal(tekst(d, 'li[data-k="login"] .st-status'), 'Working');
  assert.equal(tekst(d, 'li[data-k="sikkerhedskopi"] .st-status'), 'Degraded');
  assert.equal(d.querySelector('li[data-k="sikkerhedskopi"]')!.getAttribute('data-state'), 'nedsat');
  assert.equal(tekst(d, 'li[data-k="login"] .st-oppetid'), '99.98 % over 90 days');
  assert.equal(d.querySelector('p.st-banner')!.getAttribute('data-state'), 'nedsat');
  assert.equal(tekst(d, 'p.st-banner'), 'Something is degraded.');
  assert.equal(d.querySelectorAll('li[data-k="login"] .st-dage > li').length, 90);
  const bar = d.querySelectorAll('li[data-k="mail"] .st-dage > li');
  assert.deepEqual([bar[87]!, bar[88]!, bar[89]!].map((b) => b.getAttribute('data-state')), ['ukendt', 'nedsat', 'nede']);
  assert.equal(bar[89]!.getAttribute('title'), '2026-11-02: 80 %');
  assert.equal(bar[87]!.getAttribute('title'), '2026-10-31: no data');
  assert.equal(tekst(d, 'li[data-k="mail"] .st-sum'), '90 days: 87 fully working, 1 degraded, 1 down, 1 unknown');
  assert.equal(tekst(d, 'li[data-k="clawco"] .st-andel'), 'Share of customers\' Clawco answering: 94 %');
  assert.ok(!d.querySelector('li[data-k="clawco"] .st-andel')!.hasAttribute('hidden'));
  assert.ok(!d.body.textContent!.includes('7777'), 'bucket counts are never shown');
  assert.ok(!d.querySelector('.st-sidst')!.hasAttribute('hidden'));
  assert.ok(tekst(d, '.st-sidst .st-tid').length > 4);
  // Incidents: text only, never markup.
  assert.equal(d.querySelectorAll('.st-haendelser > li').length, 1);
  assert.equal(tekst(d, '.st-haendelser li h3'), 'Backup <slow>');
  assert.equal(d.querySelectorAll('.st-haendelser img, .st-haendelser b').length, 0);
  assert.match(tekst(d, '.st-haendelser li'), /ongoing/);
  assert.ok(d.querySelector('.st-ingen')!.hasAttribute('hidden'));
  s.intervaller.forEach((i) => assert.equal(i.ms, 60_000));
  assert.ok(s.intervaller.length >= 1, 're-fetches on a timer');
});

test('DOM: no incidents in a fresh feed says so; the Danish page formats with a decimal comma', async () => {
  const nu = Date.now();
  const s = koer({ fetch: ok(feed({ opdateret: new Date(nu - 1_000).toISOString() })), nu, lang: 'da' });
  await s.vent();
  const d = s.document;
  assert.equal(d.documentElement.getAttribute('lang'), 'da');
  assert.equal(tekst(d, 'p.st-banner'), 'Alt virker.');
  assert.equal(tekst(d, 'li[data-k="login"] .st-status'), 'Virker');
  assert.equal(tekst(d, 'li[data-k="login"] .st-oppetid'), '99,98 % de seneste 90 dage');
  assert.equal(tekst(d, '.st-ingen'), 'Ingen hændelser de seneste 90 dage.');
  assert.ok(!d.querySelector('.st-ingen')!.hasAttribute('hidden'));
  assert.equal(d.querySelectorAll('.st-haendelser > li').length, 0);
});

test('DOM: the language toggle re-renders the fetched state (labels, uptime, summary) in the other language', async () => {
  const nu = Date.now();
  const s = koer({ fetch: ok(feed({ opdateret: new Date(nu - 1_000).toISOString(), status: { mail: 'nede' }, samlet: 'nedsat' })), nu });
  await s.vent();
  assert.equal(tekst(s.document, 'li[data-k="mail"] .st-status'), 'Down');
  await s.klik('[data-lang-toggle]');
  assert.equal(s.document.documentElement.getAttribute('lang'), 'da');
  assert.equal(tekst(s.document, 'li[data-k="mail"] .st-status'), 'Nede');
  assert.equal(tekst(s.document, 'p.st-banner'), 'Noget er nedsat.');
  assert.equal(tekst(s.document, 'li[data-k="mail"] .st-oppetid'), '99,98 % de seneste 90 dage');
  assert.match(tekst(s.document, 'li[data-k="mail"] .st-sum'), /^90 dage: 90 virkede fuldt$/);
  assert.equal(tekst(s.document, 'li[data-k="login"] .st-navn'), 'Login og tilmelding');
});

test('DOM: a rejected fetch, a non-200, bad JSON and a stale feed all leave everything unknown', async () => {
  const nu = Date.now();
  const tilfaelde: [string, () => Promise<Svar>][] = [
    ['network error', async () => { throw new TypeError('Failed to fetch'); }],
    ['503', async () => ({ ok: false, status: 503, json: async () => ({ fejl: 'x' }) })],
    ['bad JSON', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } })],
    ['204 with a good body', async () => ({ ok: true, status: 204, json: async () => feed({ opdateret: new Date(nu).toISOString() }) })],
    ['stale', ok(feed({ opdateret: new Date(nu - 5 * 60_000 - 1_000).toISOString() }))],
    ['future', ok(feed({ opdateret: new Date(nu + 5 * 60_000 + 1_000).toISOString() }))],
  ];
  for (const [navn, f] of tilfaelde) {
    const s = koer({ fetch: f, nu });
    await s.vent();
    const d = s.document;
    assert.deepEqual(tilstande(d), IDER.map(() => 'ukendt'), navn);
    assert.deepEqual(Array.from(d.querySelectorAll('.st-status')).map((e) => flad(e.textContent ?? '')), IDER.map(() => 'Unknown'), navn);
    assert.equal(d.querySelector('p.st-banner')!.getAttribute('data-state'), 'ukendt', navn);
    assert.equal(tekst(d, 'p.st-banner'), 'We cannot measure right now.', navn);
    assert.equal(d.querySelectorAll('.st-dage > li').length, 0, navn);
    assert.equal(d.querySelectorAll('.st-haendelser > li').length, 0, navn);
    assert.ok(d.querySelector('.st-andel')!.hasAttribute('hidden'), navn);
  }
});

test('DOM: no fetch at all (an old browser) leaves the page as written: unknown', async () => {
  const s = koer({ nu: Date.now() });
  await s.vent();
  assert.deepEqual(tilstande(s.document), IDER.map(() => 'ukendt'));
  assert.equal(tekst(s.document, 'p.st-banner'), 'We cannot measure right now.');
});

test('DOM: a page left open flips to unknown when the clock passes the limit (even with the tab hidden and nothing fetched) or a request fails', async () => {
  const nu = Date.now();
  let svar: () => Promise<Svar> = ok(feed({ opdateret: new Date(nu - 1_000).toISOString() }));
  const s = koer({ fetch: () => svar(), nu });
  await s.vent();
  assert.equal(tekst(s.document, 'p.st-banner'), 'Everything is working.');
  const tick = s.intervaller[0]!.fn;
  // A hidden tab fetches nothing, but still re-judges what it has against the clock.
  Object.defineProperty(s.document, 'visibilityState', { value: 'hidden', configurable: true });
  s.klok.nu = nu + 4 * 60_000;
  tick();
  await s.vent();
  assert.equal(s.kald.length, 1, 'no request from a hidden tab');
  assert.equal(tekst(s.document, 'p.st-banner'), 'Everything is working.', '4 minutes after the feed is still fresh');
  s.klok.nu = nu + 6 * 60_000;
  tick();
  await s.vent();
  assert.equal(s.kald.length, 1);
  assert.deepEqual(tilstande(s.document), IDER.map(() => 'ukendt'));
  assert.equal(tekst(s.document, 'p.st-banner'), 'We cannot measure right now.');
  // Visible again: it fetches, and a good answer brings the page back.
  Object.defineProperty(s.document, 'visibilityState', { value: 'visible', configurable: true });
  svar = ok(feed({ opdateret: new Date(nu + 6 * 60_000 - 500).toISOString() }));
  tick();
  await s.vent();
  assert.equal(s.kald.length, 2);
  assert.equal(tekst(s.document, 'p.st-banner'), 'Everything is working.');
  // A failing request on a tick flips the page to unknown, and nothing of the earlier state is left on screen.
  svar = async () => { throw new TypeError('offline'); };
  tick();
  await s.vent();
  assert.deepEqual(tilstande(s.document), IDER.map(() => 'ukendt'));
  assert.equal(tekst(s.document, 'p.st-banner'), 'We cannot measure right now.');
  assert.equal(s.document.querySelectorAll('.st-dage > li').length, 0);
  assert.equal(s.document.querySelectorAll('.st-haendelser > li').length, 0);
});

// --- headers and styling -------------------------------------------------------------------------------------------

test('_headers: the site-wide CSP names no host; /status re-sets it with connect-src for konto.clawco.work and nothing else added', () => {
  const h = laes('site/_headers');
  const blokke = h.split(/\n\s*\n/);
  const alle = blokke.find((b) => b.startsWith('/*'))!;
  const status = blokke.find((b) => b.startsWith('/status\n'))!;
  assert.ok(status, 'a /status block');
  const base = /Content-Security-Policy: (.*)/.exec(alle)![1]!;
  assert.ok(!/https?:/.test(base), 'the site-wide CSP names no host');
  assert.ok(!base.includes('connect-src'));
  const linjer = status.split('\n').slice(1).map((l) => l.trim());
  assert.equal(linjer[0], '! Content-Security-Policy', 'detach the site-wide header first');
  const egen = /^Content-Security-Policy: (.*)$/.exec(linjer[1]!)![1]!;
  assert.deepEqual(egen.match(/https?:\/\/[^\s;]+/g), ['https://konto.clawco.work']);
  assert.match(egen, /connect-src https:\/\/konto\.clawco\.work(;|$)/);
  assert.equal(egen.replace(' connect-src https://konto.clawco.work;', ''), base, 'identical to the site-wide policy otherwise');
  assert.equal(linjer.length, 2);
});

test('site.css: the strip fits 90 bars on a phone, and every state is told apart by shape as well as colour', () => {
  const css = laes('site/site.css');
  assert.match(css, /\.st-dage\s*\{[^}]*display:\s*flex[^}]*gap:\s*1px/);
  assert.match(css, /\.st-dage > li\s*\{[^}]*min-width:\s*2px/);
  const form = (s: string) => new RegExp(`\\.st-dage > li\\[data-state="${s}"\\]\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const hoejde = (s: string) => /height:\s*(\d+)%/.exec(form(s))?.[1];
  assert.equal(hoejde('ok'), '100');
  assert.ok(Number(hoejde('nedsat')) < 100 && Number(hoejde('nede')) < Number(hoejde('nedsat')), 'degraded and down bars are shorter');
  assert.match(form('ukendt'), /border:\s*1px solid/, 'unknown is outlined, not filled');
  assert.match(form('ukendt'), /background:\s*transparent/);
  for (const s of ['ok', 'nedsat', 'nede', 'ukendt']) assert.match(css, new RegExp(`\\.st-status\\[data-state="${s}"\\]`));
  assert.ok(!/@media[^{]*prefers-color-scheme:\s*light/.test(css), 'dark only');
});
