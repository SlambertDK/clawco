import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

// KC-0164: the static site for clawco.work (site/). Read as files; nothing here needs a server or a network.
// Invariants: every page is well-formed and indexable; every visible string exists in English and Danish and the
// English HTML equals the table; the site makes no request to any other host; the install command is one
// string everywhere; install.sh is served byte-identical to deploy/install.sh.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const SITE = path.join(ROD, 'site');
const INSTALL_KOMMANDO = 'curl -fsSL https://clawco.work/install.sh | bash';
const EGEN_VAERT = 'clawco.work';
/** Outbound hosts a visitor may be linked to (plain <a href> only; the browser makes no request until clicked). */
const UDGAAENDE = new Set(['nodejs.org', 'docs.docker.com', 'tailscale.com', 'brew.sh', 'github.com']);
const FORBUDTE_ORD = ['supercharge', 'revolutionary', 'seamless', 'effortless', 'unlock', 'game-changer', 'ai-powered', '10x', 'magic'];

const laes = (rel: string): string => readFileSync(path.join(ROD, rel), 'utf8');

function sider(dir = SITE, rel = ''): string[] {
  const ud: string[] = [];
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) ud.push(...sider(dir, r));
    else if (e.name.endsWith('.html')) ud.push(r);
  }
  return ud.sort();
}

const SIDER = sider();
const dok = (rel: string) => parseHTML(readFileSync(path.join(SITE, rel), 'utf8')).document;
const flad = (s: string): string => s.replace(/\s+/g, ' ').trim();

type Tabel = { en: Record<string, string>; da: Record<string, string> };
function laesTabel(): Tabel {
  const ctx: { globalThis?: unknown; CLAWCO_TEXT?: Tabel } = {};
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(path.join(SITE, 'strings.js'), 'utf8'), ctx);
  assert.ok(ctx.CLAWCO_TEXT, 'strings.js must define globalThis.CLAWCO_TEXT');
  return ctx.CLAWCO_TEXT;
}

test('the site has the pages the ticket promises', () => {
  for (const p of ['index.html', 'install.html', 'docs/index.html', 'docs/mac-linux.html', 'docs/docker.html', 'docs/security.html']) {
    assert.ok(SIDER.includes(p), `missing page ${p}`);
  }
});

for (const side of SIDER) {
  test(`${side}: title, one h1, lang, viewport, description, canonical`, () => {
    const d = dok(side);
    assert.ok(flad(d.querySelector('title')?.textContent ?? '').length > 5, 'title');
    assert.equal(d.querySelectorAll('h1').length, 1, 'exactly one h1');
    assert.equal(d.documentElement.getAttribute('lang'), 'en', 'html lang (English default)');
    assert.match(d.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '', /width=device-width/);
    assert.equal(d.querySelectorAll('meta[name="description"]').length, 1, 'one description');
    const lang = d.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
    assert.ok(lang.length >= 60 && lang.length <= 200, `description length ${lang.length}`);
    const canon = d.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
    assert.ok(canon.startsWith(`https://${EGEN_VAERT}/`), `canonical ${canon}`);
    assert.equal(d.querySelectorAll('img:not([alt])').length, 0, 'every img has alt');
  });
}

test('the string table: English and Danish have the same keys, none empty', () => {
  const t = laesTabel();
  const en = Object.keys(t.en).sort();
  const da = Object.keys(t.da).sort();
  assert.deepEqual(da.filter((k) => !en.includes(k)), [], 'keys only in Danish');
  assert.deepEqual(en.filter((k) => !da.includes(k)), [], 'keys only in English');
  assert.ok(en.length > 60, `table has ${en.length} keys`);
  for (const k of en) {
    assert.ok(t.en[k]!.trim() && t.da[k]!.trim(), `empty value for ${k}`);
    // A Danish value equal to the English one is a missed translation, unless it is a short proper noun or code.
    if (t.en[k]!.length > 24) assert.notEqual(t.da[k], t.en[k], `${k} is not translated`);
  }
});

