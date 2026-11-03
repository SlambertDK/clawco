// KC-0264: a tenant's model token. Derived from its data key and a generation number, stored only as a hash, delivered to
// the container's private tmpfs on stdin like the lager key, revoked on deletion and rotatable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NOEGLE_MAPPE, type KoerselMedInput } from '../../src/hemmeligheder/levering.ts';
import { MODEL_TOKEN_STI, leverModelToken, modelToken, roterModelToken, sikrModelToken, tenantForModelToken, tilbagekaldModelToken } from '../../src/hemmeligheder/modeltoken.ts';
import { opretTenantNoegle } from '../../src/hemmeligheder/tenantnoegle.ts';
import { migreretDb, ring } from './hjaelp.ts';

const T = 'hus-aaaaaaaa';
const nu = new Date('2026-11-03T10:00:00Z');

async function opsaet() {
  const db = await migreretDb();
  const r = ring();
  await opretTenantNoegle(db, r, T, nu);
  return { db, r };
}

test('the token file lives on the key tmpfs, next to the lager key', () => {
  assert.equal(MODEL_TOKEN_STI, `${NOEGLE_MAPPE}/model-token`);
});

test('sikr makes one row holding only the SHA-256 of the token; it is idempotent and the token is stable across calls', async () => {
  const { db, r } = await opsaet();
  await sikrModelToken(db, r, T, nu);
  await sikrModelToken(db, r, T, nu);
  const token = await modelToken(db, r, T);
  assert.match(token, /^[A-Za-z0-9+/]{43}=$/, '32 bytes, base64 (the key writer\'s format)');
  assert.equal(await modelToken(db, r, T), token);
  const rows = await db.query<Record<string, unknown>>('SELECT * FROM hemmeligheder.model_token');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!['hash'], createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(rows).includes(token), 'the token itself is never stored');
  await db.close();
});

test('lookup: the token gives its tenant; a wrong, malformed or revoked token gives nobody', async () => {
  const { db, r } = await opsaet();
  await sikrModelToken(db, r, T, nu);
  const token = await modelToken(db, r, T);
  assert.equal(await tenantForModelToken(db, token), T);
  assert.equal(await tenantForModelToken(db, `${token.slice(0, -2)}A=`), null);
  for (const x of ['', 'x', `${token} `, 'a'.repeat(5000)]) assert.equal(await tenantForModelToken(db, x), null, JSON.stringify(x.slice(0, 10)));
  await tilbagekaldModelToken(db, T, nu);
  assert.equal(await tenantForModelToken(db, token), null);
  await sikrModelToken(db, r, T, nu);
  assert.equal(await tenantForModelToken(db, token), null, 'sikr never brings a revoked token back');
  await db.close();
});

test('rotation: a new token; the old one stops matching at once', async () => {
  const { db, r } = await opsaet();
  await sikrModelToken(db, r, T, nu);
  const gammel = await modelToken(db, r, T);
  const ny = await roterModelToken(db, r, T, nu);
  assert.notEqual(ny, gammel);
  assert.equal(await modelToken(db, r, T), ny);
  assert.equal(await tenantForModelToken(db, gammel), null);
  assert.equal(await tenantForModelToken(db, ny), T);
  await db.close();
});

test('a tenant without a data key gets no token (fail closed)', async () => {
  const db = await migreretDb();
  await assert.rejects(sikrModelToken(db, ring(), 'hus-zzzzzzzz', nu), /ingen nøgle/);
  await db.close();
});

test('delivery: docker exec into the container, the token on stdin only, written to the model-token file', async () => {
  const { db, r } = await opsaet();
  await sikrModelToken(db, r, T, nu);
  const token = await modelToken(db, r, T);
  const kald: { argv: string[]; input: string }[] = [];
  const koer: KoerselMedInput = async (argv, input) => { kald.push({ argv, input }); return { kode: 0, ud: '', fejl: '' }; };
  await leverModelToken({ koer, container: `clawco-t-${T}`, token });
  assert.equal(kald.length, 1);
  assert.deepEqual(kald[0]!.argv.slice(0, 4), ['docker', 'exec', '-i', `clawco-t-${T}`]);
  assert.equal(kald[0]!.argv.at(-1), MODEL_TOKEN_STI);
  assert.equal(kald[0]!.input, `${token}\n`);
  assert.ok(!kald[0]!.argv.join(' ').includes(token), 'never in argv');
  const fejl: KoerselMedInput = async () => ({ kode: 1, ud: '', fejl: 'no such container' });
  await assert.rejects(leverModelToken({ koer: fejl, container: `clawco-t-${T}`, token }), (e: Error) => !e.message.includes(token) && /clawco-t-/.test(e.message));
  await assert.rejects(leverModelToken({ koer, container: 'x; rm -rf /', token }), /containernavn/);
  await db.close();
});
