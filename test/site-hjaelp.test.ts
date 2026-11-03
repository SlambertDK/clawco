import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

// KC-0201: the help pages, the security report page and security.txt (site/). Read as files; nothing needs a server.
// Invariants (ticket): (1) the help flow never asks for or transmits tenant content, passwords, passkeys, card details
// or API keys, and every article says so; (2) the response time is one sentence from one table key, built from
// config/hjaelp.json; (3) every claim in an article is true of the build it describes: the steps are checked against
// the routes in the code, the button labels against the account app's own texts, the numbers against the constants
// behind them, and the claims about what is NOT built are guarded by tests that fail when someone builds it.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const SITE = path.join(ROD, 'site');
const laes = (rel: string): string => readFileSync(path.join(ROD, rel), 'utf8');
const flad = (s: string): string => s.replace(/\s+/g, ' ').trim();
const dok = (rel: string) => parseHTML(readFileSync(path.join(SITE, rel), 'utf8')).document;

const HJAELP = JSON.parse(laes('config/hjaelp.json')) as { postkasse: string; svarHverdage: number; sikkerhedSvarHverdage: number };
const PRISER = JSON.parse(laes('config/priser.json')) as { proeve: { dage: number; kort: boolean } };

const ARTIKLER = ['new-device', 'trial', 'plan-or-cancel', 'payment-failed', 'get-your-data', 'delete-account', 'let-support-look', 'first-source'] as const;
const INDEKS = 'hjaelp.html';
const SIKKERHED = 'hjaelp/security-report.html';
const HJAELPESIDER = [INDEKS, SIKKERHED, ...ARTIKLER.map((a) => `hjaelp/${a}.html`)];

type Tabel = { en: Record<string, string>; da: Record<string, string> };
function laesTabel(): Tabel {
  const ctx: { globalThis?: unknown; CLAWCO_TEXT?: Tabel } = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(path.join(SITE, 'strings.js'), 'utf8'), ctx);
  return ctx.CLAWCO_TEXT!;
}
const T = laesTabel();

/** Sentences the config decides; the Sky builder (sky/src/konto/hjaelp.ts) writes the same ones (its own test pins them). */
const svarEn = (n: number) => `We answer within ${n} working ${n === 1 ? 'day' : 'days'}.`;
const svarDa = (n: number) => `Vi svarer inden for ${n} hverdage.`;

test('the help pages exist: the index, eight articles and the security report, all in the sitemap', () => {
  const sitemap = laes('site/sitemap.xml');
  for (const p of HJAELPESIDER) {
    assert.ok(existsSync(path.join(SITE, p)), `missing ${p}`);
    const canon = dok(p).querySelector('link[rel="canonical"]')!.getAttribute('href')!;
    assert.equal(canon, `https://clawco.work/${p.replace(/\.html$/, '')}`);
    assert.ok(sitemap.includes(`<loc>${canon}</loc>`), `${canon} is not in the sitemap`);
  }
  assert.equal(readdirSync(path.join(SITE, 'hjaelp')).filter((f) => f.endsWith('.html')).length, ARTIKLER.length + 1, 'no stray article');
});

test('the index links every article and the security report; every article links back to the index', () => {
  const d = dok(INDEKS);
  for (const a of ARTIKLER) assert.ok(d.querySelector(`a[href="/hjaelp/${a}"]`), `index does not link ${a}`);
  assert.ok(d.querySelector('a[href="/hjaelp/security-report"]'), 'index does not link the security report');
  for (const a of ARTIKLER) assert.ok(dok(`hjaelp/${a}.html`).querySelector('main a[href="/hjaelp"]'), `${a} has no way back`);
  assert.ok(dok(SIKKERHED).querySelector('main a[href="/hjaelp"]'));
});

