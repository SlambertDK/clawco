// KC-0181 (D11 "revoke keys"): a deleted tenant's DEK waits 30 days (the backup retention), then the
// daily job destroys the wrapped DEK. After that nothing of the tenant can be opened (crypto-shredding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { afled } from '../../src/hemmeligheder/afled.ts';
import { destruerUdloebne, hentDataNoegle, markerSlettet, OPBEVARING_DAGE, opretTenantNoegle } from '../../src/hemmeligheder/tenantnoegle.ts';
import { migreretDb, ring } from './hjaelp.ts';

const NU = new Date('2026-10-31T12:00:00Z');
const dage = (n: number) => new Date(NU.getTime() + n * 86_400_000);

test('creation is idempotent and never replaces a DEK', async () => {
  const db = await migreretDb();
  const r = ring();
  assert.equal(await opretTenantNoegle(db, r, 'hus-aaaaaaaa', NU), 'oprettet');
  const dek = (await hentDataNoegle(db, r, 'hus-aaaaaaaa')).aaben().toString('hex');
  assert.equal(await opretTenantNoegle(db, r, 'hus-aaaaaaaa', NU), 'findes');
  assert.equal((await hentDataNoegle(db, r, 'hus-aaaaaaaa')).aaben().toString('hex'), dek);
  await assert.rejects(opretTenantNoegle(db, r, 'Hus Med Mellemrum', NU), /ugyldigt tenant-id/);
  await assert.rejects(hentDataNoegle(db, r, 'hus-zzzzzzzz'), /ingen nøgle for tenant/);
  await db.close();
});

test('deletion sets a purge date 30 days out (first date kept); the DEK still opens until then', async () => {
  const db = await migreretDb();
  const r = ring();
  await opretTenantNoegle(db, r, 'hus-aaaaaaaa', NU);
  assert.equal(OPBEVARING_DAGE, 30);
  assert.equal((await markerSlettet(db, 'hus-aaaaaaaa', NU))?.toISOString(), dage(30).toISOString());
  assert.equal((await markerSlettet(db, 'hus-aaaaaaaa', dage(5)))?.toISOString(), dage(30).toISOString(), 'a second call keeps the first date');
  assert.equal(await markerSlettet(db, 'hus-zzzzzzzz', NU), null);
  assert.equal(await opretTenantNoegle(db, r, 'hus-aaaaaaaa', NU), 'findes', 'a deleted tenant is never re-keyed');
  assert.equal(await destruerUdloebne(db, dage(29)), 0);
  assert.equal((await hentDataNoegle(db, r, 'hus-aaaaaaaa')).laengde, 32);
  await db.close();
});

test('at the purge date the wrapped DEK is destroyed; a backup made with the derived key can no longer be opened', async () => {
  const db = await migreretDb();
  const r = ring();
  await opretTenantNoegle(db, r, 'hus-aaaaaaaa', NU);
  await opretTenantNoegle(db, r, 'hus-bbbbbbbb', NU);

  // A "backup" encrypted with the tenant's backup key, as KC-0185 will do.
  const noegle = afled(await hentDataNoegle(db, r, 'hus-aaaaaaaa'), 'hus-aaaaaaaa', 'backup');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', noegle.aaben(), iv);
  const backup = Buffer.concat([c.update('husstandens noter'), c.final()]);
  const tag = c.getAuthTag();
  noegle.oedelaeg();

  await markerSlettet(db, 'hus-aaaaaaaa', NU);
  assert.equal(await destruerUdloebne(db, dage(30)), 1);
  assert.equal(await destruerUdloebne(db, dage(31)), 0, 'idempotent');
  const [raekke] = await db.query<{ kuvert: unknown; destrueret: unknown; status: string }>("SELECT kuvert, destrueret, status FROM hemmeligheder.tenant_noegle WHERE tenant = 'hus-aaaaaaaa'");
  assert.equal(raekke?.kuvert, null);
  assert.ok(raekke?.destrueret);
  assert.equal(raekke?.status, 'slettet');
  await assert.rejects(hentDataNoegle(db, r, 'hus-aaaaaaaa'), /nøglen er destrueret/);
  // The other tenant is untouched.
  assert.equal((await hentDataNoegle(db, r, 'hus-bbbbbbbb')).laengde, 32);

  // Without the DEK the only way in would be guessing the key: a different key never opens the backup.
  const d = createDecipheriv('aes-256-gcm', randomBytes(32), iv);
  d.setAuthTag(tag);
  assert.throws(() => Buffer.concat([d.update(backup), d.final()]));
  await db.close();
});

test('the table cannot hold a destroyed row with an envelope, or an envelope of the wrong size', async () => {
  const db = await migreretDb();
  await assert.rejects(db.query("INSERT INTO hemmeligheder.tenant_noegle (tenant, kuvert, kek_version, oprettet) VALUES ('hus-aaaaaaaa', $1, 1, now())", [Buffer.alloc(32)]));
  await assert.rejects(db.query("INSERT INTO hemmeligheder.tenant_noegle (tenant, kuvert, kek_version, status, oprettet, slettet_ved, destrueres, destrueret) VALUES ('hus-aaaaaaaa', $1, 1, 'slettet', now(), now(), now(), now())", [Buffer.alloc(60)]));
  await db.close();
});
