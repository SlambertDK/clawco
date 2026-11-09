import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import path from 'node:path';
import { erTestBesked, medTesttilstand, testDataDir } from '../../src/testtilstand/kontakt.ts';
import type { Testverden } from '../../src/testtilstand/verden.ts';
import { ALLE_MOMENTER, MOMENTER } from '../../src/testtilstand/indhold.ts';
import { tilladAlle } from '../helpers/tillad.ts';

const KEKS = 'kc_test=1';
const COOKIE_SAT = 'kc_test=1; Path=/; SameSite=Lax; HttpOnly; Max-Age=2592000';
const COOKIE_RYDDET = 'kc_test=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0';

/** A real app that records what it was asked and answers with a recognisable body. */
function spionApp() {
  const kald: string[] = [];
  const app = new Hono();
  app.all('*', async (c) => {
    kald.push(`${c.req.method} ${new URL(c.req.url).pathname}`);
    const p = new URL(c.req.url).pathname;
    if (p.startsWith('/api/')) return c.json({ fra: 'rigtig' });
    return c.html('<!doctype html><html><head><title>rigtig</title></head><body>rigtig</body></html>');
  });
  return { fetch: (r: Request) => app.fetch(r), kald };
}

/** A presentation document as the univers `vis` route serves it into <iframe sandbox>. */
const VIS_HTML = '<!doctype html><html><head><title>slides</title></head><body><h1>Slides</h1></body></html>';

/** A stub world: HTML pages, a JSON route, and call records. */
function stubVerden(): Testverden & { kald: string[]; offset: number } {
  const kald: string[] = [];
  let valgt = MOMENTER[0]!;
  const app = new Hono();
  app.get('/data', (c) => c.json({ fra: 'test' }));
  app.get('/rum/:id/vis/:name', (c) => c.html(VIS_HTML));
  app.get('/csp', (c) => c.body(VIS_HTML, 200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "script-src 'none'" }));
  app.all('*', (c) => { kald.push(`${c.req.method} ${new URL(c.req.url).pathname}`); return c.html('<!doctype html><html lang="da"><head><meta charset="utf-8"><title>test</title></head><body>test</body></html>'); });
  const v = {
    app, kald, offset: 5000,
    live: {} as Testverden['live'],
    ur: { now: () => new Date('2026-10-30T07:05:00Z'), offsetMs: () => v.offset, saetTil() {} },
    moment: () => valgt,
    async hop(id: string) { const m = MOMENTER.find((x) => x.id === id); if (!m) return null; valgt = m; kald.push(`hop ${id}`); return { url: m.url }; },
    async taend() { valgt = MOMENTER[0]!; kald.push('taend'); return { url: valgt.url }; },
  };
  return v as unknown as Testverden & { kald: string[]; offset: number };
}