test('every page of the site links the help index from its footer (like the legal overview), with a key in both languages', () => {
  const sider: string[] = [];
  const gaa = (rel: string) => {
    for (const e of readdirSync(path.join(SITE, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) gaa(r); else if (e.name.endsWith('.html')) sider.push(r);
    }
  };
  gaa('');
  assert.ok(sider.length >= 6 + HJAELPESIDER.length);
  for (const s of sider) {
    const a = dok(s).querySelector('footer a[href="/hjaelp"]');
    assert.ok(a, `${s}: no footer link to /hjaelp`);
    assert.equal(a.getAttribute('data-i'), 'c.nav.help', s);
  }
  assert.equal(T.en['c.nav.help'], 'Help');
  assert.equal(T.da['c.nav.help'], 'Hjælp');
});

test('no form, no input, no script but the site\'s own, no third-party reference, no cookie on any help page', () => {
  for (const p of HJAELPESIDER) {
    const d = dok(p);
    assert.equal(d.querySelectorAll('form,input,textarea,select,iframe,object,embed,button:not([data-lang-toggle])').length, 0, `${p}: form or control`);
    for (const s of Array.from(d.querySelectorAll('script'))) assert.match(s.getAttribute('src') ?? '', /^\/(strings|site)\.js$/, `${p}: script`);
    for (const el of Array.from(d.querySelectorAll('[src],[href]'))) {
      const v = el.getAttribute('src') ?? el.getAttribute('href')!;
      if (v.startsWith('mailto:')) { assert.equal(v, `mailto:${HJAELP.postkasse}`, `${p}: only the one mailbox`); continue; }
      assert.ok(!/^(https?:)?\/\//.test(v) || /^https:\/\/clawco\.work\//.test(v) || (v === 'https://github.com/SlambertDK/clawco' && el.closest('footer')), `${p}: external reference ${v}`);
    }
  }
});

test('there is one mailbox: every address on the site is config/hjaelp.json\'s, and the page says so in the table', () => {
  assert.equal(HJAELP.postkasse, 'kontakt@clawco.work');
  assert.equal(T.en['help.mail'], HJAELP.postkasse);
  assert.equal(T.da['help.mail'], HJAELP.postkasse);
  const alt = [laes('site/strings.js'), ...HJAELPESIDER.map((p) => laes(`site/${p}`)), laes('site/.well-known/security.txt')].join('\n');
  const adresser = [...alt.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)].map((m) => m[0]);
  assert.ok(adresser.length >= 5, 'the scan found the address');
  for (const a of adresser) assert.equal(a, HJAELP.postkasse, `another address: ${a}`);
  for (const p of [INDEKS, SIKKERHED, ...ARTIKLER.map((a) => `hjaelp/${a}.html`)]) {
    assert.ok(dok(p).querySelector(`a[href="mailto:${HJAELP.postkasse}"][data-i="help.mail"]`), `${p}: no mail link from the one key`);
  }
});

test('the response time is one sentence from one key, built from config/hjaelp.json (invariant 2)', () => {
  assert.equal(T.en['help.reply.time'], svarEn(HJAELP.svarHverdage));
  assert.equal(T.da['help.reply.time'], svarDa(HJAELP.svarHverdage));
  assert.equal(T.en['sec.report.time'], svarEn(HJAELP.sikkerhedSvarHverdage));
  assert.equal(T.da['sec.report.time'], svarDa(HJAELP.sikkerhedSvarHverdage));
  // No other key promises a time: a second wording would drift from the first.
  for (const [k, v] of Object.entries(T.en)) if (/\bwe answer\b|working days?/i.test(v)) assert.ok(['help.reply.time', 'sec.report.time'].includes(k), `${k} states a response time`);
  for (const [k, v] of Object.entries(T.da)) if (/\bvi svarer\b|hverdag/i.test(v)) assert.ok(['help.reply.time', 'sec.report.time'].includes(k), `${k} states a response time`);
  for (const p of [INDEKS, ...ARTIKLER.map((a) => `hjaelp/${a}.html`)]) assert.ok(dok(p).querySelector('[data-i="help.reply.time"]'), `${p} states the response time`);
  assert.ok(dok(SIKKERHED).querySelector('[data-i="sec.report.time"]'));
});

test('invariant 1: every article and the index say "never send us a model key, a password, a passkey or card details"', () => {
  assert.match(T.en['help.never']!, /Never send us your model key/);
  assert.match(T.da['help.never']!, /Send os aldrig din modelnøgle/);
  for (const k of ['password', 'passkey', 'card'] as const) assert.match(T.en['help.never']!, new RegExp(k));
  for (const p of [INDEKS, SIKKERHED, ...ARTIKLER.map((a) => `hjaelp/${a}.html`)]) assert.ok(dok(p).querySelector('[data-i="help.never"]'), `${p} lacks the sentence`);
});

test('the index holds no search box and no chat widget; it explains what "Få hjælp" carries and that nothing from inside a Clawco does', () => {
  const d = dok(INDEKS);
  assert.equal(d.querySelectorAll('input,form,[role="search"],[type="search"]').length, 0);
  const en = T.en['help.faa']!;
  for (const ord of ['account number', 'plan', 'versions', 'last error code', 'Nothing from inside your Clawco']) assert.ok(en.includes(ord), `English: ${ord}`);
  assert.ok(T.da['help.faa']!.includes('Der kommer aldrig noget fra inde i din Clawco med'));
});

test('articles are short: each is under 400 words in English', () => {
  for (const a of ARTIKLER) {
    const ord = flad(Array.from(dok(`hjaelp/${a}.html`).querySelectorAll('main [data-i]')).map((e) => e.textContent ?? '').join(' ')).split(' ').length;
    assert.ok(ord < 400, `${a} has ${ord} words`);
    assert.ok(ord > 60, `${a} has only ${ord} words`);
  }
});

// --- invariant 3: the steps against the code ------------------------------------------------------------------

function kodefiler(dir: string): string[] {
  const ud: string[] = [];
  for (const e of readdirSync(path.join(ROD, dir), { withFileTypes: true })) {
    const r = `${dir}/${e.name}`;
    if (e.name === 'node_modules') continue;
    if (e.isDirectory()) ud.push(...kodefiler(r)); else if (e.name.endsWith('.ts')) ud.push(r);
  }
  return ud;
}
const SKY_FILER = kodefiler('sky/src');
const KLIENT_FILER = kodefiler('src');

function ruter(filer: string[]): { metode: string; moenster: RegExp; raa: string }[] {
  const ud: { metode: string; moenster: RegExp; raa: string }[] = [];
  for (const f of filer) {
    for (const m of laes(f).matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'(\/[^']*)'/g)) {
      const raa = m[2]!;
      ud.push({ metode: m[1]!.toUpperCase(), raa, moenster: new RegExp(`^${raa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]+/g, '[^/]+')}$`) });
    }
  }
  return ud;
}
const SKY_RUTER = ruter(SKY_FILER);
const KLIENT_RUTER = ruter(KLIENT_FILER);

