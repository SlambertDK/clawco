// KC-0184: Sky's control call to a tenant's internal household route. Invariant: signed with the gateway key under its
// own prefix and audience (k1., clawco-tenant-kontrol), bound to tenant, method, path and exact body, with a fresh
// nonce; it never carries a person (no Clawco-Konto), and the gateway never lets a client reach /intern/ or send the
// Clawco-Kontrol header (so a person's header can never be replayed as a control call, nor a control call forged).
// The shared vector (sky/test/fixtures/kontrol-vektorer.json, byte-identical in test/fixtures/) is what the tenant
// checks against (test/hushold/intern.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { kontrolKald, INTERN_STI } from '../../src/gateway/kontrolkald.ts';
import { KONTROL_AUD, KONTROL_HEADER, kropHash, noegleFraFroe, signerKonto, signerKontrol } from '../../src/gateway/signer.ts';
import { laesGatewayNoegle } from '../../src/gateway/noegle.ts';
import { aldrigVidere, rensInd } from '../../src/gateway/forbud.ts';
import { FROE, OFFENTLIG } from './hjaelp.ts';

const FIL = new URL('../fixtures/kontrol-vektorer.json', import.meta.url);
const V = JSON.parse(readFileSync(FIL, 'utf8')) as { tenant: string; nu: number; noegle: { froe: string; offentlig: string; id: string }; metode: string; sti: string; nonce: string; krop: string; header: string };
const NOEGLE = laesGatewayNoegle({ SKY_GATEWAY_SIGNERINGSNOEGLE: FROE }, null).noegle!;
const PUB = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: OFFENTLIG }, format: 'jwk' });
const NU = new Date(V.nu * 1000);
const T = { slug: 'hus-abcdefgh' };

test('the two fixture files are byte-identical, and signerKontrol makes exactly the fixture\'s header', () => {
  assert.ok(readFileSync(FIL).equals(readFileSync(new URL('../../../test/fixtures/kontrol-vektorer.json', import.meta.url))));
  const k = noegleFraFroe(Buffer.from(V.noegle.froe, 'hex'));
  assert.equal(k.offentlig, OFFENTLIG);
  assert.equal(signerKontrol(k.privat, { t: V.tenant, m: V.metode, p: V.sti, h: kropHash(V.krop), iat: V.nu, n: V.nonce }), V.header);
  assert.equal(V.sti, INTERN_STI);
});

test('a distinct audience: the control prefix and aud differ from a person\'s header and a support bevis, over the same key', () => {
  const kontrol = signerKontrol(NOEGLE.privat, { t: T.slug, m: 'POST', p: INTERN_STI, h: kropHash('{}'), iat: V.nu, n: '0123456789abcdef' });
  const person = signerKonto(NOEGLE.privat, { t: T.slug, k: '7', e: 'ejer@example.test', iat: V.nu, m: 'POST', p: '/intern/x' });
  assert.match(kontrol, /^k1\./);
  assert.match(person, /^v1\./);
  const payload = JSON.parse(Buffer.from(kontrol.split('.')[2]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload), ['aud', 't', 'm', 'p', 'h', 'iat', 'n']);
  assert.equal(payload['aud'], KONTROL_AUD);
  // A person's header re-labelled as a control call does not verify: the signature covers the prefix.
  const [, id, p, s] = person.split('.');
  assert.equal(verify(null, Buffer.from(`k1.${id}.${p}`), PUB, Buffer.from(s!, 'base64url')), false);
  // Refuses claims a tenant would never accept, so a bug fails here.
  for (const bad of [{ n: 'kort' }, { m: 'post' }, { p: 'intern' }, { h: 'x' }, { iat: -1 }, { t: '' }]) {
    assert.throws(() => signerKontrol(NOEGLE.privat, { t: T.slug, m: 'POST', p: INTERN_STI, h: kropHash('{}'), iat: V.nu, n: '0123456789abcdef', ...bad }), /ugyldigt/, JSON.stringify(bad));
  }
});