function opsaet() {
  const real = spionApp();
  const verden = stubVerden();
  let lavet = 0;
  const disp = medTesttilstand(real, async () => { lavet++; return verden; }, tilladAlle);
  const send = (sti: string, o: { metode?: string; keks?: boolean; body?: unknown } = {}): Promise<Response> =>
    Promise.resolve(disp.request(sti, {
      method: o.metode ?? 'GET',
      headers: { ...(o.keks ? { cookie: KEKS } : {}), ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    }));
  return { real, verden, send, lavet: () => lavet };
}

test('without the cookie everything goes to the real app, and the world is never created', async () => {
  const o = opsaet();
  for (const sti of ['/rum/hjem', '/api/data', '/api/udvikling/opgaver?repo=kontrolcenter', '/health']) {
    const r = await o.send(sti);
    assert.equal(r.status, 200);
  }
  assert.deepEqual(o.real.kald, ['GET /rum/hjem', 'GET /api/data', 'GET /api/udvikling/opgaver', 'GET /health']);
  assert.equal(o.lavet(), 0);
  assert.equal(o.verden.kald.length, 0);
});

test('with the cookie requests hit the test world, but /health always hits the real app', async () => {
  const o = opsaet();
  const r = await o.send('/rum/mail', { keks: true });
  assert.match(await r.text(), /<title>test<\/title>/);
  assert.deepEqual(o.verden.kald, ['GET /rum/mail']);
  const j = await (await o.send('/data', { keks: true })).json();
  assert.deepEqual(j, { fra: 'test' });
  const h = await o.send('/health', { keks: true });
  assert.match(await h.text(), /rigtig/);
  assert.deepEqual(o.real.kald, ['GET /health']);
  assert.equal(o.lavet(), 1, 'the world is created once and reused');
});

test('a device that turned test on does not move other devices (no cookie: still the real app)', async () => {
  const o = opsaet();
  const t = await o.send('/test/taend', { metode: 'POST', keks: false });
  assert.equal(t.status, 200);
  const efter = await o.send('/api/udvikling/opgaver?repo=kontrolcenter');
  assert.deepEqual(await efter.json(), { fra: 'rigtig' } satisfies Record<string, string>, 'no cookie: still the real app');
  assert.equal(o.real.kald.at(-1), 'GET /api/udvikling/opgaver');
});

test('lazy: lav() is not called until taend, and taend sets the cookie with the exact attributes', async () => {
  const o = opsaet();
  await o.send('/rum/hjem');
  await o.send('/test/status');
  assert.equal(o.lavet(), 0);
  const r = await o.send('/test/taend', { metode: 'POST' });
  assert.equal(o.lavet(), 1);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('set-cookie'), COOKIE_SAT);
  assert.deepEqual(await r.json(), { url: MOMENTER[0]!.url });
  assert.deepEqual(o.verden.kald, ['taend']);
});

test('sluk clears the cookie and goes home; the world stays in memory', async () => {
  const o = opsaet();
  await o.send('/test/taend', { metode: 'POST' });
  const r = await o.send('/test/sluk', { metode: 'POST', keks: true });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('set-cookie'), COOKIE_RYDDET);
  assert.deepEqual(await r.json(), { url: '/rum/hjem' });
  await o.send('/test/taend', { metode: 'POST' });
  assert.equal(o.lavet(), 1, 'the memoised world is reused');
});

test('moment: 409 without the cookie, 404 for an unknown id, hop with the cookie', async () => {
  const o = opsaet();
  assert.equal((await o.send('/test/moment/moede', { metode: 'POST' })).status, 409);
  assert.equal(o.lavet(), 0);
  assert.equal((await o.send('/test/moment/findesikke', { metode: 'POST', keks: true })).status, 404);
  const r = await o.send('/test/moment/moede', { metode: 'POST', keks: true });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { url: MOMENTER.find((m) => m.id === 'moede')!.url });
});

test('status: off without the cookie, moment list and Copenhagen time with it', async () => {
  const o = opsaet();
  assert.deepEqual(await (await o.send('/test/status')).json(), { til: false });
  const s = await (await o.send('/test/status', { keks: true })).json() as { til: boolean; moment: string; momenter: { id: string; navn: string; tid: string }[]; tid: string };
  assert.equal(s.til, true);
  assert.equal(s.moment, MOMENTER[0]!.id);
  assert.equal(s.tid, '08:05', 'ur.now() 07:05Z is 08:05 in Copenhagen (CET, 2026-10-30)');
  assert.deepEqual(s.momenter, ALLE_MOMENTER.map((m) => ({ id: m.id, navn: m.navn, tid: m.tid })), 'the day, then the world variant kold (KC-0126)');
});

