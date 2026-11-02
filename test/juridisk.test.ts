import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { DOKUMENTER, byggJuridisk, laesDokumenter, parseDokument, renderMarkdown, tjekUdgivelse } from '../scripts/juridisk.ts';

// KC-0204: the legal drafts in docs/legal/ become versioned static pages. Invariants: every document has a
// version, a date and a status in its frontmatter; a published document carries no placeholder or UDKAST; the
// page on the site is exactly what the file says (hash in the page); Sky asks for the version the file has.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const DOCS = path.join(ROD, 'docs/legal');
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

const FM = (o: Record<string, string> = {}) => `---\nversion: ${o['version'] ?? '1.0'}\ndato: ${o['dato'] ?? '2026-10-31'}\nstatus: ${o['status'] ?? 'udkast'}\nsprog: ${o['sprog'] ?? 'da'}\n---\n`;

test('parseDokument: frontmatter becomes version, dato, status, sprog; the body is what follows', () => {
  const d = parseDokument(`${FM()}\n# Vilkår\n\nTekst.\n`);
  assert.deepEqual(d.meta, { version: '1.0', dato: '2026-10-31', status: 'udkast', sprog: 'da' });
  assert.match(d.body, /^\n# Vilkår/);
});

test('parseDokument: refuses a missing or invalid field', () => {
  assert.throws(() => parseDokument('# uden frontmatter\n'), /frontmatter/);
  assert.throws(() => parseDokument(FM({ status: 'klar' }) + 'x'), /status/);
  assert.throws(() => parseDokument(FM({ version: '' }) + 'x'), /version/);
  assert.throws(() => parseDokument(FM({ dato: '31-10-2026' }) + 'x'), /dato/);
  assert.throws(() => parseDokument(FM({ sprog: 'de' }) + 'x'), /sprog/);
  assert.throws(() => parseDokument(`${FM()}`.replace('---\n', '---\nogså: ja\n') + 'x'), /også/);
});

test('renderMarkdown: the subset the legal texts use, all text escaped', () => {
  const html = renderMarkdown([
    '## 1. Hvem', '', 'Vi er **Henrik** og *dig* & `kode` <b>fed</b>.', '',
    '- et', '- to', '  fortsat', '', '1. første', '2. anden', '', '> et citat', '',
    '| A | B |', '|---|---|', '| 1 | <2> |', '',
    'Se [vilkår](/vilkaar) og [os](https://clawco.work/x) og [post](mailto:a@b.example).',
  ].join('\n'));
  assert.match(html, /<h2>1\. Hvem<\/h2>/);
  assert.match(html, /<strong>Henrik<\/strong>/);
  assert.match(html, /<em>dig<\/em> &amp; <code>kode<\/code> &lt;b&gt;fed&lt;\/b&gt;/);
  assert.match(html, /<ul>\s*<li>et<\/li>\s*<li>to fortsat<\/li>\s*<\/ul>/);
  assert.match(html, /<ol>\s*<li>første<\/li>\s*<li>anden<\/li>\s*<\/ol>/);
  assert.match(html, /<blockquote>\s*<p>et citat<\/p>\s*<\/blockquote>/);
  assert.match(html, /<div class="tabel"><table>\s*<thead><tr><th>A<\/th><th>B<\/th><\/tr><\/thead>\s*<tbody><tr><td>1<\/td><td>&lt;2&gt;<\/td><\/tr><\/tbody>\s*<\/table><\/div>/);
  assert.match(html, /href="\/vilkaar"/);
  assert.ok(!html.includes('<b>'), 'raw HTML never passes through');
});

test('renderMarkdown: placeholders in brackets stay text; unknown constructs fail the build instead of vanishing', () => {
  assert.match(renderMarkdown('Skriv til [Kontakt-e-mail].'), /\[Kontakt-e-mail\]/);
  assert.throws(() => renderMarkdown('```\nkode\n```'), /code fence/);
  assert.throws(() => renderMarkdown('![x](/a.png)'), /image/);
  assert.throws(() => renderMarkdown('- a\n  - b'), /nested/);
  assert.throws(() => renderMarkdown('[x](javascript:alert(1))'), /link/);
  assert.throws(() => renderMarkdown('[x](//andet.example/a)'), /link/);
});

test('a draft version (0.1-udkast) reads; a published document cannot carry a draft version', () => {
  assert.equal(parseDokument(FM({ version: '0.1-udkast' }) + '\n# x\n').meta.version, '0.1-udkast');
  assert.throws(() => parseDokument(FM({ version: '0.1-udkast', status: 'udgivet' }) + '\n# x\n'), /udkast/);
  assert.throws(() => parseDokument(FM({ version: 'v1' }) + '\n# x\n'), /version/);
});

test('tjekUdgivelse: a published document must not carry [Selskab], [CVR] or UDKAST; a draft may', () => {
  assert.deepEqual(tjekUdgivelse('udkast', 'UDKAST [Selskab] [CVR]'), []);
  assert.deepEqual(tjekUdgivelse('udgivet', 'Alt er på plads.'), []);
  assert.match(tjekUdgivelse('udgivet', 'Drives af [Selskab].').join(), /\[Selskab\]/);
  assert.match(tjekUdgivelse('udgivet', 'CVR [CVR]').join(), /\[CVR\]/);
  assert.match(tjekUdgivelse('udgivet', '> UDKAST / DRAFT').join(), /UDKAST/);
  assert.deepEqual(tjekUdgivelse('laest', 'x [Selskab]'), [], 'laest is on its way to publication; only udgivet is held to the rule');
});

/** A throw-away docs folder with every document in both languages, so the build has what it needs. */
function lavDocs(over: (id: string, sprog: 'da' | 'en') => { meta?: Record<string, string>; tekst?: string } = () => ({})): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'clawco-legal-'));
  for (const d of DOKUMENTER) for (const sprog of ['da', 'en'] as const) {
    const o = over(d.id, sprog);
    writeFileSync(path.join(dir, `${d.fil}.${sprog}.md`), FM({ sprog, ...(o.meta ?? {}) }) + (o.tekst ?? `\n# ${d.id} ${sprog}\n\nTekst for ${d.id}.\n`));
  }
  return dir;
}

