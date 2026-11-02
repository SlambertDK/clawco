import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { UNIVERS_PROMPT } from '../src/rooms/univers/prompt-tekster.ts';

// KC-0229: Inter and IBM Plex Mono are served from public/fonts/, so no Clawco page asks Google Fonts when it opens.
// Invariant: nothing the app, Sky or the site ships names a Google font host; every face in app.css points at a file
// that exists and is served as font/woff2 with a long cache; the licence of each family ships beside the files.

const ROD = fileURLToPath(new URL('..', import.meta.url));
const laes = (rel: string): string => readFileSync(path.join(ROD, rel), 'utf8');
const TEKSTFIL = /\.(ts|js|html|css|json|md|txt|sh|xml|webmanifest)$/;

function filer(mappe: string): string[] {
  const ud: string[] = [];
  const gaa = (x: string): void => {
    for (const e of readdirSync(x, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(x, e.name);
      if (e.isDirectory()) gaa(p); else if (TEKSTFIL.test(e.name)) ud.push(p);
    }
  };
  if (existsSync(mappe)) gaa(mappe);
  return ud;
}

const lavApp = () => createApp({ store: createFileStore('/nonexistent'), hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json', publicDir: 'public' }).app;

test('no file the app, Sky or the site ships names a Google font host', () => {
  const fund: string[] = [];
  for (const mappe of ['src', 'public', 'sky/src', 'site']) {
    for (const f of filer(path.join(ROD, mappe))) if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(readFileSync(f, 'utf8'))) fund.push(path.relative(ROD, f));
  }
  assert.deepEqual(fund, []);
});

test('the shell links no outside stylesheet and no preconnect: fonts come from app.css and our own origin', () => {
  const layout = laes('src/shell/layout.ts');
  assert.ok(!/rel="preconnect"/.test(layout));
  assert.ok(!/<link[^>]+href="https?:/.test(layout), 'an absolute link in the shell head');
});

const FLADER = [...laes('public/app.css').matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
const familie = (b: string): string => /font-family:\s*['"]?([^;'"]+)['"]?/.exec(b)![1]!.trim();

test('app.css declares Inter (variable) and IBM Plex Mono 400/500, latin and latin-ext, font-display swap, files under /fonts/', () => {
  assert.equal(FLADER.length, 6);
  assert.deepEqual(FLADER.map(familie).sort(), ['IBM Plex Mono', 'IBM Plex Mono', 'IBM Plex Mono', 'IBM Plex Mono', 'Inter', 'Inter']);
  for (const b of FLADER) {
    assert.match(b, /font-display:\s*swap/);
    assert.match(b, /unicode-range:\s*U\+/);
    const url = /url\(\/fonts\/([a-z0-9-]+\.woff2)\)/.exec(b);
    assert.ok(url, `a face without a /fonts/ url: ${b}`);
    assert.ok(existsSync(path.join(ROD, 'public/fonts', url![1]!)), `${url![1]} is missing`);
    assert.ok(!/https?:/.test(b), 'an absolute url in a face');
  }
  for (const b of FLADER.filter((x) => familie(x) === 'Inter')) assert.match(b, /font-weight:\s*100 900/, 'Inter is the variable file: every weight the CSS uses (400-700) from one file');
  const plex = FLADER.filter((b) => familie(b) === 'IBM Plex Mono').map((b) => /font-weight:\s*(\d+)/.exec(b)![1]!).sort();
  assert.deepEqual(plex, ['400', '400', '500', '500']);
});

test('the font families the CSS names still lead with the fonts we ship, with system fallbacks', () => {
  const css = laes('public/app.css');
  assert.match(css, /--font:\s*Inter,\s*system-ui/);
  assert.match(css, /--mono:\s*"IBM Plex Mono",\s*ui-monospace/);
});

test('the licence of each family ships beside the files', () => {
  for (const f of ['public/fonts/OFL-Inter.txt', 'public/fonts/OFL-IBM-Plex-Mono.txt']) {
    assert.ok(existsSync(path.join(ROD, f)), f);
    assert.match(laes(f), /SIL OPEN FONT LICENSE Version 1\.1/i);
  }
  assert.match(laes('public/fonts/OFL-Inter.txt'), /Inter Project Authors/);
  assert.match(laes('public/fonts/OFL-IBM-Plex-Mono.txt'), /IBM Corp/);
});

test('the font files are small enough to be a sensible default (under 250 KB in all)', () => {
  const dir = path.join(ROD, 'public/fonts');
  const sum = readdirSync(dir).filter((n) => n.endsWith('.woff2')).reduce((s, n) => s + statSync(path.join(dir, n)).size, 0);
  assert.ok(sum > 0 && sum < 250_000, String(sum));
});

test('/fonts/*.woff2 is served as font/woff2 with a one-year immutable cache; the rest of the files stay revalidated', async () => {
  const app = lavApp();
  const navne = readdirSync(path.join(ROD, 'public/fonts')).filter((n) => n.endsWith('.woff2'));
  assert.equal(navne.length, 6);
  for (const n of navne) {
    const res = await app.request(`/fonts/${n}`);
    assert.equal(res.status, 200, n);
    assert.equal(res.headers.get('content-type'), 'font/woff2', n);
    assert.match(res.headers.get('cache-control') ?? '', /max-age=31536000/, n);
    assert.match(res.headers.get('cache-control') ?? '', /immutable/, n);
    assert.equal((await res.arrayBuffer()).byteLength, statSync(path.join(ROD, 'public/fonts', n)).size, n);
  }
  const css = await app.request('/app.css');
  assert.equal(css.headers.get('cache-control'), 'no-cache');
});

test('a shell page links app.css and nothing outside our own origin', async () => {
  const text = await (await lavApp().request('/rum/findesikke')).text();
  assert.match(text, /<link rel="stylesheet" href="\/app\.css">/);
  assert.ok(!/fonts\.g/.test(text));
});

test('the security page no longer lists Google Fonts among the outside hosts', () => {
  const side = laes('site/docs/security.html');
  assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com|Google Fonts/.test(side));
  assert.ok(!/sec\.leaves\.fonts/.test(laes('site/strings.js')));
});

test('the rule Hermes gets for presentations names no font host: system fonts only', () => {
  // The served CSP of /rum/:id/vis/:name is asserted in server-univers.test.ts; this is the prompt rule behind it.
  // KC-0241: the rule is in the language table (src/rooms/univers/prompt-tekster.ts), one text per language.
  for (const [sprog, system] of [['da', /systemskrifttyper/], ['en', /system fonts/]] as const) {
    const regel = UNIVERS_PROMPT[sprog].htmlRegler;
    assert.ok(!/Google/i.test(regel), sprog);
    assert.match(regel, system, sprog);
  }
});