test('creation failure: 503 Danish text with the cookie cleared; the next taend retries', async () => {
  const real = spionApp();
  const verden = stubVerden();
  let forsoeg = 0;
  const disp = medTesttilstand(real, async () => { forsoeg++; if (forsoeg === 1) throw new Error('disk fuld'); return verden; }, tilladAlle);
  const r = await disp.request('/rum/hjem', { headers: { cookie: KEKS } });
  assert.equal(r.status, 503);
  assert.equal(await r.text(), 'Testtilstand kunne ikke starte');
  assert.equal(r.headers.get('set-cookie'), COOKIE_RYDDET);
  const t = await disp.request('/test/taend', { method: 'POST' });
  assert.equal(t.status, 200);
  assert.equal(forsoeg, 2);
});

test('creation failure on taend: 503, no cookie set', async () => {
  const disp = medTesttilstand(spionApp(), async () => { throw new Error('nej'); }, tilladAlle);
  const r = await disp.request('/test/taend', { method: 'POST' });
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('set-cookie'), COOKIE_RYDDET, 'cookie is cleared, never set');
});

test('concurrent requests share one world creation', async () => {
  const real = spionApp();
  const verden = stubVerden();
  let lavet = 0;
  const disp = medTesttilstand(real, async () => { lavet++; await new Promise((r) => setTimeout(r, 20)); return verden; }, tilladAlle);
  const rs = await Promise.all([1, 2, 3].map(() => disp.request('/rum/hjem', { headers: { cookie: KEKS } })));
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
  assert.equal(lavet, 1);
});

test('injection: on test HTML right after <head>, never on real HTML or on JSON', async () => {
  const o = opsaet();
  const test = await (await o.send('/rum/hjem', { keks: true })).text();
  const forventet = '<head><script>window.KC_TEST={"offsetMs":5000,"moment":"morgen","navn":"' + MOMENTER[0]!.navn + '"}</script><script src="/testtilstand.js"></script><link rel="stylesheet" href="/testtilstand.css">';
  assert.ok(test.includes(forventet), test);
  assert.ok(test.indexOf('KC_TEST') < test.indexOf('<meta charset'), 'before everything else in head');
  const rigtig = await (await o.send('/rum/hjem')).text();
  assert.ok(!rigtig.includes('KC_TEST') && !rigtig.includes('testtilstand.js'));
  const json = await (await o.send('/data', { keks: true })).text();
  assert.equal(json, '{"fra":"test"}');
});

test('injection: never into a sandboxed presentation (a /rum/:id/vis/ path, or any response with its own CSP)', async () => {
  const o = opsaet();
  for (const sti of ['/rum/univers-havvind-nord/vis/dok-1.html', '/rum/x/vis/y', '/csp']) {
    const r = await o.send(sti, { keks: true });
    assert.equal(r.status, 200, sti);
    assert.equal(await r.text(), VIS_HTML, `${sti} comes back byte-identical`);
  }
  assert.ok((await (await o.send('/rum/x', { keks: true })).text()).includes('KC_TEST'), 'an ordinary page still gets the band');
});

test('injection JSON-encodes the object and cannot close the script tag', async () => {
  const real = spionApp();
  const verden = stubVerden();
  const m = { ...MOMENTER[0]!, id: 'x</script><b>', navn: 'Vågner </script>' };
  (verden as unknown as { moment: () => typeof m }).moment = () => m;
  const disp = medTesttilstand(real, async () => verden, tilladAlle);
  const html = await (await disp.request('/rum/hjem', { headers: { cookie: KEKS } })).text();
  const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  assert.ok(script.startsWith('window.KC_TEST='));
  assert.ok(!script.includes('<'), 'every < is escaped');
  assert.equal(html.split('</script>').length, 3, 'exactly the two script tags close');
  const obj = new Function(`const window = {}; ${script}; return window.KC_TEST;`)();
  assert.equal(obj.moment, 'x</script><b>');
  assert.equal(obj.navn, 'Vågner </script>');
});