test('the route scan sees the account app and the Clawco app', () => {
  assert.ok(SKY_RUTER.length > 30, `${SKY_RUTER.length} Sky routes`);
  assert.ok(SKY_RUTER.some((r) => r.metode === 'POST' && r.raa === '/konto/slet'));
  assert.ok(KLIENT_RUTER.some((r) => r.metode === 'GET' && r.raa === '/rum/:id'));
});

test('every step that names a route (data-route) names one the code serves; rename a route and this fails', () => {
  let antal = 0;
  for (const a of ARTIKLER) {
    for (const el of Array.from(dok(`hjaelp/${a}.html`).querySelectorAll('[data-route]'))) {
      const [metode, sti] = el.getAttribute('data-route')!.split(' ') as [string, string];
      const tabel = el.getAttribute('data-app') === 'klient' ? KLIENT_RUTER : SKY_RUTER;
      assert.ok(tabel.some((r) => r.metode === metode && r.moenster.test(sti)), `${a}: no route ${metode} ${sti} in ${el.getAttribute('data-app') ?? 'sky'}`);
      antal++;
    }
  }
  assert.ok(antal >= 20, `only ${antal} routed steps in the articles`);
  for (const a of ['new-device', 'trial', 'plan-or-cancel', 'payment-failed', 'get-your-data', 'delete-account', 'first-source'] as const) {
    assert.ok(dok(`hjaelp/${a}.html`).querySelectorAll('[data-route]').length >= 1, `${a} names no route`);
  }
});

