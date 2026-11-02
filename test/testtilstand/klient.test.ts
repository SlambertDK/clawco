import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// KC-0068: static checks on the band (public/testtilstand.js, .css) and the Kø-panel switch.
const lad = (f: string): string => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const js = lad('public/testtilstand.js');
const css = lad('public/testtilstand.css');

/** testtilstand.js in a bare context (no DOM): only the Date shift can run there. */
function kør(offsetMs: number | null): { Date: DateConstructor; classes: string[] } {
  const classes: string[] = [];
  const box: Record<string, unknown> = {
    document: { readyState: 'loading', addEventListener() {}, documentElement: { classList: { add: (c: string) => classes.push(c) } } },
  };
  if (offsetMs !== null) box['KC_TEST'] = { offsetMs, moment: 'x', navn: 'X' };
  box['window'] = box;
  vm.createContext(box);
  vm.runInContext(js, box);
  return { Date: (box['Date'] as DateConstructor | undefined) ?? Date, classes };
}

test('testtilstand.js: the Date shift comes before any DOM use and reads KC_TEST.offsetMs', () => {
  const shift = js.indexOf('window.Date = ShiftedDate');
  assert.ok(shift > 0);
  assert.ok(js.slice(0, shift).includes('KC_TEST'));
  for (const dom of ['document.', 'fetch(']) assert.ok(js.indexOf(dom) > shift, `${dom} must come after the shift`);
  assert.ok(!js.includes('KC_DEMO'));
});

test('testtilstand.js: Date.now() and new Date() follow the offset, arguments and statics are untouched', () => {
  const D = kør(3_600_000).Date;
  const real = Date.now();
  assert.ok(Math.abs(D.now() - (real + 3_600_000)) < 100);
  assert.ok(Math.abs(new D().getTime() - (real + 3_600_000)) < 100);
  assert.equal(new D('2026-10-29T10:00:00Z').toISOString(), '2026-10-29T10:00:00.000Z');
  assert.equal(new D(0).getTime(), 0);
  assert.equal(D.UTC(2026, 9, 29, 10), Date.UTC(2026, 9, 29, 10));
  assert.ok(new D() instanceof D);
});

test('testtilstand.js: without window.KC_TEST it does nothing at all', () => {
  const r = kør(null);
  assert.equal(r.Date, Date);
  assert.deepEqual(r.classes, []);
});

test('testtilstand.js: server strings only through textContent, never innerHTML', () => {
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(js));
  assert.ok(js.includes('textContent'));
});

test('testtilstand.js: Danish labels and the switch calls', () => {
  for (const s of ['Testtilstand', 'Øjeblik', 'Sluk', '/test/status', '/test/sluk', '/test/moment/']) assert.ok(js.includes(s), s);
});