test('chat switch: "tænd testtilstand" with aabn turns it on and navigates; other chat passes through', async () => {
  const o = opsaet();
  const r = await o.send('/api/rum/hjem/chat', { metode: 'POST', body: { besked: 'tænd testtilstand', aabn: true } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { aabn: MOMENTER[0]!.url, testtilstand: 'til' });
  assert.equal(r.headers.get('set-cookie'), COOKIE_SAT);
  assert.equal(o.real.kald.length, 0);
  // without aabn it is just a sentence for Hermes
  const p = await o.send('/api/rum/hjem/chat', { metode: 'POST', body: { besked: 'tænd testtilstand' } });
  assert.equal(p.status, 200);
  assert.deepEqual(o.real.kald, ['POST /api/rum/hjem/chat']);
  const q = await o.send('/api/rum/hjem/chat', { metode: 'POST', body: { besked: 'åbn mail', aabn: true } });
  assert.equal(q.status, 200);
  assert.deepEqual(o.real.kald, ['POST /api/rum/hjem/chat', 'POST /api/rum/hjem/chat']);
});

test('chat switch on while already on keeps the world and goes to the current moment', async () => {
  const o = opsaet();
  await o.send('/test/taend', { metode: 'POST' });
  await o.send('/test/moment/moede', { metode: 'POST', keks: true });
  const r = await o.send('/api/rum/hjem/chat', { metode: 'POST', keks: true, body: { besked: 'tænd testtilstand', aabn: true } });
  assert.deepEqual(await r.json(), { aabn: MOMENTER.find((m) => m.id === 'moede')!.url, testtilstand: 'til' });
  assert.deepEqual(o.verden.kald, ['taend', 'hop moede']);
});

test('chat switch off: clears the cookie and goes home', async () => {
  const o = opsaet();
  const r = await o.send('/api/rum/hjem/chat', { metode: 'POST', keks: true, body: { besked: 'sluk testtilstand', aabn: true } });
  assert.deepEqual(await r.json(), { aabn: '/rum/hjem', testtilstand: 'fra' });
  assert.equal(r.headers.get('set-cookie'), COOKIE_RYDDET);
});

test('chat in the test world is answered by the world, not the real app', async () => {
  const o = opsaet();
  await o.send('/api/rum/hjem/chat', { metode: 'POST', keks: true, body: { besked: 'hej' } });
  assert.deepEqual(o.verden.kald, ['POST /api/rum/hjem/chat']);
  assert.equal(o.real.kald.length, 0);
});

test('erTestBesked: positives, negatives, tolerant of case and diacritics', () => {
  for (const b of ['tænd testtilstand', 'Tænd testtilstand', 'taend testtilstand', 'slå testdata til', 'Slå testdata til!', 'slaa testdata til', 'testtilstand til', 'tænd testdata']) assert.equal(erTestBesked(b), 'til', b);
  for (const b of ['sluk testtilstand', 'Sluk testtilstanden.', 'slå testdata fra', 'slaa testdata fra', 'testtilstand fra', 'testdata fra']) assert.equal(erTestBesked(b), 'fra', b);
  for (const b of ['test', 'hvad er testtilstand', 'tænd lyset', 'sluk lyset', 'jeg vil gerne have testtilstand forklaret', 'tænd testtilstand og åbn mail', '']) assert.equal(erTestBesked(b), null, b);
});

test('after the world is built, a hop/status/forward error is a plain 500 that keeps the cookie', async () => {
  const real = spionApp();
  const verden = stubVerden();
  const bryd = (): never => { throw new Error('hop gik galt'); };
  (verden as unknown as { hop: () => never }).hop = bryd;
  (verden as unknown as { moment: () => never }).moment = bryd;
  (verden as unknown as { app: { fetch: () => never } }).app = { fetch: bryd };
  const disp = medTesttilstand(real, async () => verden, tilladAlle);
  const orig = console.error;
  console.error = () => {};
  try {
    for (const [sti, metode] of [['/test/moment/moede', 'POST'], ['/test/status', 'GET'], ['/rum/hjem', 'GET']] as const) {
      const r = await disp.request(sti, { method: metode, headers: { cookie: KEKS } });
      assert.equal(r.status, 500, sti);
      assert.equal(await r.text(), 'Testtilstand fejlede');
      assert.equal(r.headers.get('set-cookie'), null, `${sti} keeps the cookie`);
    }
  } finally { console.error = orig; }
});

test('a failed creation is logged with its cause', async () => {
  const disp = medTesttilstand(spionApp(), async () => { throw new Error('disk fuld'); }, tilladAlle);
  const logget: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { logget.push(a); };
  try { await disp.request('/rum/hjem', { headers: { cookie: KEKS } }); } finally { console.error = orig; }
  assert.equal(logget.length, 1);
  assert.match(String(logget[0]![0]), /^testtilstand:/);
  assert.match(String(logget[0]![1]), /disk fuld/);
});

test('cookie parsing: only an exact kc_test=1 pair counts', async () => {
  for (const [keks, test] of [['kc_test=10', false], ['xkc_test=1', false], ['a=kc_test=1', false], ['foo=1; kc_test=1', true], ['kc_test=1; foo=2', true], [' kc_test=1 ', true]] as const) {
    const o = opsaet();
    const rr = await Promise.resolve(medTesttilstand(o.real, async () => o.verden, tilladAlle).request('/rum/hjem', { headers: { cookie: keks } }));
    assert.equal((await rr.text()).includes('<title>test</title>'), test, keks);
  }
});

test('testDataDir: a sibling ending in -test, never inside the real dir; an explicit KC_TEST_DATA_DIR wins', () => {
  for (const d of ['./data', './data/', '/home/x/kontrolcenter-data/']) {
    const t = testDataDir({ KC_DATA_DIR: d });
    assert.equal(t, path.resolve(d) + '-test', d);
    assert.ok(t.endsWith('-test') && !t.startsWith(path.resolve(d) + path.sep), d);
  }
  assert.equal(testDataDir({}), path.resolve('./data') + '-test');
  assert.equal(testDataDir({ KC_DATA_DIR: './data', KC_TEST_DATA_DIR: '/srv/mit-test' }), '/srv/mit-test');
  assert.equal(testDataDir({ KC_DATA_DIR: './data', KC_TEST_DATA_DIR: '' }), path.resolve('./data') + '-test');
});

// Stale tabs: every page declares its own mode on its fetches (x-kc-tilstand); a write whose page
// disagrees with the device's cookie is refused (409) and routed nowhere, so the page reloads.
const SKIFTET = 'Testtilstand er skiftet — genindlæs siden.';
function medTilstand(o: ReturnType<typeof opsaet>['real'], v: ReturnType<typeof stubVerden>) {
  const disp = medTesttilstand(o, async () => v, tilladAlle);
  return (sti: string, metode: string, tilstand: 'test' | 'real' | null, keks: boolean, body?: unknown): Promise<Response> =>
    Promise.resolve(disp.request(sti, {
      method: metode,
      headers: {
        ...(tilstand ? { 'x-kc-tilstand': tilstand } : {}),
        ...(keks ? { cookie: KEKS } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
}

test('stale test tab (header test, no cookie): a POST is 409 and never reaches the real app', async () => {
  const o = opsaet();
  const send = medTilstand(o.real, o.verden);
  for (const sti of ['/api/rum/hjem/chat', '/api/udvikling/opgaver', '/api/rum/skrive/aktion/x']) {
    const r = await send(sti, 'POST', 'test', false, { besked: 'hej' });
    assert.equal(r.status, 409, sti);
    assert.equal(await r.text(), SKIFTET);
    assert.equal(r.headers.get('x-kc-tilstand-skiftet'), '1');
    assert.equal(r.headers.get('set-cookie'), null);
  }
  assert.deepEqual(o.real.kald, [], 'the real app was never called');
  assert.deepEqual(o.verden.kald, []);
});

test('stale real tab (header real, cookie set): a POST is 409 and never reaches the world', async () => {
  const o = opsaet();
  const send = medTilstand(o.real, o.verden);
  const r = await send('/api/rum/hjem/chat', 'POST', 'real', true, { besked: 'hej' });
  assert.equal(r.status, 409);
  assert.equal(await r.text(), SKIFTET);
  assert.deepEqual(o.verden.kald, [], 'the world was never asked');
  assert.deepEqual(o.real.kald, []);
});

test('a matching header routes as before', async () => {
  const o = opsaet();
  const send = medTilstand(o.real, o.verden);
  assert.equal((await send('/api/rum/hjem/chat', 'POST', 'real', false, { besked: 'hej' })).status, 200);
  assert.deepEqual(o.real.kald, ['POST /api/rum/hjem/chat']);
  assert.equal((await send('/api/rum/hjem/chat', 'POST', 'test', true, { besked: 'hej' })).status, 200);
  assert.deepEqual(o.verden.kald, ['POST /api/rum/hjem/chat']);
});

test('no header (the worker, curl, the morning timer): cookie routing as before', async () => {
  const o = opsaet();
  const send = medTilstand(o.real, o.verden);
  assert.equal((await send('/api/udvikling/opgaver', 'POST', null, false, {})).status, 200);
  assert.deepEqual(o.real.kald, ['POST /api/udvikling/opgaver']);
  assert.equal((await send('/api/udvikling/opgaver', 'POST', null, true, {})).status, 200);
  assert.deepEqual(o.verden.kald, ['POST /api/udvikling/opgaver']);
});

test('a GET with a mismatching header is cookie-routed (read-only, no 409)', async () => {
  const o = opsaet();
  const send = medTilstand(o.real, o.verden);
  const r = await send('/api/rum/hjem/fragment', 'GET', 'test', false);
  assert.equal(r.status, 200);
  assert.deepEqual(o.real.kald, ['GET /api/rum/hjem/fragment']);
  const t = await send('/rum/hjem', 'GET', 'real', true);
  assert.equal(t.status, 200);
  assert.deepEqual(o.verden.kald, ['GET /rum/hjem']);
});

test('the switch still works from a stale tab: taend from a real page, sluk from a test page, either way round', async () => {
  const o = opsaet();
  const send = medTilstand(o.real, o.verden);
  // taend from a real page while the cookie is already set (another tab turned it on)
  const t = await send('/test/taend', 'POST', 'real', true);
  assert.equal(t.status, 200);
  assert.equal(t.headers.get('set-cookie'), COOKIE_SAT);
  // taend from a test page whose cookie expired
  assert.equal((await send('/test/taend', 'POST', 'test', false)).status, 200);
  // sluk from a test page after another tab already turned it off
  const s = await send('/test/sluk', 'POST', 'test', false);
  assert.equal(s.status, 200);
  assert.equal(s.headers.get('set-cookie'), COOKIE_RYDDET);
  // sluk from a real page while the cookie is set
  assert.equal((await send('/test/sluk', 'POST', 'real', true)).status, 200);
  // the chat phrase, both directions, from stale tabs
  const fra = await send('/api/rum/hjem/chat', 'POST', 'test', false, { besked: 'sluk testtilstand', aabn: true });
  assert.deepEqual(await fra.json(), { aabn: '/rum/hjem', testtilstand: 'fra' });
  const til = await send('/api/rum/hjem/chat', 'POST', 'real', true, { besked: 'tænd testtilstand', aabn: true });
  assert.equal(til.status, 200);
  assert.equal(((await til.json()) as { testtilstand: string }).testtilstand, 'til');
  assert.deepEqual(o.real.kald, []);
});

test('a moment pick from a stale test tab (cookie gone) is the reload 409, not a world hop', async () => {
  const o = opsaet();
  const send = medTilstand(o.real, o.verden);
  const r = await send('/test/moment/moede', 'POST', 'test', false);
  assert.equal(r.status, 409);
  assert.equal(r.headers.get('x-kc-tilstand-skiftet'), '1');
  assert.equal(o.lavet(), 0);
});
