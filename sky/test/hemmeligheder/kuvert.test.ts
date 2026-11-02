// KC-0181: a tenant's data key (DEK) wrapped under the master key with AES-256-GCM. The tenant id and
// the KEK version are the associated data, so an envelope opened for another tenant, under another
// version, with another KEK or after one flipped bit fails closed — with one fixed message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KuvertFejl, nyDataNoegle, pakInd, pakUd } from '../../src/hemmeligheder/kuvert.ts';
import { former, nyKek, ring } from './hjaelp.ts';

test('wrap/unwrap round trip; a fresh nonce per wrap', () => {
  const r = ring();
  const dek = nyDataNoegle();
  assert.equal(dek.laengde, 32);
  const a = pakInd(r, 'hus-abcdefgh', dek);
  const b = pakInd(r, 'hus-abcdefgh', dek);
  assert.equal(a.version, 1);
  assert.equal(a.kuvert.length, 60, 'nonce 12 + key 32 + tag 16');
  assert.ok(!a.kuvert.equals(b.kuvert), 'two wraps of the same key differ');
  assert.ok(pakUd(r, 'hus-abcdefgh', a).aaben().equals(dek.aaben()));
  for (const f of former(dek.aaben())) assert.ok(!a.kuvert.toString('latin1').includes(f) && !a.kuvert.toString('hex').includes(dek.aaben().toString('hex')));
});

test('wrong KEK, wrong tenant id, wrong version and tampered bytes all fail closed', () => {
  const r = ring();
  const dek = nyDataNoegle();
  const k = pakInd(r, 'hus-abcdefgh', dek);
  const fejl = (fn: () => unknown) => assert.throws(fn, (e: unknown) => e instanceof KuvertFejl && e.message === 'kuverten kunne ikke åbnes');
  fejl(() => pakUd(ring(), 'hus-abcdefgh', k));
  fejl(() => pakUd(r, 'hus-abcdefgi', k));
  fejl(() => pakUd(ring({ kek: nyKek(), version: 2 }), 'hus-abcdefgh', { ...k, version: 2 }));
  for (const i of [0, 20, 59]) {
    const t = Buffer.from(k.kuvert);
    t[i] = t[i]! ^ 1;
    fejl(() => pakUd(r, 'hus-abcdefgh', { kuvert: t, version: 1 }));
  }
  fejl(() => pakUd(r, 'hus-abcdefgh', { kuvert: k.kuvert.subarray(0, 40), version: 1 }));
  fejl(() => pakUd(r, 'hus-abcdefgh', { kuvert: k.kuvert, version: 7 }));
});

test('version bump: a key wrapped under v1 opens with the ring of v2 (forrige) and rewraps as v2', () => {
  const gammel = nyKek();
  const r1 = ring({ kek: gammel });
  const dek = nyDataNoegle();
  const k1 = pakInd(r1, 'hus-abcdefgh', dek);
  const r2 = ring({ kek: nyKek(), version: 2, forrige: gammel });
  const aabnet = pakUd(r2, 'hus-abcdefgh', k1);
  const k2 = pakInd(r2, 'hus-abcdefgh', aabnet);
  assert.equal(k2.version, 2);
  assert.ok(pakUd(r2, 'hus-abcdefgh', k2).aaben().equals(dek.aaben()));
  // The version is bound into the envelope: relabelling a v2 envelope as v1 does not open it.
  assert.throws(() => pakUd(r2, 'hus-abcdefgh', { kuvert: k2.kuvert, version: 1 }), KuvertFejl);
});
