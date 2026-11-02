// KC-0206: Sky runs the tenant's own KC-0146 "Hent alt" and "Slet alt" as the owner, over the identity contract that
// already exists (KC-0179: Clawco-Konto signed with the gateway key). A local HTTP server plays the tenant and checks
// the signature with the public key, as the tenant does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPublicKey, verify } from 'node:crypto';
import { tenantKald } from '../../src/gateway/tenantkald.ts';
import { laesGatewayNoegle } from '../../src/gateway/noegle.ts';
import { FROE, OFFENTLIG } from './hjaelp.ts';
import { lavZip } from '../../src/delt/zip.ts';

const ZIP = lavZip([{ navn: 'data/rum/dagen/chat.jsonl', data: Buffer.from('hej\n') }]);

const NOEGLE = laesGatewayNoegle({ SKY_GATEWAY_SIGNERINGSNOEGLE: FROE }, null).noegle!;
const PUB = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: OFFENTLIG }, format: 'jwk' });
const NU = new Date('2026-11-01T10:00:00Z');

type Set = { metode: string; sti: string; paastand: Record<string, unknown> | null; krop: string };

async function tenant(svar: (s: Set) => { status: number; type: string; krop: string | Buffer }): Promise<{ adresse: string; set: Set[]; luk(): Promise<void> }> {
  const set: Set[] = [];
  const srv = http.createServer((req, res) => {
    const dele: Buffer[] = [];
    req.on('data', (d: Buffer) => dele.push(d));
    req.on('end', () => {
      const h = String(req.headers['clawco-konto'] ?? '');
      const m = /^v1\.([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{86})$/.exec(h);
      const ok = !!m && verify(null, Buffer.from(`v1.${m[1]}.${m[2]}`), PUB, Buffer.from(m[3]!, 'base64url'));
      const s: Set = { metode: req.method!, sti: req.url!, paastand: ok ? JSON.parse(Buffer.from(m![2]!, 'base64url').toString('utf8')) : null, krop: Buffer.concat(dele).toString('utf8') };
      set.push(s);
      const r = svar(s);
      res.writeHead(r.status, { 'content-type': r.type });
      res.end(r.krop);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return { adresse: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, set, luk: () => new Promise((r) => { srv.close(() => r()); srv.closeAllConnections(); }) };
}

const EJER = { slug: 'hus-abcdefgh', kontoId: 7, email: 'ejer@example.test' };

test('Hent alt: GET /api/tillid/eksport signed as the owner for this tenant; the zip comes back as it was', async () => {
  const t = await tenant(() => ({ status: 200, type: 'application/zip', krop: ZIP }));
  const zip = await tenantKald({ noegle: NOEGLE, nu: () => NU }).eksport({ ...EJER, adresse: t.adresse });
  assert.ok(zip.equals(ZIP));
  assert.equal(t.set.length, 1);
  assert.equal(t.set[0]!.metode, 'GET');
  assert.equal(t.set[0]!.sti, '/api/tillid/eksport');
  assert.deepEqual(t.set[0]!.paastand, { t: 'hus-abcdefgh', k: '7', e: 'ejer@example.test', iat: Math.floor(NU.getTime() / 1000) });
  await t.luk();
});

test('Slet alt: POST /api/tillid/slet-alt with the typed word, signed as the owner', async () => {
  const t = await tenant(() => ({ status: 200, type: 'application/json', krop: '{"slettet":true}' }));
  await tenantKald({ noegle: NOEGLE, nu: () => NU }).sletAlt({ ...EJER, adresse: t.adresse });
  assert.equal(t.set[0]!.metode, 'POST');
  assert.equal(t.set[0]!.sti, '/api/tillid/slet-alt');
  assert.deepEqual(JSON.parse(t.set[0]!.krop), { bekraeft: 'SLET' });
  assert.equal(t.set[0]!.paastand?.['e'], 'ejer@example.test');
  await t.luk();
});

test('any other answer is an error (never an empty or HTML "zip"); without the gateway key nothing is sent', async () => {
  const t = await tenant((s) => (s.sti === '/api/tillid/eksport' ? { status: 200, type: 'text/html', krop: '<html>' } : { status: 403, type: 'application/json', krop: '{"error":"nej"}' }));
  const k = tenantKald({ noegle: NOEGLE, nu: () => NU });
  await assert.rejects(k.eksport({ ...EJER, adresse: t.adresse }), /svarede/);
  await assert.rejects(k.sletAlt({ ...EJER, adresse: t.adresse }), /403/);
  const foer = t.set.length;
  await assert.rejects(tenantKald({ noegle: null }).eksport({ ...EJER, adresse: t.adresse }), /nøgle/);
  await assert.rejects(tenantKald({ noegle: null }).sletAlt({ ...EJER, adresse: t.adresse }), /nøgle/);
  assert.equal(t.set.length, foer, 'fail closed: no request without the key');
  await t.luk();
});
