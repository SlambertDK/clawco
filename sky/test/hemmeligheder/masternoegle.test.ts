// KC-0181: the master key (KEK) from Sky's env. Without it Sky does not start; errors name the key,
// never its value; the values are removed from the env object once read (no child process inherits them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { kekForVersion, laesMasternoegle } from '../../src/hemmeligheder/masternoegle.ts';
import { nyKek } from './hjaelp.ts';

test('reads SKY_MASTERNOEGLE (base64, 32 bytes), version 1 by default, and removes it from the env', () => {
  const kek = nyKek();
  const env: Record<string, string | undefined> = { SKY_MASTERNOEGLE: kek, SKY_PORT: '8781' };
  const r = laesMasternoegle(env);
  assert.equal(r.aktuel.version, 1);
  assert.ok(r.aktuel.noegle.aaben().equals(Buffer.from(kek, 'base64')));
  assert.equal(r.forrige, undefined);
  assert.deepEqual(env, { SKY_PORT: '8781' }, 'the key is gone from the env object');
});

test('missing or invalid → refuses, naming the key only', () => {
  assert.throws(() => laesMasternoegle({}), /SKY_MASTERNOEGLE mangler — Sky starter ikke/);
  assert.throws(() => laesMasternoegle({ SKY_MASTERNOEGLE: '   ' }), /SKY_MASTERNOEGLE mangler/);
  const kort = randomBytes(16).toString('base64');
  assert.throws(() => laesMasternoegle({ SKY_MASTERNOEGLE: kort }), (e: Error) => /SKY_MASTERNOEGLE er ugyldig.*32 bytes/.test(e.message) && !e.message.includes(kort));
  const hex = randomBytes(32).toString('hex');
  assert.throws(() => laesMasternoegle({ SKY_MASTERNOEGLE: hex }), (e: Error) => /ugyldig/.test(e.message) && !e.message.includes(hex));
  assert.throws(() => laesMasternoegle({ SKY_MASTERNOEGLE: nyKek(), SKY_MASTERNOEGLE_VERSION: '0' }), /SKY_MASTERNOEGLE_VERSION er ugyldig/);
  assert.throws(() => laesMasternoegle({ SKY_MASTERNOEGLE: nyKek(), SKY_MASTERNOEGLE_VERSION: '2x' }), /SKY_MASTERNOEGLE_VERSION er ugyldig/);
});

test('during a rotation the previous key is accepted as version − 1', () => {
  const ny = nyKek();
  const gammel = nyKek();
  const r = laesMasternoegle({ SKY_MASTERNOEGLE: ny, SKY_MASTERNOEGLE_VERSION: '2', SKY_MASTERNOEGLE_FORRIGE: gammel });
  assert.equal(r.aktuel.version, 2);
  assert.equal(r.forrige?.version, 1);
  assert.ok(kekForVersion(r, 1)?.aaben().equals(Buffer.from(gammel, 'base64')));
  assert.ok(kekForVersion(r, 2)?.aaben().equals(Buffer.from(ny, 'base64')));
  assert.equal(kekForVersion(r, 3), undefined);
  assert.throws(() => laesMasternoegle({ SKY_MASTERNOEGLE: ny, SKY_MASTERNOEGLE_FORRIGE: gammel }), /SKY_MASTERNOEGLE_FORRIGE kræver SKY_MASTERNOEGLE_VERSION på mindst 2/);
  assert.throws(() => laesMasternoegle({ SKY_MASTERNOEGLE: ny, SKY_MASTERNOEGLE_VERSION: '2', SKY_MASTERNOEGLE_FORRIGE: ny }), /SKY_MASTERNOEGLE_FORRIGE er den samme/);
});