test('every button label an article quotes (data-etiket) is in the code and in both language texts', () => {
  const kode = [...SKY_FILER, ...KLIENT_FILER].map(laes).join('\n');
  let antal = 0;
  for (const a of ARTIKLER) {
    for (const el of Array.from(dok(`hjaelp/${a}.html`).querySelectorAll('[data-etiket]'))) {
      const etiket = el.getAttribute('data-etiket')!;
      assert.ok(kode.includes(etiket), `${a}: "${etiket}" is not in the code (a renamed button?)`);
      const k = el.getAttribute('data-i')!;
      assert.ok(T.en[k]!.includes(`“${etiket}`) || T.en[k]!.includes(etiket), `${a}/${k}: English does not quote it`);
      assert.ok(T.da[k]!.includes(etiket), `${a}/${k}: Danish does not quote it`);
      antal++;
    }
  }
  assert.ok(antal >= 18, `only ${antal} quoted labels`);
  // KC-0188: let-support-look quotes the switch and its Slå fra as they are built (the owner's card and the red band).
  assert.ok(dok('hjaelp/let-support-look.html').querySelector('[data-etiket="Lad support se med"]') && dok('hjaelp/let-support-look.html').querySelector('[data-etiket="Slå fra"]'));
});

test('every number in an article is the constant behind it', () => {
  const tal = (fil: string, re: RegExp): number => Number(re.exec(laes(fil))?.[1]);
  const hent = (a: string, sprog: 'en' | 'da') => Array.from(dok(`hjaelp/${a}.html`).querySelectorAll('main [data-i]')).map((e) => T[sprog][e.getAttribute('data-i')!]).join(' ');
  const link = tal('sky/src/konto/maillink.ts', /LINK_MS = (\d+) \* 60_000/);
  const frisk = tal('sky/src/konto/session.ts', /FRISK_MS = (\d+) \* 60_000/);
  const eksport = tal('sky/src/konto/eksport.ts', /EKSPORT_MS = (\d+) \* 3_600_000/);
  const kopier = tal('sky/src/konto/beholdt.ts', /KOPIER_DAGE = (\d+)/);
  const regnskab = tal('sky/src/konto/beholdt.ts', /opbevares i (\d+) år/);
  assert.deepEqual([link, frisk, eksport, kopier, regnskab, PRISER.proeve.dage], [15, 5, 24, 30, 5, 14], 'a constant changed: update the articles');
  assert.ok(hent('new-device', 'en').includes(`${link} minutes`) && hent('new-device', 'da').includes(`${link} minutter`));
  for (const a of ['new-device', 'get-your-data', 'delete-account']) assert.ok(hent(a, 'en').includes(`${frisk} minutes`) && hent(a, 'da').includes(`${frisk} minutter`), `${a}: fresh sign-in`);
  assert.ok(hent('get-your-data', 'en').includes(`${eksport} hours`) && hent('get-your-data', 'da').includes(`${eksport} timer`));
  assert.ok(hent('delete-account', 'en').includes(`${kopier} days`) && hent('delete-account', 'da').includes(`${kopier} dage`));
  assert.ok(hent('delete-account', 'en').includes(`${regnskab} years`) && hent('delete-account', 'da').includes(`${regnskab} år`));
  assert.ok(hent('trial', 'en').includes(`${PRISER.proeve.dage} days`) && hent('trial', 'da').includes(`${PRISER.proeve.dage} dage`));
  assert.equal(PRISER.proeve.kort, false, 'the trial article says no card is asked for');
});

