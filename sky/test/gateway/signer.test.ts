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
  const signerede = V.vektorer.filter((v) => v.kilde);
  assert.ok(signerede.length >= 8);
  for (const v of signerede) assert.equal(signerKonto(noegle(v.kilde!.noegle).privat, v.kilde!.paastand), v.header, v.navn);
});

test('the signature covers the exact bytes v1.<keyid>.<payload>', () => {
  const a = noegle('a');
  const h = signerKonto(a.privat, { t: 'x', k: 'k', e: 'e@example.com', iat: 1 });
  const [v, id, payload, sig] = h.split('.');
  assert.equal(v, 'v1');
  assert.equal(id, a.id);
  assert.deepEqual(Object.keys(JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))), ['t', 'k', 'e', 'iat']);
  const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: a.offentlig }, format: 'jwk' });
  assert.ok(verify(null, Buffer.from(`v1.${id}.${payload}`), pub, Buffer.from(sig!, 'base64url')));
  assert.equal(KONTO_HEADER, 'Clawco-Konto');
});

test('the signer refuses a claim the verifier would never accept', () => {
  const a = noegle('a');
  assert.throws(() => signerKonto(a.privat, { t: '', k: 'k', e: 'e@example.com', iat: 1 }));
  assert.throws(() => signerKonto(a.privat, { t: 't', k: 'k', e: 'e@example.com', iat: 1.5 }));
  assert.throws(() => noegleFraFroe(Buffer.alloc(31)));
});