test('laesDokumenter: finds every document in both languages; refuses a missing file', () => {
  const dir = lavDocs();
  try {
    const alle = laesDokumenter(dir);
    assert.equal(alle.length, DOKUMENTER.length * 2);
    rmSync(path.join(dir, 'cookies.en.md'));
    assert.throws(() => laesDokumenter(dir), /cookies\.en\.md/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('laesDokumenter: the Danish and English file of one document must agree on version, date and status', () => {
  const dir = lavDocs((id, sprog) => (id === 'vilkaar' && sprog === 'en' ? { meta: { version: '1.1' } } : {}));
  try { assert.throws(() => laesDokumenter(dir), /vilkaar.*version/); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('laesDokumenter: earlier versions are the archived files, newest first; none is the current one', () => {
  const dir = lavDocs();
  try {
    mkdirSync(path.join(dir, 'arkiv'));
    writeFileSync(path.join(dir, 'arkiv', 'vilkaar.da.0.9.md'), FM({ version: '0.9', dato: '2026-09-01' }) + '\n# Vilkår 0.9\n');
    writeFileSync(path.join(dir, 'arkiv', 'vilkaar.da.0.8.md'), FM({ version: '0.8', dato: '2026-08-01' }) + '\n# Vilkår 0.8\n');
    const v = laesDokumenter(dir).find((d) => d.id === 'vilkaar' && d.sprog === 'da')!;
    assert.deepEqual(v.tidligere.map((t) => t.meta.version), ['0.9', '0.8']);
    assert.deepEqual(laesDokumenter(dir).find((d) => d.id === 'vilkaar' && d.sprog === 'en')!.tidligere, []);
    writeFileSync(path.join(dir, 'arkiv', 'vilkaar.da.1.0.md'), FM() + '\n# x\n');
    assert.throws(() => laesDokumenter(dir), /arkiv.*1\.0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the real files: all twelve have frontmatter, version 0.1-udkast status udkast, and the pairs agree', () => {
  const alle = laesDokumenter(DOCS);
  assert.equal(alle.length, 12);
  for (const d of alle) {
    // The version Henrik accepted at sign-up; 1.0 comes with the lawyer's reading, not before (no re-accept of an unchanged text).
    assert.equal(d.meta.version, '0.1-udkast', d.fil);
    assert.equal(d.meta.status, 'udkast', `${d.fil} stays a draft until Henrik and a lawyer say yes`);
    assert.ok(d.titel.length > 3, `${d.fil} has an h1`);
  }
});

// --- the built pages -------------------------------------------------------------------------------------------

function byg(docs: string): { ud: string; stier: string[] } {
  const ud = mkdtempSync(path.join(tmpdir(), 'clawco-legal-ud-'));
  cpSync(path.join(ROD, 'site/site.css'), path.join(ud, 'site.css'));
  writeFileSync(path.join(ud, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://clawco.work/</loc></url>\n</urlset>\n');
  return { ud, stier: byggJuridisk({ docsDir: docs, ud, siteDir: path.join(ROD, 'site') }) };
}
const side = (ud: string, rel: string) => parseHTML(readFileSync(path.join(ud, rel), 'utf8')).document;

test('byggJuridisk: a page per document and language, with title, one h1, lang, viewport, description, canonical', () => {
  const { ud } = byg(DOCS);
  try {
    const stier: [string, 'da' | 'en'][] = [];
    for (const d of DOKUMENTER) { stier.push([`${d.sti}.html`, 'da']); stier.push([`en/${d.sti}.html`, 'en']); }
    stier.push(['juridisk.html', 'da'], ['legal.html', 'en']);
    for (const [rel, sprog] of stier) {
      const d = side(ud, rel);
      assert.equal(d.documentElement.getAttribute('lang'), sprog, rel);
      assert.equal(d.querySelectorAll('h1').length, 1, `${rel}: one h1`);
      assert.ok((d.querySelector('title')?.textContent ?? '').trim().length > 5, `${rel}: title`);
      assert.match(d.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '', /width=device-width/);
      const desc = d.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
      assert.ok(desc.length >= 60 && desc.length <= 200, `${rel}: description length ${desc.length}`);
      assert.ok((d.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '').startsWith('https://clawco.work/'), rel);
      assert.equal(d.querySelectorAll('script').length, 0, `${rel}: no script (the page is static, in one language)`);
    }
  } finally { rmSync(ud, { recursive: true, force: true }); }
});

test('byggJuridisk: a draft shows the red-bordered banner in its own language, version and date in the header, and is not indexed', () => {
  const { ud } = byg(DOCS);
  try {
    const da = side(ud, 'vilkaar.html');
    assert.match(da.querySelector('.udkast')?.textContent ?? '', /UDKAST, ikke juridisk gennemgået/);
    assert.match(da.querySelector('.dokmeta')?.textContent ?? '', /Version 0\.1-udkast/);
    assert.match(da.querySelector('.dokmeta')?.textContent ?? '', /2026-10-31/);
    const en = side(ud, 'en/vilkaar.html');
    assert.match(en.querySelector('.udkast')?.textContent ?? '', /DRAFT, not legally reviewed/);
    assert.match(en.querySelector('.dokmeta')?.textContent ?? '', /Version 0\.1-udkast/);
    assert.equal(da.querySelector('meta[name="robots"]')?.getAttribute('content'), 'noindex');
    assert.equal(da.querySelector('link[rel="alternate"][hreflang="en"]')?.getAttribute('href'), 'https://clawco.work/en/vilkaar');
    // The file's own draft notice and "Version 0.1-udkast" line are replaced by the banner and the header: once, not twice.
    assert.equal((da.querySelector('main')?.textContent ?? '').split('0.1-udkast').length - 1, 1);
    assert.match(css(ud), /\.udkast\s*\{[^}]*border[^}]*var\(--graense\)/);
  } finally { rmSync(ud, { recursive: true, force: true }); }
});
const css = (ud: string) => readFileSync(path.join(ud, 'site.css'), 'utf8');

test('byggJuridisk: no request to another host: every href/src is local or the site itself', () => {
  const { ud } = byg(DOCS);
  try {
    for (const rel of ['vilkaar.html', 'en/cookies.html', 'juridisk.html', 'legal.html']) {
      for (const el of Array.from(side(ud, rel).querySelectorAll('[href],[src]'))) {
        const v = el.getAttribute('href') ?? el.getAttribute('src') ?? '';
        assert.ok(!/^(https?:)?\/\//.test(v) || new URL(v, 'https://x.invalid').hostname === 'clawco.work', `${rel}: ${v}`);
      }
    }
  } finally { rmSync(ud, { recursive: true, force: true }); }
});

test('byggJuridisk: the page carries the sha-256 of its source file, and it matches the file now', () => {
  const { ud } = byg(DOCS);
  try {
    for (const d of DOKUMENTER) for (const sprog of ['da', 'en'] as const) {
      const rel = `${sprog === 'en' ? 'en/' : ''}${d.sti}.html`;
      const meta = side(ud, rel).querySelector('meta[name="clawco-kilde"]')?.getAttribute('content') ?? '';
      assert.equal(meta, `docs/legal/${d.fil}.${sprog}.md sha256:${hash(readFileSync(path.join(DOCS, `${d.fil}.${sprog}.md`)))}`, rel);
    }
  } finally { rmSync(ud, { recursive: true, force: true }); }
});

test('byggJuridisk: a page with status udgivet that still has a placeholder or UDKAST fails the build and writes nothing', () => {
  for (const [tekst, ord] of [['\n# V\n\nDrives af [Selskab].\n', /\[Selskab\]/], ['\n# V\n\nCVR [CVR].\n', /\[CVR\]/], ['\n# V\n\n> UDKAST / DRAFT\n', /UDKAST/]] as const) {
    const dir = lavDocs((id, sprog) => (id === 'vilkaar' && sprog === 'da' ? { meta: { status: 'udgivet' }, tekst } : id === 'vilkaar' ? { meta: { status: 'udgivet' } } : {}));
    const ud = mkdtempSync(path.join(tmpdir(), 'clawco-legal-ud-'));
    try {
      assert.throws(() => byggJuridisk({ docsDir: dir, ud, siteDir: path.join(ROD, 'site') }), ord);
      assert.deepEqual(readdirSync(ud), [], 'nothing written');
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ud, { recursive: true, force: true }); }
  }
});

test('byggJuridisk: a published document has no banner, is indexable and is in the sitemap; drafts are not', () => {
  const dir = lavDocs((id) => (id === 'vilkaar' ? { meta: { status: 'udgivet' }, tekst: '\n# Vilkår\n\nRent.\n' } : {}));
  const { ud } = byg(dir);
  try {
    const da = side(ud, 'vilkaar.html');
    assert.equal(da.querySelector('.udkast'), null);
    assert.equal(da.querySelector('meta[name="robots"]'), null);
    const sitemap = readFileSync(path.join(ud, 'sitemap.xml'), 'utf8');
    assert.ok(sitemap.includes('<loc>https://clawco.work/vilkaar</loc>') && sitemap.includes('<loc>https://clawco.work/en/vilkaar</loc>'));
    assert.ok(!sitemap.includes('/cookies'), 'a draft is not in the sitemap');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ud, { recursive: true, force: true }); }
});

test('byggJuridisk: earlier versions are listed from the archive only, each with its own page; none yet is said plainly', () => {
  const dir = lavDocs();
  mkdirSync(path.join(dir, 'arkiv'));
  writeFileSync(path.join(dir, 'arkiv', 'vilkaar.da.0.9.md'), FM({ version: '0.9', dato: '2026-09-01' }) + '\n# Vilkår 0.9\n\nGammel.\n');
  const { ud } = byg(dir);
  try {
    const med = side(ud, 'vilkaar.html');
    const links = Array.from(med.querySelectorAll('.tidligere a')).map((a) => a.getAttribute('href'));
    assert.deepEqual(links, ['/vilkaar/v0.9']);
    const gammel = side(ud, 'vilkaar/v0.9.html');
    assert.match(gammel.querySelector('.erstattet')?.textContent ?? '', /1\.0/);
    assert.match(side(ud, 'privatliv.html').querySelector('.tidligere')?.textContent ?? '', /Ingen tidligere versioner endnu/);
    assert.match(side(ud, 'en/privatliv.html').querySelector('.tidligere')?.textContent ?? '', /No earlier versions yet/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(ud, { recursive: true, force: true }); }
});

test('the real build: node scripts/site-byg.mjs writes the legal pages next to the rest of the site', () => {
  const ud = mkdtempSync(path.join(tmpdir(), 'clawco-site-'));
  try {
    execFileSync('node', [path.join(ROD, 'scripts/site-byg.mjs'), '--ud', ud], { encoding: 'utf8' });
    for (const f of ['vilkaar.html', 'en/vilkaar.html', 'privatliv.html', 'databehandler.html', 'cookies.html', 'underdatabehandlere.html', 'sletning-og-eksport.html', 'legal.html', 'juridisk.html', 'en/sletning-og-eksport.html']) {
      assert.ok(existsSync(path.join(ud, f)), `${f} built`);
    }
    // Every local link on a legal page resolves in the built output.
    const loes = (u: string) => { const p = u.split('#')[0]!.split('?')[0]!.replace(/^\//, ''); return p === '' || [p, `${p}.html`, `${p}/index.html`].some((c) => existsSync(path.join(ud, c))); };
    for (const f of ['vilkaar.html', 'legal.html', 'juridisk.html', 'index.html', 'docs/security.html']) {
      for (const a of Array.from(side(ud, f).querySelectorAll('a[href],link[href]'))) {
        const v = a.getAttribute('href')!;
        if (!/^(https?:|mailto:|#)/.test(v)) assert.ok(loes(v), `${f}: broken ${v}`);
      }
    }
  } finally { rmSync(ud, { recursive: true, force: true }); }
});
