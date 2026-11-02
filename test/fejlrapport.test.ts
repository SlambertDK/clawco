// KC-0187 invariant (AGENTS §0 r7, spec D16): nothing a customer typed or received can leave a tenant through an error
// report; if scrubbing throws the event is dropped, never sent raw; a tenant with no KC_FEJLRAPPORT_DSN sends nothing at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/server.ts';
import { createFileStore } from '../src/store/fileStore.ts';
import { createFakeAgent } from '../src/agent/fake.ts';
import { rens, konvolut, laesDsn, lavFejlrapport, medSikkerBesked, sentryTransport, type Haendelse, type RaaHaendelse } from '../src/shell/fejlrapport-kerne.ts';
import { tenantFejlrapport } from '../src/shell/fejlrapport.ts';

const fil = (rel: string): Buffer => readFileSync(new URL(rel, import.meta.url));

// Invented markers, one per kind of content that must never leave. The key is a fake shaped like a provider's.
const M = {
  prompt: 'MARKOER-PROMPT skriv et digt til Maja om ferien',
  mail: 'MARKOER-MAILKROP Kære Maja, her er kontrakten',
  email: 'markoer.maja@example.com',
  noegle: 'sk-ant-api03-MARKOERfalskNoegle0123456789abcdefABCDEF', // gitleaks:allow
  cookie: 'kc_session=MARKOERcookie0123456789',
};
const INGEN_MARKOER = /markoer/i;

/** Every place an SDK or a careless caller could put content: message, own properties, cause, extra, request, breadcrumbs, locals. */
function fyldtHaendelse(): RaaHaendelse {
  const fejl = new Error(`Hermes fejlede for ${M.email} med ${M.prompt}: ${M.mail}`) as Error & Record<string, unknown>;
  fejl.name = 'MARKOERnavn';
  fejl['code'] = 'markoer-kode';
  fejl['body'] = M.mail;
  fejl['headers'] = { cookie: M.cookie, authorization: `Bearer ${M.noegle}` };
  fejl['cause'] = new Error(M.noegle);
  return {
    fejl,
    release: 'abc1234',
    tenant: 'maja',
    rute: `/api/rum/:id/aktion/:name?prompt=${encodeURIComponent(M.prompt)}`,
    status: 500,
    varighedMs: 42,
    extra: { prompt: M.prompt, svar: M.mail, noegle: M.noegle },
    request: { url: `https://maja.example.com/api?email=${M.email}`, method: 'POST', headers: { cookie: M.cookie, authorization: `Bearer ${M.noegle}` }, data: M.mail, query_string: M.prompt, cookies: M.cookie },
    breadcrumbs: [{ category: 'console', message: M.prompt }, { category: 'fetch', data: { url: `https://x.example.com/?k=${M.noegle}` } }],
    user: { email: M.email, ip_address: '192.0.2.10' },
    exception: { values: [{ type: 'Error', value: M.prompt, stacktrace: { frames: [{ filename: 'src/x.ts', function: 'svar', vars: { input: M.prompt, mail: M.mail, cookie: M.cookie } }] } }] },
    contexts: { mail: { body: M.mail } },
    tags: { prompt: M.prompt, email: M.email },
    message: M.mail,
  };
}

test('the scrub rules and the scrubber are byte-identical in the tenant and in Sky (no import across, KC-0176)', () => {
  assert.ok(fil('../src/shell/fejlrapport-regler.json').equals(fil('../sky/src/delt/fejlrapport-regler.json')), 'fejlrapport-regler.json differs');
  assert.ok(fil('../src/shell/fejlrapport-kerne.ts').equals(fil('../sky/src/delt/fejlrapport-kerne.ts')), 'fejlrapport-kerne.ts differs');
});

test('a fully loaded event leaves with no marker anywhere, and with what we need to find the bug', () => {
  const h = rens(fyldtHaendelse());
  const json = JSON.stringify(h);
  assert.doesNotMatch(json, INGEN_MARKOER, json);
  for (const v of Object.values(M)) assert.ok(!json.includes(v));
  assert.equal(h.exception.values[0]!.type, 'Error', 'the type is the class, not a name the caller set');
  assert.equal(h.exception.values[0]!.value, '[besked fjernet]', 'an unmarked message never leaves');
  assert.ok((h.exception.values[0]!.stacktrace?.frames.length ?? 0) > 0, 'stack frames with file and line');
  for (const r of h.exception.values[0]!.stacktrace!.frames) {
    assert.deepEqual(Object.keys(r).sort(), ['colno', 'filename', 'function', 'in_app', 'lineno'].filter((k) => k in r).sort());
    assert.doesNotMatch(r.filename, /^\/|Users|home/, 'no absolute path (it names the machine user)');
  }
  assert.equal(h.release, 'abc1234');
  assert.deepEqual(h.tags, { tenant: 'maja', rute: '/api/rum/:id/aktion/:name', status: '500' });
  assert.deepEqual(h.contexts, { clawco: { varighed_ms: 42 } });
  assert.deepEqual(Object.keys(h).sort(), ['contexts', 'event_id', 'exception', 'level', 'platform', 'release', 'tags', 'timestamp']);
});