test('testtilstand.css: its own violet tokens, distinct from every colour in app.css', () => {
  assert.match(css, /--test-baand:\s*#B48CF0/i);
  assert.match(css, /--test-baand-bg:\s*#2A1F3D/i);
  const app = lad('public/app.css').toLowerCase();
  assert.ok(!app.includes('#b48cf0') && !app.includes('#2a1f3d'));
});

test('testtilstand.css: the band is fixed, safe-area aware, and the page reserves its height', () => {
  assert.match(css, /\.kc-test-baand\s*{[^}]*position:\s*fixed/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /html\.kc-test\s+body\s*{[^}]*padding-top/);
});

test('Kø panel: the "Testtilstand" switch is in the layout and wired in app.js', () => {
  // KC-0170: the words live in the shell's text table; the layout and app.js name them by key.
  const layout = lad('src/shell/layout.ts');
  const tekster = lad('src/shell/tekster.ts');
  assert.ok(layout.includes('id="test-knap"') && layout.includes('T.testHint') && tekster.includes("testHint: 'Prøv alle funktioner med opdigtede data'"));
  const app = lad('public/app.js');
  assert.ok(app.includes('/test/taend') && app.includes('/test/sluk') && app.includes("tk('slukTest')") && tekster.includes("slukTest: 'Sluk testtilstand'") && app.includes('KC_TEST'));
});

test('testtilstand.css: on a phone the title is just "Test" (full title and clock hidden), the picker gets the width', () => {
  assert.match(css, /@media \(max-width: 480px\)\s*{[^}]*\.kc-test-lang\s*{\s*display:\s*none/);
  assert.match(css, /\.kc-test-kort\s*{\s*display:\s*none/); // hidden by default, shown only in the phone block
  assert.ok(js.includes("'kc-test-kort', 'Test'") && js.includes("'kc-test-lang'"));
});

test('.gitignore: the test world data dir is ignored', () => {
  assert.match(lad('.gitignore'), /^\/?data-test\/?$/m);
});

// Stale tabs: app.js declares the page's mode on every same-origin fetch, before anything else fetches.
const appJs = lad('public/app.js');

test('app.js: the x-kc-tilstand fetch wrapper is installed before any other fetch use', () => {
  const wrap = appJs.indexOf('window.fetch = ');
  assert.ok(wrap > 0, 'app.js replaces window.fetch');
  const foerste = appJs.search(/(?<![.\w])fetch\(/);
  assert.ok(foerste > wrap, 'no bare fetch( before the wrapper');
  assert.ok(appJs.slice(0, wrap).indexOf('(function () {') === appJs.lastIndexOf('(function () {', wrap), 'the wrapper is the first block in the file');
  assert.ok(appJs.indexOf('window.kcMorph') > wrap, 'it runs before the main client');
});

/** Runs app.js with a recording fetch; the main client fails on the missing DOM, after the wrapper is in. */
function medWrapper(test: boolean, svar: { status: number; skiftet?: boolean } = { status: 200 }) {
  const kald: { url: string; tilstand: string | null }[] = [];
  let genindlaest = 0;
  const lyttere: Record<string, (e: unknown) => void> = {};
  const box: Record<string, unknown> = {
    Headers, Request, URL, Promise,
    location: { href: 'http://127.0.0.1:8771/rum/hjem', origin: 'http://127.0.0.1:8771', reload: () => { genindlaest++; } },
    addEventListener: (n: string, f: (e: unknown) => void) => { lyttere[n] = f; },
    fetch: (input: unknown, init?: { headers?: HeadersInit }) => {
      const url = input instanceof Request ? input.url : String(input);
      kald.push({ url, tilstand: new Headers(init?.headers).get('x-kc-tilstand') });
      const h = new Headers(svar.skiftet ? { 'x-kc-tilstand-skiftet': '1' } : {});
      return Promise.resolve(new Response('x', { status: svar.status, headers: h }));
    },
    document: {},
  };
  if (test) box['KC_TEST'] = { offsetMs: 0, moment: 'x', navn: 'X' };
  box['window'] = box;
  vm.createContext(box);
  try { vm.runInContext(appJs, box); } catch { /* the main client needs a DOM */ }
  return { f: box['fetch'] as typeof fetch, kald, genindlaest: () => genindlaest, lyttere };
}

test('app.js wrapper: same-origin fetches carry x-kc-tilstand (test iff KC_TEST), cross-origin ones do not', async () => {
  for (const [erTest, forventet] of [[true, 'test'], [false, 'real']] as const) {
    const w = medWrapper(erTest);
    await w.f('/api/rum/hjem/chat', { method: 'POST' });
    await w.f('http://127.0.0.1:8771/api/koe');
    await w.f('https://api.elevenlabs.io/v1/x', { method: 'POST' });
    assert.deepEqual(w.kald.map((k) => k.tilstand), [forventet, forventet, null], String(erTest));
  }
});

test('app.js wrapper: a 409 marked x-kc-tilstand-skiftet reloads the page; other answers pass through', async () => {
  const w = medWrapper(true, { status: 409, skiftet: true });
  void w.f('/api/rum/hjem/chat', { method: 'POST' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(w.genindlaest(), 1);
  const a = medWrapper(true, { status: 409 });
  const r = await a.f('/test/moment/x', { method: 'POST' });
  assert.equal(r.status, 409);
  assert.equal(a.genindlaest(), 0);
});

test('app.js: a page restored from the bfcache reloads', () => {
  const w = medWrapper(false);
  assert.ok(w.lyttere['pageshow'], 'a pageshow listener');
  w.lyttere['pageshow']!({ persisted: false });
  assert.equal(w.genindlaest(), 0);
  w.lyttere['pageshow']!({ persisted: true });
  assert.equal(w.genindlaest(), 1);
});
