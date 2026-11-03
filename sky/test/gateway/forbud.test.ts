// KC-0183: what the gateway never does — forward /health or /_sky/, pass identity or our cookie inbound, let a
// tenant set our cookie, or log a path, query string, cookie, header or body (AGENTS §0, D16).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aldrigVidere, rensInd, rensUd, logLinje } from '../../src/gateway/forbud.ts';
import { udstedToken } from '../../src/gateway/cookie.ts';
import { laesGatewayNoegle } from '../../src/gateway/noegle.ts';
import { ruteTabel } from '../../src/gateway/rute.ts';
import { FROE, opsaet } from './hjaelp.ts';
import { anmod, falskTenant, startGateway } from './net.ts';

test('aldrigVidere: /health and /_sky in every spelling; ordinary paths pass', () => {
  for (const s of ['/health', '/health/', '//health', '/%68ealth', '/HEALTH', '/_sky', '/_sky/', '/_sky/faa', '/%5fsky/x', '/x/../health']) assert.equal(aldrigVidere(s), true, s);
  for (const s of ['/', '/rum/mail', '/healthy', '/api/health', '/_skyx']) assert.equal(aldrigVidere(s), false, s);
});

test('rensInd strips identity, forwarding, Cloudflare and hop-by-hop headers and our cookie; keeps the rest', () => {
  const ud = rensInd({
    host: 'h', accept: 'text/html', 'content-type': 'a/b', 'content-length': '3', 'last-event-id': '7',
    'clawco-konto': 'x', 'tailscale-user-login': 'x', 'x-forwarded-for': 'x', 'x-forwarded-proto': 'x', forwarded: 'x', 'x-real-ip': 'x',
    'true-client-ip': 'x', 'cf-connecting-ip': 'x', 'cf-ray': 'x', 'cdn-loop': 'x', connection: 'keep-alive, x-hemmelig', 'x-hemmelig': 'x',
    'keep-alive': 'x', 'proxy-authorization': 'x', te: 'x', trailer: 'x', 'transfer-encoding': 'chunked', upgrade: 'x',
    cookie: '__Host-clawco=t; __Host-a=1',
  });
  assert.deepEqual(ud, { host: 'h', accept: 'text/html', 'content-type': 'a/b', 'content-length': '3', 'last-event-id': '7', cookie: 'a=1' });
});

