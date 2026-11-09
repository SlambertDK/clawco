// KC-0268: a request from another site, another origin or another host never changes anything. On the tailnet the
// person's identity is ambient (Tailscale Serve stamps it on every request, cookie or not), so a hostile page open in
// the owner's browser could otherwise post "as the owner". Invariants: every method but GET/HEAD/OPTIONS is refused
// when the browser says the request is cross-site (Sec-Fetch-Site) or its Origin does not match the host it reached;
// a JSON route refuses a body whose declared type is not JSON (a no-cors text/plain form post never parses); in laptop
// mode the Host must be this machine (DNS rebinding reads nothing); every page carries frame-ancestors 'none' and
// nosniff; bodies are capped; one person holds at most a few live streams; the test world sits behind the same
// identity decision as the real app and refuses guests and support.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { skrivHusstand } from '../src/identitet/husstand.ts';
import { medTesttilstand } from '../src/testtilstand/kontakt.ts';
import { fremmedGrund, erJsonKrop } from '../src/shell/fremmed.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-fremmed-'));
after(() => rm(rod, { recursive: true, force: true }));
const ROD = fileURLToPath(new URL('..', import.meta.url));
const publicDir = path.relative(process.cwd(), path.join(ROD, 'public'));
const noMail = { mailRunner: async () => ({ code: 1, stdout: '', stderr: 'ingen' }), mailStateDir: '/nonexistent' };
const LOOPBACK = { incoming: { socket: { remoteAddress: '127.0.0.1' } } };

function lav(navn: string, extra: Record<string, unknown> = {}) {
  const dataDir = path.join(rod, navn);
  return { dataDir, sut: createApp({ store: createFileStore(dataDir), hermes: createFakeAgent({ answer: () => 'ok' }), sourceGlob: '/nonexistent/{date}.json', dataDir, sha: 'abc', publicDir, ...noMail, ...extra }) };
}
const post = (sut: ReturnType<typeof lav>['sut'], sti: string, headers: Record<string, string>, body = '{}') =>
  sut.app.request(sti, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body }, LOOPBACK);