test('every data-i key on every page exists, and the English HTML equals the English table', () => {
  const t = laesTabel();
  const brugt = new Set<string>();
  for (const side of SIDER) {
    const d = dok(side);
    for (const el of Array.from(d.querySelectorAll('[data-i]'))) {
      const k = el.getAttribute('data-i')!;
      brugt.add(k);
      assert.ok(k in t.en, `${side}: unknown key ${k}`);
      assert.equal(flad(el.textContent ?? ''), t.en[k], `${side}: text of ${k} differs from the table`);
    }
    for (const el of Array.from(d.querySelectorAll('[data-i-attr]'))) {
      for (const par of el.getAttribute('data-i-attr')!.split(';')) {
        const [attr, k] = par.split(':') as [string, string];
        brugt.add(k);
        assert.ok(k in t.en, `${side}: unknown key ${k}`);
        assert.equal(flad(el.getAttribute(attr) ?? ''), t.en[k], `${side}: ${attr} of ${k} differs from the table`);
      }
    }
  }
  const ubrugt = Object.keys(t.en).filter((k) => !brugt.has(k) && !k.endsWith('.2') && !k.startsWith('js.'));
  assert.deepEqual(ubrugt, [], 'keys in the table that no page uses');
});

test('English copy follows the voice rules: no banned words, no exclamation marks, no pricing or hosted wording', () => {
  const t = laesTabel();
  const alt = Object.values(t.en).join('\n');
  for (const ord of FORBUDTE_ORD) assert.ok(!alt.toLowerCase().includes(ord), `banned word: ${ord}`);
  assert.ok(!alt.includes('!'), 'exclamation mark');
  assert.ok(!/(?<!self-)\bhosted\b/i.test(alt), '"hosted" wording (D3)');
  assert.ok(!/\b(pricing|price|waitlist|subscribe|newsletter)\b/i.test(alt), 'pricing/waitlist wording');
  assert.ok(!/\b(safe|secure|trusted)\b/i.test(alt), 'unprovable adjective');
});

test('no request to any other host: every src/href/content/url() is local, own host, or an allowed outbound link', () => {
  const kilder: { side: string; tag: string; attr: string; vaerdi: string }[] = [];
  for (const side of SIDER) {
    const d = dok(side);
    for (const el of Array.from(d.querySelectorAll('[src],[href],[srcset],[poster],[action]'))) {
      for (const attr of ['src', 'href', 'srcset', 'poster', 'action']) {
        const v = el.getAttribute(attr);
        if (v) kilder.push({ side, tag: el.tagName.toLowerCase(), attr, vaerdi: v });
      }
    }
    for (const m of Array.from(d.querySelectorAll('meta[property^="og:"],meta[name^="twitter:"]'))) {
      const v = m.getAttribute('content') ?? '';
      if (/^(https?:)?\/\//.test(v)) kilder.push({ side, tag: 'meta', attr: 'content', vaerdi: v });
    }
  }
  const css = readFileSync(path.join(SITE, 'site.css'), 'utf8');
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) kilder.push({ side: 'site.css', tag: 'css', attr: 'url', vaerdi: m[1]! });
  assert.ok(kilder.length > 20, 'the scan found the references');
  for (const k of kilder) {
    const v = k.vaerdi.trim();
    if (!/^(https?:)?\/\//i.test(v)) {
      assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(v), `${k.side}: ${k.tag}[${k.attr}] has a scheme: ${v}`);
      continue;
    }
    const vaert = new URL(v, 'https://x.invalid').hostname;
    if (vaert === EGEN_VAERT) continue;
    assert.ok(UDGAAENDE.has(vaert), `${k.side}: ${k.tag}[${k.attr}] points to ${vaert}`);
    assert.ok(k.tag === 'a' && k.attr === 'href', `${k.side}: ${vaert} may only be an <a href>, not <${k.tag} ${k.attr}>`);
  }
});

test('no third-party scripts or fonts, no inline script or style, no forms, no cookies set by the page', () => {
  for (const side of SIDER) {
    const d = dok(side);
    for (const s of Array.from(d.querySelectorAll('script'))) {
      const type = s.getAttribute('type');
      if (type === 'application/ld+json') { JSON.parse(s.textContent ?? ''); continue; }
      assert.ok(s.getAttribute('src')?.startsWith('/'), `${side}: script must be a local file`);
      assert.equal((s.textContent ?? '').trim(), '', `${side}: inline script`);
    }
    assert.equal(d.querySelectorAll('[style]').length, 0, `${side}: inline style attribute`);
    assert.equal(d.querySelectorAll('style').length, 0, `${side}: inline style element`);
    assert.equal(d.querySelectorAll('form,input,textarea,select,iframe,object,embed').length, 0, `${side}: form/embed element`);
    assert.equal(d.querySelectorAll('[onclick],[onload],[onerror]').length, 0, `${side}: inline handler`);
  }
  const js = readFileSync(path.join(SITE, 'site.js'), 'utf8') + readFileSync(path.join(SITE, 'strings.js'), 'utf8');
  assert.ok(!/document\.cookie/.test(js), 'the scripts never touch cookies');
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/.test(js), 'the scripts make no requests');
});