test('rensUd drops hop-by-hop headers and any Set-Cookie of our cookie, keeps content and cache headers', () => {
  const ud = rensUd({
    'content-type': 'text/event-stream', 'cache-control': 'no-cache', etag: '"x"', connection: 'close', 'transfer-encoding': 'chunked', 'keep-alive': 'x',
    'set-cookie': ['__Host-clawco=x; Path=/', 'a=1'],
  });
  assert.deepEqual(ud, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', etag: '"x"', 'set-cookie': ['__Host-a=1; Path=/; Secure'] });
});

// KC-0272 (D2): every tenant, konto. and the apex are one site, so a cookie another *.clawco.work host set with
// Domain= arrives here too (kc_test=1, say). The server cannot see a cookie's Domain, so the gateway keeps a
// tenant's cookies host-only itself: what a tenant sets goes out as __Host-<name> (no Domain, Path=/, Secure),
// and only __Host- cookies come back in, unprefixed. A sibling host cannot set a __Host- cookie here.
test('KC-0272: a tenant only ever receives its own host-only cookies; nothing set by a sibling host', () => {
  const ind = rensInd({ cookie: 'kc_test=1; __Host-kc_test=1; __Host-clawco=t; __Host-sky-faa=b; x=2; __Host-=3; __Host-y=4' });
  assert.deepEqual(ind, { cookie: 'kc_test=1; y=4' });
  assert.deepEqual(rensInd({ cookie: 'kc_test=1; andet=2' }), {}, 'only sibling-reachable cookies: no Cookie header at all');
});

test('KC-0272: a tenant\'s Set-Cookie goes out host-only (__Host-, Path=/, Secure, no Domain); never as one of the gateway\'s cookies', () => {
  const ud = rensUd({ 'set-cookie': [
    'kc_test=1; Domain=eksempel.test; Path=/rum; SameSite=Lax; HttpOnly; Max-Age=5',
    'kc_test=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0; Secure',
    'clawco=x; Path=/', 'sky-faa=y', '__Host-clawco=z; Path=/; Secure', '=tom',
  ] });
  assert.deepEqual(ud, { 'set-cookie': [
    '__Host-kc_test=1; SameSite=Lax; HttpOnly; Max-Age=5; Path=/; Secure',
    '__Host-kc_test=; SameSite=Lax; HttpOnly; Max-Age=0; Path=/; Secure',
  ] });
});

test('logLinje has method, slug, status, duration and konto id only', () => {
  assert.equal(logLinje({ metode: 'GET', slug: 'hus-abcdefgh', status: 200, ms: 12.6, konto: 4 }), 'gateway: GET hus-abcdefgh 200 13ms konto=4');
  assert.equal(logLinje({ metode: 'POST', slug: 'hus-abcdefgh', status: 302, ms: 1, konto: null }), 'gateway: POST hus-abcdefgh 302 1ms konto=-');
  assert.equal(logLinje({ metode: 'GET\nfalsk', slug: 'hus-abcdefgh', status: 200, ms: 1, konto: 1 }), 'gateway: ? hus-abcdefgh 200 1ms konto=1');
});

test('real requests leave log lines with no path, query string, cookie, header or body', async () => {
  const t = await falskTenant();
  const o = await opsaet(t.adresse);
  const log: string[] = [];
  const noegle = laesGatewayNoegle({ SKY_GATEWAY_SIGNERINGSNOEGLE: FROE }, null).noegle!;
  const gw = await startGateway({ db: o.db, publicUrl: 'https://konto.eksempel.test', basedomain: 'eksempel.test', noegle, ruter: ruteTabel({ db: o.db }), samtykkeOk: async () => true, log: (s) => log.push(s), nu: o.ur.nu });
  try {
    const token = udstedToken(noegle.cookie, { t: o.slug, k: o.ejer.id, s: o.ejer.sessionId, e: o.ejer.email }, o.ur.nu());
    const host = `${o.slug}.eksempel.test`;
    await anmod(gw.port, { host, sti: '/rum/hemmelig-sti?q=hemmelig-query', metode: 'POST', krop: 'hemmelig-krop', headers: { cookie: `__Host-clawco=${token}; andet=hemmelig-cookie`, 'x-hemmelig': 'hemmelig-header', origin: `https://${host}` } });
    await anmod(gw.port, { host, sti: '/rum/hemmelig-sti?q=hemmelig-query' });
    await anmod(gw.port, { host, sti: '/_sky/faa?kode=hemmelig-kode' });
    assert.equal(log.length, 3);
    for (const l of log) {
      assert.match(l, /^gateway: (GET|POST) hus-abcdefgh \d{3} \d+ms konto=(\d+|-)$/);
      for (const naal of ['hemmelig', token, 'rum', '?', o.ejer.email]) assert.ok(!l.includes(naal), `${naal} in ${l}`);
    }
    assert.match(log[0]!, / 200 .*konto=\d+$/);
  } finally { await gw.luk(); await t.luk(); await o.db.close(); }
});

// KC-0246: Google sends the browser back to <tenant origin>/api/kilder/<id>/tilbage (src/kilder/google/oauth.ts, the tenant's
// route in src/server.ts). The gateway must forward it — the browser carries the tenant cookie on that top-level GET.
test('KC-0246 aldrigVidere: the OAuth callback of the Google connectors is forwarded to the tenant', () => {
  for (const s of ['/api/kilder/google-kalender/tilbage?state=a&code=b', '/api/kilder/mail-gmail/tilbage?state=a&code=b']) assert.equal(aldrigVidere(new URL(s, 'http://x.invalid').pathname), false, s);
});

test('KC-0264 aldrigVidere: the model proxy path is never forwarded to a tenant from its public host, in any spelling', () => {
  for (const s of ['/model', '/model/', '/model/v1/messages', '/MODEL/v1/forbrug', '/%6dodel/v1/messages', '//model/v1', '/x/../model/v1/messages']) assert.equal(aldrigVidere(s), true, s);
  for (const s of ['/models', '/rum/model', '/modeller']) assert.equal(aldrigVidere(s), false, s);
});