test('the checkout asks for no card on a trial and pauses (never charges) when the trial ends without one', () => {
  const k = laes('sky/src/abonnement/checkout.ts');
  assert.match(k, /payment_method_collection: proeve && !priser\.proeve\.kort \? 'if_required' : 'always'/);
  assert.match(k, /missing_payment_method: 'pause'/);
});

test('claims about what is NOT built are guarded: building it fails the test until the article is rewritten', () => {
  const alle = [...SKY_FILER, ...KLIENT_FILER];
  // let-support-look (KC-0188): what the article says about the built switch is what the code holds — 1, 4 or 24 hours in both
  // halves (the tenant's card and Sky's grant), off until the owner turns it on, read-only, and every look logged.
  for (const f of ['src/identitet/stoette.ts', 'sky/src/konto/stoette.ts']) {
    assert.match(laes(f), /export const STOETTE_TIMER = \[1, 4, 24\] as const;/, f);
    assert.match(laes(f), /export const STOETTE_MAKS_TIMER = 24;/, f);
  }
  const stoetteTekst = (sprog: 'en' | 'da') => Array.from(dok('hjaelp/let-support-look.html').querySelectorAll('main [data-i]')).map((e) => T[sprog][e.getAttribute('data-i')!]).join(' ');
  assert.ok(stoetteTekst('en').includes('1, 4 or 24 hours') && stoetteTekst('da').includes('1, 4 eller 24 timer'));
  assert.match(laes('src/identitet/roller.ts'), /stoette: \['laese', 'se-husstand'\]/, 'support reads only: the article says it cannot change anything');
  assert.ok(alle.includes('src/identitet/stoette.ts') && alle.includes('sky/src/gateway/stoette-vej.ts'));
  // trial, payment-failed: nothing switches a Clawco off or locks it for a paused, overdue or cancelled subscription.
  // `skrivebeskyttet` is computed and stored by billing and shown nowhere else; if the gateway, the fleet or the Clawco app
  // starts to act on it, the articles "trial" and "payment-failed" must say what it does.
  const bruger = alle.filter((f) => /skrivebeskyttet/.test(laes(f))).filter((f) => !f.startsWith('sky/src/abonnement/') && f !== 'sky/src/konto/hjaelp.ts'
    && !(f === 'sky/src/server.ts' && laes(f).match(/^.*skrivebeskyttet.*$/gm)!.length === 1)); // server.ts: the one line that hands it to the "Få hjælp" mail
  assert.deepEqual(bruger, [], 'something now acts on skrivebeskyttet: update the articles marked data-gaelder="ingen-haandhaevelse"');
  assert.ok(!/skrivebeskyttet/.test(KLIENT_FILER.map(laes).join('\n')), 'the Clawco app knows nothing of a read-only state yet');
  for (const a of ['trial', 'payment-failed']) assert.ok(dok(`hjaelp/${a}.html`).querySelector('[data-gaelder="ingen-haandhaevelse"]'), `${a} carries the guarded claim`);
  assert.ok(dok('hjaelp/let-support-look.html').querySelector('[data-gaelder="stoette"]'));
  // get-your-data: no importer for clawco.zip in a self-installed Clawco.
  assert.ok(!/clawco\.zip/.test(KLIENT_FILER.map(laes).join('\n')) || KLIENT_FILER.filter((f) => /clawco\.zip/.test(laes(f))).every((f) => !/import|laes.*zip|pak/i.test(f)), 'an importer for clawco.zip may exist now: update get-your-data');
  assert.ok(dok('hjaelp/get-your-data.html').querySelector('[data-gaelder="ingen-import"]'));
});