type Set = { metode: string; sti: string; headers: http.IncomingHttpHeaders; krop: string };
async function tenant(svar: (s: Set) => { status: number; krop: string }): Promise<{ adresse: string; set: Set[]; luk(): Promise<void> }> {
  const set: Set[] = [];
  const srv = http.createServer((req, res) => {
    const dele: Buffer[] = [];
    req.on('data', (d: Buffer) => dele.push(d));
    req.on('end', () => {
      const s: Set = { metode: req.method!, sti: req.url!, headers: req.headers, krop: Buffer.concat(dele).toString('utf8') };
      set.push(s);
      const r = svar(s);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(r.krop);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { adresse: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, set, luk: () => new Promise((r) => { srv.close(() => r()); srv.closeAllConnections(); }) };
}

test('the call: POST /intern/husstand/medlem, the body as given, a header that verifies with the tenant\'s key, no person', async () => {
  const t = await tenant(() => ({ status: 200, krop: '{"ok":true,"aendret":true}' }));
  const n = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'];
  const kald = kontrolKald({ noegle: NOEGLE, nu: () => NU, nonce: () => n.shift()! });
  assert.deepEqual(await kald.medlem({ ...T, adresse: t.adresse }, { op: 'tilfoej', email: 'nora@example.test', navn: 'Nora', rolle: 'barn' }), { aendret: true });
  await kald.medlem({ ...T, adresse: t.adresse }, { op: 'fjern', email: 'nora@example.test' });
  assert.equal(t.set.length, 2);
  const s = t.set[0]!;
  assert.equal(s.metode, 'POST');
  assert.equal(s.sti, INTERN_STI);
  assert.equal(s.headers['clawco-konto'], undefined, 'never a person');
  assert.deepEqual(JSON.parse(s.krop), { op: 'tilfoej', email: 'nora@example.test', navn: 'Nora', rolle: 'barn' });
  const h = String(s.headers[KONTROL_HEADER.toLowerCase()]);
  const m = /^k1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{86})$/.exec(h);
  assert.ok(m);
  assert.ok(verify(null, Buffer.from(`k1.${m[1]}.${m[2]}`), PUB, Buffer.from(m[3]!, 'base64url')));
  const p = JSON.parse(Buffer.from(m[2]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  assert.deepEqual(p, { aud: KONTROL_AUD, t: T.slug, m: 'POST', p: INTERN_STI, h: createHash('sha256').update(s.krop).digest('base64url'), iat: V.nu, n: 'aaaaaaaaaaaaaaaa' });
  assert.notEqual(String(t.set[1]!.headers['clawco-kontrol']), h, 'every call its own nonce');
  await t.luk();
});

test('the call fails closed: no key sends nothing; a non-200 or an answer without ok:true throws', async () => {
  const t = await tenant((s) => (s.krop.includes('fjern') ? { status: 409, krop: '{"error":"nej"}' } : { status: 200, krop: '{"aendret":true}' }));
  await assert.rejects(kontrolKald({ noegle: null }).medlem({ ...T, adresse: t.adresse }, { op: 'fjern', email: 'nora@example.test' }), /gateway-nøgle/);
  assert.equal(t.set.length, 0);
  const kald = kontrolKald({ noegle: NOEGLE, nu: () => NU });
  await assert.rejects(kald.medlem({ ...T, adresse: t.adresse }, { op: 'fjern', email: 'nora@example.test' }), /409/);
  await assert.rejects(kald.medlem({ ...T, adresse: t.adresse }, { op: 'rolle', email: 'nora@example.test', rolle: 'gaest' }), /200/);
  await t.luk();
});

test('the gateway never forwards /intern/ and strips a client\'s Clawco-Kontrol (a replayed header never reaches a tenant)', () => {
  for (const sti of ['/intern', '/intern/', '/intern/husstand/medlem', '/INTERN/husstand/medlem', '/x/../intern/husstand/medlem', '/%69ntern/husstand/medlem', '//intern//husstand/medlem', '/api/beta/maal', '/API/beta/maal', '/x/../api/beta/maal']) {
    assert.equal(aldrigVidere(sti), true, sti);
  }
  assert.equal(aldrigVidere('/internt'), false);
  assert.equal(aldrigVidere('/api/beta/feedback'), false);
  const ud = rensInd({ 'clawco-kontrol': V.header, 'clawco-konto': 'v1.x', accept: 'text/html' });
  assert.deepEqual(ud, { accept: 'text/html' });
});

test('KC-0203: GET /api/beta/maal — no body, the empty body\'s SHA-256 in the signature, its own nonce, never a person; the JSON of a 200 comes back', async () => {
  const t = await tenant(() => ({ status: 200, krop: '{"version":1,"samtykke":false}' }));
  const n = ['cccccccccccccccc', 'dddddddddddddddd'];
  const kald = kontrolKald({ noegle: NOEGLE, nu: () => NU, nonce: () => n.shift()! });
  assert.deepEqual(await kald.hent({ ...T, adresse: t.adresse }, '/api/beta/maal'), { version: 1, samtykke: false });
  await kald.hent({ ...T, adresse: t.adresse }, '/api/beta/maal');
  const s = t.set[0]!;
  assert.equal(s.metode, 'GET');
  assert.equal(s.sti, '/api/beta/maal');
  assert.equal(s.krop, '');
  assert.equal(s.headers['clawco-konto'], undefined, 'never a person');
  assert.equal(s.headers['content-type'], undefined);
  const m = /^k1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{86})$/.exec(String(s.headers[KONTROL_HEADER.toLowerCase()]));
  assert.ok(m);
  assert.ok(verify(null, Buffer.from(`k1.${m[1]}.${m[2]}`), PUB, Buffer.from(m[3]!, 'base64url')));
  const p = JSON.parse(Buffer.from(m[2]!, 'base64url').toString('utf8')) as Record<string, unknown>;
  assert.deepEqual(p, { aud: KONTROL_AUD, t: T.slug, m: 'GET', p: '/api/beta/maal', h: createHash('sha256').update('').digest('base64url'), iat: V.nu, n: 'cccccccccccccccc' });
  assert.notEqual(String(t.set[1]!.headers['clawco-kontrol']), String(s.headers['clawco-kontrol']), 'every call its own nonce');
  await t.luk();
});

test('KC-0203: the read fails closed: no key sends nothing; a non-200, a redirect or a body that is not JSON throws', async () => {
  const t = await tenant((s) => (s.sti === '/api/beta/maal' ? { status: 503, krop: '{}' } : { status: 200, krop: 'ikke json' }));
  await assert.rejects(kontrolKald({ noegle: null }).hent({ ...T, adresse: t.adresse }, '/api/beta/maal'), /gateway-nøgle/);
  assert.equal(t.set.length, 0);
  const kald = kontrolKald({ noegle: NOEGLE, nu: () => NU });
  await assert.rejects(kald.hent({ ...T, adresse: t.adresse }, '/api/beta/maal'), /503/);
  await assert.rejects(kald.hent({ ...T, adresse: t.adresse }, '/api/andet'), /JSON/);
  await t.luk();
});

test('KC-0273 (D5): both control calls read the tenant\'s answer bounded: a 1 MiB answer throws, a normal one passes', async () => {
  const fyld = 'x'.repeat(1024 * 1024);
  const t = await tenant((s) => (s.metode === 'GET'
    ? { status: 200, krop: s.sti.endsWith('stor') ? JSON.stringify({ fyld }) : '{"tal":1}' }
    : { status: 200, krop: s.krop.includes('fjern') ? JSON.stringify({ ok: true, aendret: true, fyld }) : '{"ok":true,"aendret":false}' }));
  const kald = kontrolKald({ noegle: NOEGLE, nu: () => NU });
  try {
    await assert.rejects(kald.medlem({ ...T, adresse: t.adresse }, { op: 'fjern', email: 'nora@example.test' }), /for stort/);
    assert.deepEqual(await kald.medlem({ ...T, adresse: t.adresse }, { op: 'rolle', email: 'nora@example.test', rolle: 'barn' }), { aendret: false });
    await assert.rejects(kald.hent({ ...T, adresse: t.adresse }, '/api/beta/stor'), /for stort/);
    assert.deepEqual(await kald.hent({ ...T, adresse: t.adresse }, '/api/beta/maal'), { tal: 1 });
  } finally {
    await t.luk();
  }
});