test('the envelope that is actually posted carries no marker either', async () => {
  const sendt: { url: string; init: RequestInit }[] = [];
  const falskFetch = (async (url: string | URL | Request, init?: RequestInit) => { sendt.push({ url: String(url), init: init ?? {} }); return new Response('{}', { status: 200 }); }) as typeof fetch;
  const r = lavFejlrapport({ transport: sentryTransport('https://0123456789abcdef0123456789abcdef@o1.ingest.de.sentry.example/4500000000000001', falskFetch), release: 'abc1234' });
  r.rapporter(fyldtHaendelse().fejl, { tenant: 'maja', rute: '/api/x', status: 500 });
  await r.vent();
  assert.equal(sendt.length, 1);
  assert.equal(sendt[0]!.url, 'https://o1.ingest.de.sentry.example/api/4500000000000001/envelope/');
  assert.doesNotMatch(String(sendt[0]!.init.body), INGEN_MARKOER);
  const linjer = String(sendt[0]!.init.body).trim().split('\n');
  assert.equal(linjer.length, 3);
  assert.deepEqual(JSON.parse(linjer[1]!), { type: 'event', content_type: 'application/json' });
  assert.equal(JSON.parse(linjer[0]!).event_id, JSON.parse(linjer[2]!).event_id);
  const h = new Headers(sendt[0]!.init.headers);
  assert.match(h.get('x-sentry-auth') ?? '', /sentry_version=7, sentry_client=clawco\/1, sentry_key=0123456789abcdef0123456789abcdef/);
  assert.equal(h.get('cookie'), null);
});

test('a message our own code marks as safe leaves, redacted: no address, no long token, nothing after a colon', () => {
  const fejl = medSikkerBesked(new Error('x'), `konto 12 fejlede for ${M.email} noegle=${M.noegle} hos https://api.example.com/v1?k=1 "${M.prompt}": ${M.mail}`);
  const v = rens({ fejl }).exception.values[0]!.value;
  assert.equal(v, 'konto 12 fejlede for [email] noegle=[fjernet] hos [adresse] [tekst]');
  assert.equal(rens({ fejl: medSikkerBesked(new Error('x'), `x ${'a'.repeat(40)}`) }).exception.values[0]!.value, 'x [token]');
  assert.ok(rens({ fejl: medSikkerBesked(new Error('x'), 'å'.repeat(500)) }).exception.values[0]!.value.length <= 200);
});

test('a value outside its form is left out, not cut down', () => {
  const h = rens({ fejl: new Error('x'), tenant: M.email, rute: `/konto/${M.email}`, status: 'fem hundrede', release: M.prompt, varighedMs: -1, alarm: M.prompt });
  assert.equal(JSON.stringify(h).match(INGEN_MARKOER), null);
  assert.deepEqual(h.tags, {});
  assert.equal(h.release, undefined);
  assert.equal(h.contexts, undefined);
  // A Node system error's code is an enum, so it is allowed.
  const e = Object.assign(new Error(`connect ECONNREFUSED ${M.email}`), { code: 'ECONNREFUSED' });
  assert.deepEqual(rens({ fejl: e }).tags, { kode: 'ECONNREFUSED' });
});

test('a thrown non-Error is reported by kind only', () => {
  for (const v of [M.prompt, { body: M.mail }, 42, null, undefined]) {
    const h = rens({ fejl: v });
    assert.doesNotMatch(JSON.stringify(h), INGEN_MARKOER);
    assert.equal(h.exception.values[0]!.type, 'IkkeEnFejl');
  }
});

test('a scrubber that throws drops the event: the transport is never called', async () => {
  let kald = 0;
  const logget: string[] = [];
  const r = lavFejlrapport({ transport: async () => { kald += 1; }, rens: () => { throw new Error(M.prompt); }, log: (l) => logget.push(l) });
  r.rapporter(new Error('x'));
  await r.vent();
  assert.equal(kald, 0);
  assert.equal(logget.length, 1);
  assert.doesNotMatch(logget.join('\n'), INGEN_MARKOER);
});

test('a transport that fails never throws into the app, and its failure is logged without the event', async () => {
  const logget: string[] = [];
  const r = lavFejlrapport({ transport: async () => { throw new Error(M.prompt); }, log: (l) => logget.push(l) });
  assert.doesNotThrow(() => r.rapporter(new Error('x')));
  await r.vent();
  assert.equal(logget.length, 1);
  assert.doesNotMatch(logget[0]!, INGEN_MARKOER);
});

test('at most perTiMinutter events per ten minutes leave (a failing loop cannot flood the EU project)', async () => {
  let nu = new Date('2026-11-02T10:00:00Z');
  const sendt: Haendelse[] = [];
  const r = lavFejlrapport({ transport: async (_k, h) => { sendt.push(h); }, nu: () => nu, log: () => {} });
  for (let i = 0; i < 100; i++) r.rapporter(new Error('x'));
  await r.vent();
  assert.equal(sendt.length, 30);
  nu = new Date('2026-11-02T10:10:01Z');
  r.rapporter(new Error('x'));
  await r.vent();
  assert.equal(sendt.length, 31);
});