test('fremmedGrund: cross-site and foreign-origin writes are named; reads, same-origin and header-less callers are not', () => {
  const req = (m: string, h: Record<string, string>, url = 'http://localhost:8750/api/x') => new Request(url, { method: m, headers: h });
  assert.equal(fremmedGrund(req('POST', { 'sec-fetch-site': 'cross-site' }), {}), 'side');
  assert.equal(fremmedGrund(req('POST', { 'sec-fetch-site': 'same-site' }), {}), 'side');
  assert.equal(fremmedGrund(req('PUT', { origin: 'https://evil.example' }), {}), 'oprindelse');
  assert.equal(fremmedGrund(req('DELETE', { origin: 'http://localhost:8751' }), {}), 'oprindelse');
  assert.equal(fremmedGrund(req('POST', { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:8750' }), {}), null);
  assert.equal(fremmedGrund(req('POST', { 'sec-fetch-site': 'none' }), {}), null);
  assert.equal(fremmedGrund(req('POST', {}), {}), null, 'curl, the worker and the timers send neither header');
  assert.equal(fremmedGrund(req('GET', { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), {}), null, 'a link from another site is a read');
  assert.equal(fremmedGrund(req('HEAD', { 'sec-fetch-site': 'cross-site' }), {}), null);
  assert.equal(fremmedGrund(req('OPTIONS', { 'sec-fetch-site': 'cross-site' }), {}), null);
  // Laptop mode: the host must be this machine (or the configured address); any other name is DNS rebinding.
  assert.equal(fremmedGrund(req('GET', {}, 'http://evil.example/rum/hjem'), { laptop: true }), 'vaert');
  assert.equal(fremmedGrund(req('GET', {}, 'http://127.0.0.1:8750/rum/hjem'), { laptop: true }), null);
  assert.equal(fremmedGrund(req('GET', {}, 'http://[::1]:8750/rum/hjem'), { laptop: true }), null);
  assert.equal(fremmedGrund(req('GET', {}, 'http://min.maskine:8750/rum/hjem'), { laptop: true, adresse: 'http://min.maskine:8750' }), null);
  assert.equal(fremmedGrund(req('GET', {}, 'http://evil.example/rum/hjem'), { adresse: 'https://kontrol.example.ts.net' }), 'vaert', 'with an address set, every mode checks the host');
  assert.equal(fremmedGrund(req('GET', {}, 'https://kontrol.example.ts.net/rum/hjem'), { adresse: 'https://kontrol.example.ts.net' }), null);
  assert.equal(fremmedGrund(req('GET', {}, 'http://evil.example/rum/hjem'), {}), null, 'no address, not laptop: the proxy owns the host (tailnet, Docker)');
  assert.equal(fremmedGrund(req('GET', {}, 'http://evil.example/health'), { laptop: true }), null, '/health answers the deploy script whatever the name');
  assert.equal(erJsonKrop(req('POST', {})), true);
  assert.equal(erJsonKrop(req('POST', { 'content-type': 'application/json; charset=utf-8' })), true);
  assert.equal(erJsonKrop(req('POST', { 'content-type': 'text/plain;charset=UTF-8' })), false, 'what fetch sends for a no-cors string body');
  assert.equal(erJsonKrop(req('POST', { 'content-type': 'application/x-www-form-urlencoded' })), false);
});

test('every write route refuses a cross-site or foreign-origin request before any handler runs', async () => {
  const { sut } = lav('skriv');
  const ruter = ['/api/rum/hjem/chat', '/api/indstillinger', '/api/nodstop', '/api/udvikling/opgaver', '/api/kilder/x/forbind', '/api/rum/hjem/opdater', '/api/graense/ja', '/api/stemme/sig'];
  for (const sti of ruter) {
    const a = await post(sut, sti, { 'sec-fetch-site': 'cross-site' }, '{"besked":"hej"}');
    assert.equal(a.status, 403, `${sti} cross-site`);
    assert.match(await a.text(), /fra en anden side/i);
    const b = await post(sut, sti, { origin: 'https://evil.example' }, '{"besked":"hej"}');
    assert.equal(b.status, 403, `${sti} foreign origin`);
  }
  // The same calls from the app itself are not refused by the guard (whatever the handler then answers).
  const ok = await post(sut, '/api/indstillinger', { 'sec-fetch-site': 'same-origin', origin: 'http://localhost' }, '{}');
  assert.equal(ok.status, 200);
  const curl = await post(sut, '/api/indstillinger', {}, '{}');
  assert.equal(curl.status, 200, 'no browser headers: a local script');
  const get = await sut.app.request('/rum/hjem', { headers: { 'sec-fetch-site': 'cross-site' } }, LOOPBACK);
  assert.equal(get.status, 200, 'a read from a link on another site is fine');
});

test('a JSON route refuses a body declared as anything but JSON (415), and accepts an undeclared one', async () => {
  const { sut } = lav('json');
  const tekst = await sut.app.request('/api/indstillinger', { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: '{}' }, LOOPBACK);
  assert.equal(tekst.status, 415);
  const form = await sut.app.request('/api/rum/hjem/chat', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'besked=hej' }, LOOPBACK);
  assert.equal(form.status, 415);
  const udenType = new Request('http://localhost/api/indstillinger', { method: 'POST', body: '{}' });
  udenType.headers.delete('content-type'); // a Request with a string body declares text/plain by itself; a script need not
  const uden = await sut.app.request(udenType, undefined, LOOPBACK);
  assert.notEqual(uden.status, 415);
  const json = await post(sut, '/api/indstillinger', {}, '{}');
  assert.equal(json.status, 200);
});

test('every response carries frame-ancestors none, nosniff and no referrer; a presentation keeps its own CSP', async () => {
  const { sut } = lav('hoveder');
  for (const sti of ['/rum/hjem', '/api/indstillinger', '/health', '/manifest.webmanifest']) {
    const r = await sut.app.request(sti, {}, LOOPBACK);
    assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/, sti);
    assert.match(r.headers.get('content-security-policy') ?? '', /base-uri 'none'/, sti);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', sti);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer', sti);
  }
});

test('a body over the cap is refused with 413 before it is read', async () => {
  const { sut } = lav('stor');
  const r = await post(sut, '/api/indstillinger', {}, `{"x":"${'a'.repeat(1024 * 1024 + 10)}"}`);
  assert.equal(r.status, 413);
  const lille = await post(sut, '/api/indstillinger', {}, `{"x":"${'a'.repeat(1000)}"}`);
  assert.equal(lille.status, 200);
});

test('laptop mode: a request for another host name is refused (DNS rebinding), this machine is not', async () => {
  const { sut } = lav('laptop', { laptop: true, adresse: 'http://localhost:8750' });
  const fremmed = await sut.app.request(new Request('http://evil.example/rum/hjem'), undefined, LOOPBACK);
  assert.equal(fremmed.status, 403);
  const api = await sut.app.request(new Request('http://evil.example/api/indstillinger'), undefined, LOOPBACK);
  assert.equal(api.status, 403);
  assert.match(await api.text(), /adresse/i);
  const egen = await sut.app.request(new Request('http://localhost:8750/rum/hjem'), undefined, LOOPBACK);
  assert.equal(egen.status, 200);
  const loop = await sut.app.request(new Request('http://127.0.0.1:8750/rum/hjem'), undefined, LOOPBACK);
  assert.equal(loop.status, 200);
  const health = await sut.app.request(new Request('http://evil.example/health'), undefined, LOOPBACK);
  assert.equal(health.status, 200);
});

test('one person holds at most 20 live streams; the next is refused with 429 and a closed one frees a slot', async () => {
  const { sut } = lav('sse');
  const aabne: Response[] = [];
  for (let i = 0; i < 20; i++) {
    const r = await sut.app.request('/api/live', {}, LOOPBACK);
    assert.equal(r.status, 200, `stream ${i}`);
    aabne.push(r);
  }
  const nr21 = await sut.app.request('/api/live', {}, LOOPBACK);
  assert.equal(nr21.status, 429);
  await aabne[0]!.body!.cancel();
  await new Promise((r) => setTimeout(r, 20));
  const igen = await sut.app.request('/api/live', {}, LOOPBACK);
  assert.equal(igen.status, 200);
  aabne.push(igen);
  for (const r of aabne.slice(1)) await r.body?.cancel();
});

test('the test world sits behind the identity decision: cross-site, a guest and support cannot switch it on', async () => {
  const { sut, dataDir } = lav('testverden');
  await skrivHusstand(dataDir, { personer: [
    { id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' },
    { id: 'gaest', login: 'gaest@example.com', navn: 'Gæst', rolle: 'gaest' },
  ] });
  let lavet = 0;
  const disp = medTesttilstand(sut.app, async () => { lavet++; throw new Error('må ikke nås'); }, sut.adgang);
  const som = (login: string, extra: Record<string, string> = {}) => ({ method: 'POST', headers: { 'Tailscale-User-Login': login, 'Tailscale-User-Name': 'X', ...extra } });
  const kryds = await disp.request('/test/taend', som('henrik@example.com', { 'sec-fetch-site': 'cross-site' }), LOOPBACK);
  assert.equal(kryds.status, 403);
  const ukendt = await disp.request('/test/taend', som('nogen@example.com'), LOOPBACK);
  assert.equal(ukendt.status, 403);
  const gaest = await disp.request('/test/taend', som('gaest@example.com'), LOOPBACK);
  assert.equal(gaest.status, 403);
  const cookie = await disp.request('/rum/hjem', { headers: { cookie: 'kc_test=1', 'Tailscale-User-Login': 'gaest@example.com', 'Tailscale-User-Name': 'X' } }, LOOPBACK);
  assert.equal(cookie.status, 403, 'a cookie alone opens nothing');
  assert.equal(lavet, 0, 'the world was never built for them');
  const ejer = await disp.request('/test/taend', som('henrik@example.com'), LOOPBACK);
  assert.equal(ejer.status, 503, 'the owner reaches the world (which this test refuses to build: 503 and the cookie cleared)');
  assert.equal(lavet, 1);
});

test('the test cookie is Secure when the app is reached over https; the test panel is still injected under the general CSP', async () => {
  const { sut } = lav('cookie');
  const side = { fetch: async () => new Response('<html><head></head><body>verden</body></html>', { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "frame-ancestors 'none'; base-uri 'none'" } }) };
  const verden = { taend: async () => ({ url: '/rum/hjem' }), moment: () => ({ id: 'x', navn: 'X', url: '/rum/hjem' }), ur: { now: () => new Date(), offsetMs: () => 0 }, app: side } as never;
  const disp = medTesttilstand(sut.app, async () => verden, sut.adgang);
  const medCookie = await disp.request('/rum/hjem', { headers: { cookie: 'kc_test=1' } }, LOOPBACK);
  assert.equal(medCookie.status, 200);
  assert.match(await medCookie.text(), /window\.KC_TEST=/, 'the panel tags go in although every response now carries a CSP');
  const https = await disp.request(new Request('https://kontrol.example.ts.net/test/taend', { method: 'POST' }), undefined, LOOPBACK);
  assert.match(https.headers.get('set-cookie') ?? '', /; Secure/);
  const http = await disp.request(new Request('http://localhost:8750/test/taend', { method: 'POST' }), undefined, LOOPBACK);
  assert.doesNotMatch(http.headers.get('set-cookie') ?? '', /; Secure/);
});

test('KC-0280: the test world answers on the real app\'s own https address; a foreign host, a cross-site write and an unknown login still get nothing', async () => {
  const ADR = 'https://kontrol.example.ts.net';
  const { sut, dataDir } = lav('adresse', { adresse: ADR });
  await skrivHusstand(dataDir, { personer: [{ id: 'henrik', login: 'henrik@example.com', navn: 'Henrik', rolle: 'ejer' }] });
  const { lavTestverden } = await import('../src/testtilstand/verden.ts');
  const verden = await lavTestverden({ dataDir: path.join(rod, 'adresse-test'), publicDir, rigtigDataDir: dataDir });
  const disp = medTesttilstand(sut.app, async () => verden, sut.adgang);
  const taend = await disp.request(new Request(`${ADR}/test/taend`, { method: 'POST' }), undefined, LOOPBACK);
  assert.equal(taend.status, 200);
  const side = await disp.request(new Request(`${ADR}/rum/hjem`, { headers: { cookie: 'kc_test=1' } }), undefined, LOOPBACK);
  assert.equal(side.status, 200, 'the world is served under the host the real app was reached on (its own fictional address is not the host rule)');
  assert.match(await side.text(), /window\.KC_TEST=/);
  const fremmedVaert = await disp.request(new Request('https://evil.example/rum/hjem', { headers: { cookie: 'kc_test=1' } }), undefined, LOOPBACK);
  assert.equal(fremmedVaert.status, 403, 'a foreign host never reaches the world (the real app judges the host first)');
  const kryds = await disp.request(new Request(`${ADR}/test/taend`, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }), undefined, LOOPBACK);
  assert.equal(kryds.status, 403);
  const nogen = { 'Tailscale-User-Login': 'nogen@example.com', 'Tailscale-User-Name': 'X' };
  const ukendtTaend = await disp.request(new Request(`${ADR}/test/taend`, { method: 'POST', headers: nogen }), undefined, LOOPBACK);
  assert.equal(ukendtTaend.status, 403, 'a stranger on the tailnet cannot start the world on the right host either');
  const ukendtSide = await disp.request(new Request(`${ADR}/rum/hjem`, { headers: { cookie: 'kc_test=1', ...nogen } }), undefined, LOOPBACK);
  assert.equal(ukendtSide.status, 403, 'nor read it with the cookie');
});
