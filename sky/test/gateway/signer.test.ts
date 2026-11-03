// KC-0179: the gateway's signer reproduces the shared vectors byte for byte, so the tenant's verifier
// (src/identitet/konto.ts, tested against the same file) and the gateway (KC-0183) agree on the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';
import { KONTO_HEADER, noegleFraFroe, noegleId, signerKonto, type KontoPaastand } from '../../src/gateway/signer.ts';

type Vektor = { navn: string; header: string; kilde: { noegle: string; paastand: KontoPaastand } | null };
const V = JSON.parse(readFileSync(new URL('../fixtures/konto-vektorer.json', import.meta.url), 'utf8')) as {
  noegler: Record<string, { froe: string; offentlig: string; id: string }>;
  vektorer: Vektor[];
};
const noegle = (n: string) => noegleFraFroe(Buffer.from(V.noegler[n]!.froe, 'hex'));

test('a key from its seed has the public key and key id of the vectors', () => {
  for (const [n, k] of Object.entries(V.noegler)) {
    const x = noegle(n);
    assert.equal(x.offentlig, k.offentlig, n);
    assert.equal(x.id, k.id, n);
    assert.equal(noegleId(Buffer.from(k.offentlig, 'base64url')), k.id, n);
  }
});

test('every signed vector is reproduced exactly (Ed25519 is deterministic)', () => {
  // KC-0272: the gateway only ever signs with method and path; the vector without them is the tenant's refusal case.
  const signerede = V.vektorer.filter((v) => v.kilde && 'm' in v.kilde.paastand);
  assert.ok(signerede.length >= 10);
  for (const v of signerede) assert.equal(signerKonto(noegle(v.kilde!.noegle).privat, v.kilde!.paastand), v.header, v.navn);
});

test('the signature covers the exact bytes v1.<keyid>.<payload>', () => {
  const a = noegle('a');
  const h = signerKonto(a.privat, { t: 'x', k: 'k', e: 'e@example.com', iat: 1, m: 'POST', p: '/api/x' });
  const [v, id, payload, sig] = h.split('.');
  assert.equal(v, 'v1');
  assert.equal(id, a.id);
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))), ['t', 'k', 'e', 'iat', 'm', 'p']);
  const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: a.offentlig }, format: 'jwk' });
  assert.ok(verify(null, Buffer.from(`v1.${id}.${payload}`), pub, Buffer.from(sig!, 'base64url')));
  assert.equal(KONTO_HEADER, 'Clawco-Konto');
});

test('the signer refuses a claim the verifier would never accept', () => {
  const a = noegle('a');
  const ok = { t: 't', k: 'k', e: 'e@example.com', iat: 1, m: 'GET', p: '/' };
  assert.throws(() => signerKonto(a.privat, { ...ok, t: '' }));
  assert.throws(() => signerKonto(a.privat, { ...ok, iat: 1.5 }));
  // KC-0272 (D2): the header names the request it was made for, so it cannot be replayed onto another method or path.
  for (const forkert of [{ m: '' }, { m: 'get' }, { m: 'G E T' }, { p: '' }, { p: 'rum' }, { p: '/a?b' }, { p: `/${'a'.repeat(512)}` }]) {
    assert.throws(() => signerKonto(a.privat, { ...ok, ...forkert }), JSON.stringify(forkert));
  }
  assert.throws(() => noegleFraFroe(Buffer.alloc(31)));
});