test('the DSN decides the endpoint; a malformed DSN or one with a secret part is refused', () => {
  assert.deepEqual(laesDsn('https://0123456789abcdef0123456789abcdef@o1.ingest.de.sentry.example/4500000000000001'), { endepunkt: 'https://o1.ingest.de.sentry.example/api/4500000000000001/envelope/', noegle: '0123456789abcdef0123456789abcdef' });
  assert.deepEqual(laesDsn('https://abcdef0123456789@glitchtip.example.com/sti/7'), { endepunkt: 'https://glitchtip.example.com/sti/api/7/envelope/', noegle: 'abcdef0123456789' });
  for (const d of ['', 'ikke en adresse', 'http://0123456789abcdef@sentry.example.com/1', 'https://sentry.example.com/1', 'https://0123456789abcdef:hemmelig@sentry.example.com/1', 'https://0123456789abcdef@sentry.example.com/', 'https://0123456789abcdef@sentry.example.com/1?x=y']) {
    assert.equal(laesDsn(d), null, d);
  }
});

test('the envelope is three JSON lines: header, item header, event', () => {
  const h = rens({ fejl: new Error('x') });
  const k = konvolut(h, new Date('2026-11-02T10:00:00Z'));
  const [a, b, c] = k.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(a, { event_id: h.event_id, sent_at: '2026-11-02T10:00:00.000Z' });
  assert.deepEqual(b, { type: 'event', content_type: 'application/json' });
  assert.deepEqual(c, h);
  assert.match(h.event_id, /^[0-9a-f]{32}$/);
});

test('tenant: no KC_FEJLRAPPORT_DSN means no transport is ever built and nothing is sent', () => {
  let bygget = 0;
  const r = tenantFejlrapport({}, { release: 'abc1234', lavTransport: () => { bygget += 1; return async () => {}; } });
  r.rapporter(new Error('x'));
  assert.equal(r.aktiv, false);
  assert.equal(bygget, 0);
  assert.equal(tenantFejlrapport({ KC_FEJLRAPPORT_DSN: '  ' }, { release: 'x', lavTransport: () => { bygget += 1; return async () => {}; } }).aktiv, false);
  assert.equal(bygget, 0);
});

test('tenant: an invalid DSN is off (never a crash), and the reason names the key, not its value', () => {
  const logget: string[] = [];
  const r = tenantFejlrapport({ KC_FEJLRAPPORT_DSN: `https://${M.noegle}:x@example.com/1` }, { release: 'x', log: (l) => logget.push(l) });
  assert.equal(r.aktiv, false);
  assert.match(logget.join('\n'), /KC_FEJLRAPPORT_DSN er ugyldig/);
  assert.doesNotMatch(logget.join('\n'), INGEN_MARKOER);
});

test('tenant: with the DSN set (the owner switched it on) it reports, tagged with the tenant id from KC_KONTO_TENANT', async () => {
  const sendt: Haendelse[] = [];
  const r = tenantFejlrapport({ KC_FEJLRAPPORT_DSN: 'https://0123456789abcdef@sentry.example.com/1', KC_KONTO_TENANT: 'maja' }, { release: 'abc1234', lavTransport: () => async (_k, h) => { sendt.push(h); } });
  assert.equal(r.aktiv, true);
  r.rapporter(fyldtHaendelse().fejl, { rute: '/api/x' });
  await r.vent();
  assert.equal(sendt.length, 1);
  assert.equal(sendt[0]!.tags['tenant'], 'maja');
  assert.equal(sendt[0]!.release, 'abc1234');
  assert.doesNotMatch(JSON.stringify(sendt[0]), INGEN_MARKOER);
});

test('the app reports an unexpected 500 with the route template, never the request', async () => {
  const sendt: Haendelse[] = [];
  const fejlrapport = lavFejlrapport({ transport: async (_k, h) => { sendt.push(h); }, release: 'abc1234' });
  const { app } = createApp({ store: createFileStore('/nonexistent'), hermes: createFakeAgent({ answer: () => '' }), sourceGlob: '/nonexistent/{date}.json', publicDir: 'public', fejlrapport });
  app.post('/test/kast/:id', () => { throw new Error(M.prompt); });
  const res = await app.request(`/test/kast/7?email=${encodeURIComponent(M.email)}`, { method: 'POST', body: M.mail, headers: { cookie: M.cookie, 'content-type': 'text/plain' } });
  assert.equal(res.status, 500);
  await fejlrapport.vent();
  assert.equal(sendt.length, 1);
  assert.deepEqual(sendt[0]!.tags, { rute: '/test/kast/:id', status: '500' });
  assert.doesNotMatch(JSON.stringify(sendt[0]), INGEN_MARKOER);
});

test('the threat model names the error report as a surface (AGENTS §4 r12)', () => {
  const dok = fil('../docs/superpowers/specs/2026-10-31-trusselsmodel.md').toString('utf8');
  assert.match(dok, /^\| `fejlrapport` /m);
});
