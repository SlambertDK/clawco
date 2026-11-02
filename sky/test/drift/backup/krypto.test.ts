// KC-0185: client-side encryption of a copy — AES-256-GCM under the scope's own key, the scope and the
// snapshot id as associated data, so a copy opens only with its own key, under its own name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { aabn, forsegl, kekVersion } from '../../../src/drift/backup/krypto.ts';

const noegle = (b = randomBytes(32)) => ({ aaben: () => b });

test('a sealed copy opens with its key, scope and id, and carries no plaintext', () => {
  const k = noegle();
  const data = Buffer.from('{"hemmelig":"husstand"}');
  const blob = forsegl(k, { omfang: 'hus-aaaaaaaa', id: '20261101T021345Z-0a1b2c3d' }, data);
  assert.ok(!blob.includes(data));
  assert.deepEqual(aabn(k, { omfang: 'hus-aaaaaaaa', id: '20261101T021345Z-0a1b2c3d' }, blob), data);
  assert.equal(kekVersion(blob), 0);
});

test("another tenant's key, another scope, another id or a flipped byte all refuse with one fixed message", () => {
  const k = noegle();
  const navn = { omfang: 'hus-aaaaaaaa', id: '20261101T021345Z-0a1b2c3d' };
  const blob = forsegl(k, navn, Buffer.from('data'));
  assert.throws(() => aabn(noegle(), navn, blob), /^KopiFejl: kopien kunne ikke åbnes$/);
  assert.throws(() => aabn(k, { ...navn, omfang: 'hus-bbbbbbbb' }, blob), /kopien kunne ikke åbnes/);
  assert.throws(() => aabn(k, { ...navn, id: '20261101T021345Z-0a1b2c3e' }, blob), /kopien kunne ikke åbnes/);
  const b = Buffer.from(blob);
  b[b.length - 20]! ^= 1;
  assert.throws(() => aabn(k, navn, b), /kopien kunne ikke åbnes/);
  assert.throws(() => aabn(k, navn, blob.subarray(0, 10)), /kopien kunne ikke åbnes/);
});

test('the master key version is in the header and authenticated (a relabelled version refuses)', () => {
  const k = noegle();
  const navn = { omfang: 'db', id: '20261101T021345Z-0a1b2c3d' };
  const blob = forsegl(k, navn, Buffer.from('dump'), 3);
  assert.equal(kekVersion(blob), 3);
  const b = Buffer.from(blob);
  b.writeUInt32BE(2, 4);
  assert.throws(() => aabn(k, navn, b), /kopien kunne ikke åbnes/);
});