test('the articles never promise a time or a feature the code does not hold: no "within … hours", no "we will tell you", no auto-reply', () => {
  const alt = Object.entries(T.en).filter(([k]) => k.startsWith('help.') || k.startsWith('sec.report')).map(([, v]) => v).join('\n');
  assert.ok(!/auto-?repl|automatic reply|within \d+ hours?|immediately|24\/7/i.test(alt));
  assert.ok(!/we will (tell|write|notify|warn) you/i.test(alt));
});

// --- the security report page and security.txt ----------------------------------------------------------------

test('the security report page: one mailbox, the answer time, how to test, no legal promise (the owner decides that, KC-0201), and the four things out of scope', () => {
  const d = dok(SIKKERHED);
  assert.equal(flad(d.querySelector('h1')!.textContent ?? ''), 'Report a security problem');
  assert.equal(T.da['sec.report.h1'], 'Rapportér en sikkerhedsfejl');
  assert.ok(d.querySelector('[data-i="sec.report.time"]'));
  for (const t of [T.en['sec.report.promise']!, T.da['sec.report.promise']!, T.en['sec.report.meta.description']!, T.da['sec.report.meta.description']!]) {
    assert.ok(!/legal action|good faith|good-faith|retslige skridt|rettens vej|god tro/i.test(t), `no legal promise: ${t}`);
  }
  assert.match(T.en['sec.report.promise']!, /stay within scope/);
  assert.match(T.da['sec.report.promise']!, /inden for det, der er med/);
  const udenfor = Array.from(d.querySelectorAll('#out-of-scope li')).map((li) => li.getAttribute('data-i')!);
  assert.equal(udenfor.length, 4);
  const en = udenfor.map((k) => T.en[k]).join(' ');
  for (const ord of [/denial of service/i, /social engineering/i, /physical access/i, /services run by others/i]) assert.match(en, ord);
  const da = udenfor.map((k) => T.da[k]).join(' ');
  for (const ord of [/overbelast|denial of service/i, /social engineering/i, /fysisk adgang/i, /andres tjenester|tjenester, andre driver/i]) assert.match(da, ord);
  assert.ok(d.querySelector('a[href="/.well-known/security.txt"]'));
});

const SEC = laes('site/.well-known/security.txt');
const felter = (n: string): string[] => SEC.split(/\r?\n/).filter((l) => l.toLowerCase().startsWith(`${n.toLowerCase()}:`)).map((l) => l.slice(n.length + 1).trim());

test('security.txt follows RFC 9116: Contact, Expires, Preferred-Languages, Policy, Canonical, nothing else', () => {
  assert.deepEqual(felter('Contact'), [`mailto:${HJAELP.postkasse}`]);
  assert.deepEqual(felter('Preferred-Languages'), ['da, en']);
  assert.deepEqual(felter('Policy'), ['https://clawco.work/hjaelp/security-report']);
  assert.deepEqual(felter('Canonical'), ['https://clawco.work/.well-known/security.txt']);
  assert.equal(felter('Expires').length, 1);
  const kendte = new Set(['contact', 'expires', 'preferred-languages', 'policy', 'canonical']);
  for (const l of SEC.split(/\r?\n/)) if (l.trim() && !l.startsWith('#')) assert.ok(kendte.has(l.slice(0, l.indexOf(':')).toLowerCase()), `unexpected line: ${l}`);
  assert.ok(SEC.endsWith('\n'));
  assert.equal(new URL(felter('Policy')[0]!).pathname, '/hjaelp/security-report');
  assert.ok(existsSync(path.join(SITE, 'hjaelp/security-report.html')), 'the policy page exists');
});