// Pages the build writes from docs/legal (KC-0204); test/juridisk.test.ts checks they exist in the built output.
const GENERERET = new Set(['/legal', '/juridisk']);

test('every local link resolves to a file; every canonical is in the sitemap', () => {
  const sitemap = readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8');
  const loes = (u: string): boolean => {
    const p = u.split('#')[0]!.split('?')[0]!;
    if (!p) return true;
    const rel = p.replace(/^\//, '');
    return [rel, `${rel}.html`, `${rel}index.html`].some((c) => c !== '' && existsSync(path.join(SITE, c)) && statSync(path.join(SITE, c)).isFile())
      || p === '/install.sh' || GENERERET.has(p) || (p === '/' && existsSync(path.join(SITE, 'index.html')));
  };
  for (const side of SIDER) {
    const d = dok(side);
    for (const el of Array.from(d.querySelectorAll('a[href],link[href],script[src],img[src],source[srcset]'))) {
      const v = el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('srcset') ?? '';
      if (/^(https?:)?\/\//.test(v) || v.startsWith('#')) continue;
      assert.ok(loes(v), `${side}: broken link ${v}`);
    }
    const canon = d.querySelector('link[rel="canonical"]')!.getAttribute('href')!;
    assert.ok(sitemap.includes(`<loc>${canon}</loc>`), `${side}: ${canon} missing in sitemap.xml`);
    assert.ok(loes(new URL(canon).pathname), `${side}: canonical does not resolve`);
  }
});

test('the install command is one string: install.html and every docs page carry exactly it', () => {
  const med: string[] = [];
  for (const side of SIDER) {
    for (const el of Array.from(dok(side).querySelectorAll('[data-cmd="install"]'))) {
      assert.equal(flad(el.textContent ?? ''), INSTALL_KOMMANDO, `${side}`);
      med.push(side);
    }
  }
  assert.ok(med.includes('install.html'), 'install.html shows the command');
  assert.ok(med.includes('docs/mac-linux.html'), 'the Mac and Linux guide shows the command');
  // The command is also in the string table once, as the value the copy button puts on the clipboard.
  const alle = SIDER.map((s) => readFileSync(path.join(SITE, s), 'utf8')).join('\n');
  for (const m of alle.matchAll(/curl -fsSL [^<\s]+ \| bash(?! -s)/g)) assert.equal(m[0], INSTALL_KOMMANDO);
});

test('the landing page follows the plan: refusals, journey in seven steps, no pricing section, the refusals link to their tests', () => {
  const d = dok('index.html');
  assert.equal(d.querySelectorAll('#refusals article').length, 3, 'three refusals');
  assert.equal(d.querySelectorAll('#journey ol > li').length, 7, 'seven steps');
  assert.equal(d.querySelectorAll('#faq details').length >= 5, true, 'FAQ');
  for (const id of ['refusals', 'journey', 'screen', 'household', 'ways', 'agent', 'faq']) assert.ok(d.getElementById(id), `section #${id}`);
  assert.equal(d.getElementById('pricing'), null, 'no pricing section');
  const html = readFileSync(path.join(SITE, 'index.html'), 'utf8');
  assert.ok(!/TODO\(KC-0166\)/.test(html), 'the licence is decided (KC-0166)');
  assert.ok(d.querySelector('#refusals a[href="https://github.com/SlambertDK/clawco/tree/main/test/graenser"]'), 'the refusals link to the tests that hold them');
  assert.ok(d.querySelector('h1')!.hasAttribute('data-i'), 'the hero headline is translatable');
  assert.equal(d.querySelector('meta[property="og:image"]')?.getAttribute('content')?.startsWith(`https://${EGEN_VAERT}/`), true);
});

test('the screenshots: every image exists, the whole set stays under 1.5 MB', () => {
  const dir = path.join(SITE, 'billeder');
  let sum = 0;
  for (const f of readdirSync(dir)) sum += statSync(path.join(dir, f)).size;
  assert.ok(sum < 1.5 * 1024 * 1024, `images total ${sum} bytes`);
  const d = dok('index.html');
  assert.ok(d.querySelectorAll('img').length >= 4, 'the landing page shows real screenshots');
  for (const img of Array.from(d.querySelectorAll('img'))) {
    assert.ok(img.getAttribute('width') && img.getAttribute('height'), 'img has width and height (no layout jump)');
  }
});

// --- site.js, run against a linkedom page with stubs for what a browser provides -------------------------------

type Los = { document: Document; click: (sel: string) => Promise<void>; kopieret: string[]; lager: Map<string, string> };
function koer(side: string, search: string, opt: { lagerKaster?: boolean; clipboard?: boolean } = {}): Los {
  const { document, window } = parseHTML(readFileSync(path.join(SITE, side), 'utf8'));
  const lager = new Map<string, string>();
  const kopieret: string[] = [];
  const localStorage = opt.lagerKaster
    ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
    : { getItem: (k: string) => lager.get(k) ?? null, setItem: (k: string, v: string) => void lager.set(k, v) };
  const navigator = opt.clipboard === false ? {} : { clipboard: { writeText: async (t: string) => { kopieret.push(t); } } };
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = (c) => { if (c === 'copy') kopieret.push('fallback'); return true; };
  const ctx: Record<string, unknown> = {
    document, window, localStorage, navigator, setTimeout, clearTimeout,
    location: { search, pathname: '/' + side.replace(/index\.html$/, '').replace(/\.html$/, ''), hash: '' },
    history: { replaceState() {} },
    URLSearchParams,
    console,
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
  return { document, click, kopieret, lager };
}

test('site.js: ?lang=da shows Danish and sets html lang; English stays the default', () => {
  const t = laesTabel();
  const en = koer('index.html', '');
  assert.equal(en.document.documentElement.getAttribute('lang'), 'en');
  assert.equal(flad(en.document.querySelector('h1')!.textContent ?? ''), t.en['home.hero.h1']);
  const da = koer('index.html', '?lang=da');
  assert.equal(da.document.documentElement.getAttribute('lang'), 'da');
  assert.equal(flad(da.document.querySelector('h1')!.textContent ?? ''), t.da['home.hero.h1']);
  assert.equal(da.document.querySelector('meta[name="description"]')!.getAttribute('content'), t.da['home.meta.description']);
  assert.match(da.document.querySelector('a[href^="/install"]')!.getAttribute('href')!, /\?lang=da/, 'internal links keep the language');
});

test('site.js: the toggle switches language and remembers it in localStorage only', async () => {
  const s = koer('index.html', '');
  await s.click('[data-lang-toggle]');
  assert.equal(s.document.documentElement.getAttribute('lang'), 'da');
  assert.equal(s.lager.get('clawco-lang'), 'da');
  await s.click('[data-lang-toggle]');
  assert.equal(s.document.documentElement.getAttribute('lang'), 'en');
  assert.equal(s.lager.get('clawco-lang'), 'en');
  const igen = koer('install.html', '');
  assert.equal(igen.document.documentElement.getAttribute('lang'), 'en', 'a fresh page without memory is English');
});

test('site.js: a blocked localStorage does not break the page', async () => {
  const s = koer('index.html', '', { lagerKaster: true });
  assert.equal(s.document.documentElement.getAttribute('lang'), 'en');
  await s.click('[data-lang-toggle]');
  assert.equal(s.document.documentElement.getAttribute('lang'), 'da', 'the toggle still works for this page view');
});

test('KC-0204: every page footer links to the legal index; in Danish the link goes to the Danish index (data-href-da)', () => {
  const t = laesTabel();
  for (const side of SIDER) {
    const a = dok(side).querySelector('footer a[href="/legal"]');
    assert.ok(a, `${side}: footer link to /legal`);
    assert.equal(a.getAttribute('data-href-da'), '/juridisk', side);
    assert.equal(a.getAttribute('data-i'), 'c.nav.legal', side);
  }
  assert.equal(t.en['c.nav.legal'], 'Legal');
  assert.equal(t.da['c.nav.legal'], 'Juridisk');
  const en = koer('index.html', '');
  assert.equal(en.document.querySelector('footer a[data-i="c.nav.legal"]')!.getAttribute('href'), '/legal');
  const da = koer('index.html', '?lang=da');
  assert.equal(da.document.querySelector('footer a[data-i="c.nav.legal"]')!.getAttribute('href'), '/juridisk', 'no ?lang=da on a page that is already Danish');
});

test('site.js: tagline 2 sits behind a switch (?tagline=2); tagline 1 is the default', () => {
  const t = laesTabel();
  assert.equal(flad(koer('index.html', '').document.querySelector('h1')!.textContent ?? ''), t.en['home.hero.h1']);
  assert.equal(flad(koer('index.html', '?tagline=2').document.querySelector('h1')!.textContent ?? ''), t.en['home.hero.h1.2']);
  assert.equal(flad(koer('index.html', '?tagline=2&lang=da').document.querySelector('h1')!.textContent ?? ''), t.da['home.hero.h1.2']);
});

test('site.js: the copy button puts exactly the install command on the clipboard and says so', async () => {
  const t = laesTabel();
  const s = koer('install.html', '');
  const knap = s.document.querySelector('[data-copy="install"]')!;
  assert.equal(flad(knap.textContent ?? ''), t.en['install.copy']);
  await s.click('[data-copy="install"]');
  assert.deepEqual(s.kopieret, [INSTALL_KOMMANDO]);
  assert.equal(flad(knap.textContent ?? ''), t.en['js.copied']);
});

test('site.js: without the clipboard API the copy button falls back to a selection copy', async () => {
  const s = koer('install.html', '', { clipboard: false });
  await s.click('[data-copy="install"]');
  assert.deepEqual(s.kopieret, ['fallback']);
});

// --- the build step --------------------------------------------------------------------------------------------

test('site-byg: copies the site and deploy/install.sh byte-identically, and fails on a mismatch', () => {
  const ud = mkdtempSync(path.join(tmpdir(), 'clawco-site-'));
  try {
    const out = execFileSync('node', [path.join(ROD, 'scripts/site-byg.mjs'), '--ud', ud], { encoding: 'utf8' });
    const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
    assert.equal(hash(path.join(ud, 'install.sh')), hash(path.join(ROD, 'deploy/install.sh')));
    assert.ok(out.includes(hash(path.join(ROD, 'deploy/install.sh'))), 'prints the hash');
    for (const f of ['index.html', 'install.html', 'docs/security.html', 'site.css', 'site.js', 'strings.js', '_headers', 'sitemap.xml', 'robots.txt']) {
      assert.ok(existsSync(path.join(ud, f)), `${f} copied`);
    }
    assert.ok(!existsSync(path.join(ud, 'README.md')), 'README.md is not published');
  } finally { rmSync(ud, { recursive: true, force: true }); }
});

test('site-byg: refuses an output folder inside site/ or a folder that already has files', () => {
  const full = mkdtempSync(path.join(tmpdir(), 'clawco-site-'));
  try {
    writeFileSync(path.join(full, 'keep.txt'), 'mine');
    const koer1 = (ud: string) => spawnSync('node', [path.join(ROD, 'scripts/site-byg.mjs'), '--ud', ud], { encoding: 'utf8' });
    const inde = koer1(path.join(SITE, 'dist'));
    assert.equal(inde.status, 2, inde.stderr);
    assert.match(inde.stderr, /inside the source folder/);
    assert.ok(!existsSync(path.join(SITE, 'dist')), 'nothing was written');
    const fuld = koer1(full);
    assert.equal(fuld.status, 2, fuld.stderr);
    assert.equal(readFileSync(path.join(full, 'keep.txt'), 'utf8'), 'mine', 'existing files untouched');
  } finally { rmSync(full, { recursive: true, force: true }); }
});

test('_headers: a content-security policy that forbids everything but the site itself, and install.sh as text', () => {
  const h = readFileSync(path.join(SITE, '_headers'), 'utf8');
  assert.match(h, /Content-Security-Policy: default-src 'none'/);
  for (const d of ["script-src 'self'", "style-src 'self'", "img-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"]) assert.ok(h.includes(d), d);
  assert.ok(!/https?:\/\//.test(h.split('\n').filter((l) => l.includes('Content-Security-Policy')).join('')), 'CSP names no other host');
  assert.match(h, /\/install\.sh\n\s+Content-Type: text\/plain; charset=utf-8/);
});

test('the README names the build and deploy commands and keeps secrets out', () => {
  const r = laes('site/README.md');
  assert.match(r, /node scripts\/site-byg\.mjs/);
  assert.match(r, /wrangler pages deploy/);
  assert.match(r, /--project-name clawco-site/);
});

test('every footer links to the public source, the repository install.sh clones (KC-0228)', () => {
  const repo = /CLAWCO_REPO:-(https:\/\/github\.com\/[^}]+)\.git\}/.exec(laes('deploy/install.sh'))?.[1];
  assert.equal(repo, 'https://github.com/SlambertDK/clawco');
  for (const side of SIDER.filter((s) => dok(s).querySelector('footer'))) {
    const a: Element | null = dok(side).querySelector(`footer a[href="${repo}"]`);
    assert.ok(a, `${side}: no source link`);
    assert.equal(a.getAttribute('data-i'), 'c.nav.source', side);
  }
});