test('security.txt Expires is an ISO date at most a year ahead, and not within 30 days of lapsing (the test is the reminder)', () => {
  const e = felter('Expires')[0]!;
  assert.match(e, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  const udloeb = new Date(e).getTime();
  const nu = Date.now();
  const dag = 86_400_000;
  assert.ok(udloeb - nu <= 366 * dag, `Expires is more than a year ahead: ${e}`);
  assert.ok(udloeb - nu > 30 * dag, `security.txt expires ${e}: renew it (move Expires out, at most a year ahead) and redeploy the site`);
});

test('the security report page is the policy: its promise time is the config\'s and the page is in both languages', () => {
  assert.equal(T.en['sec.report.time'], svarEn(HJAELP.sikkerhedSvarHverdage));
  assert.equal(HJAELP.sikkerhedSvarHverdage, 5);
});

test('_headers serves security.txt as plain text', () => {
  const h = laes('site/_headers');
  assert.match(h, /\/\.well-known\/security\.txt\n\s+Content-Type: text\/plain; charset=utf-8/);
});

// --- the language toggle and the build --------------------------------------------------------------------------

function koer(side: string, search: string): Document {
  const { document, window } = parseHTML(readFileSync(path.join(SITE, side), 'utf8'));
  const lager = new Map<string, string>();
  const ctx: Record<string, unknown> = {
    document, window, setTimeout, clearTimeout, console, URLSearchParams,
    localStorage: { getItem: (k: string) => lager.get(k) ?? null, setItem: (k: string, v: string) => void lager.set(k, v) },
    navigator: {}, location: { search, pathname: '/' + side.replace(/\.html$/, ''), hash: '' }, history: { replaceState() {} },
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(path.join(SITE, 'strings.js'), 'utf8'), ctx);
  vm.runInNewContext(readFileSync(path.join(SITE, 'site.js'), 'utf8'), ctx);
  return document;
}

test('?lang=da shows the help pages in Danish and keeps the mail link and the links between pages', () => {
  for (const p of HJAELPESIDER) {
    const en = koer(p, '');
    const da = koer(p, '?lang=da');
    assert.equal(da.documentElement.getAttribute('lang'), 'da', p);
    assert.notEqual(flad(da.querySelector('h1')!.textContent ?? ''), flad(en.querySelector('h1')!.textContent ?? ''), `${p}: h1 not translated`);
    assert.equal(da.querySelector(`a[href="mailto:${HJAELP.postkasse}"]`)!.textContent, HJAELP.postkasse);
    assert.match(da.querySelector('footer a[data-i="c.nav.help"]')!.getAttribute('href')!, /\/hjaelp\?lang=da$/);
    assert.equal(flad(da.querySelector('footer a[data-i="c.nav.help"]')!.textContent ?? ''), 'Hjælp');
  }
  assert.match(koer(INDEKS, '?lang=da').querySelector('a[href^="/hjaelp/new-device"]')!.getAttribute('href')!, /\?lang=da$/);
});

test('site-byg: the help pages, security.txt (a dot folder) and the headers reach the output byte-identically (image URLs versioned)', () => {
  const ud = mkdtempSync(path.join(tmpdir(), 'clawco-hjaelp-'));
  try {
    execFileSync('node', [path.join(ROD, 'scripts/site-byg.mjs'), '--ud', ud], { encoding: 'utf8' });
    for (const p of HJAELPESIDER) {
      assert.ok(existsSync(path.join(ud, p)), `${p} not built`);
      // KC-0244: the build's one transform versions image URLs (?v=<content hash>); everything else is the source.
      assert.equal(readFileSync(path.join(ud, p), 'utf8').replace(/(\/billeder\/[A-Za-z0-9._-]+)\?v=[0-9a-f]{12}/g, '$1'), readFileSync(path.join(SITE, p), 'utf8'));
    }
    assert.ok(existsSync(path.join(ud, '.well-known/security.txt')), '.well-known/security.txt was dropped from the output');
    assert.equal(readFileSync(path.join(ud, '.well-known/security.txt'), 'utf8'), SEC);
    assert.match(readFileSync(path.join(ud, '_headers'), 'utf8'), /security\.txt/);
  } finally { rmSync(ud, { recursive: true, force: true }); }
});

test('the public mirror list publishes site/ as a whole, so the help pages and security.txt travel with it', () => {
  assert.ok(laes('scripts/offentlig.txt').split('\n').includes('site'));
});
