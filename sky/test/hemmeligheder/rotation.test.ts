// KC-0181: KEK rotation re-wraps every tenant's DEK in one transaction and bumps the version; the old
// KEK opens envelopes until the job completes. A crash halfway leaves nothing half-wrapped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../../src/db/pool.ts';
import { hentDataNoegle, markerSlettet, opretTenantNoegle, paaAeldreVersion, roterMasternoegle } from '../../src/hemmeligheder/tenantnoegle.ts';
import { migreretDb, nyKek, ring } from './hjaelp.ts';

const NU = new Date('2026-10-31T12:00:00Z');
const TENANTS = ['hus-aaaaaaaa', 'hus-bbbbbbbb', 'hus-cccccccc', 'hus-dddddddd'];

async function versioner(db: Database): Promise<Record<string, number>> {
  const rows = await db.query<{ tenant: string; kek_version: number }>('SELECT tenant, kek_version FROM hemmeligheder.tenant_noegle ORDER BY tenant');
  return Object.fromEntries(rows.map((r) => [r.tenant, r.kek_version]));
}

/** A database whose transactions throw at the n-th re-wrap UPDATE: the crash in the middle of the job. */
function kraschVed(db: Database, n: number): Database {
  let set = 0;
  const omkring = (d: Database): Database => ({
    ...d,
    async query(sql, params) {
      if (/^\s*UPDATE hemmeligheder\.tenant_noegle SET kuvert/.test(sql) && ++set === n) throw new Error('strømmen gik');
      return d.query(sql, params);
    },
    transaction: (fn) => d.transaction((tx) => fn(omkring(tx))),
  });
  return omkring(db);
}

test('rotation re-wraps every DEK (active and awaiting purge) under the new version; every DEK is unchanged', async () => {
  const db = await migreretDb();
  const gammel = nyKek();
  const r1 = ring({ kek: gammel });
  for (const t of TENANTS) assert.equal(await opretTenantNoegle(db, r1, t, NU), 'oprettet');
  await markerSlettet(db, 'hus-dddddddd', NU);
  const foer = Object.fromEntries(await Promise.all(TENANTS.map(async (t) => [t, (await hentDataNoegle(db, r1, t)).aaben().toString('hex')])));

  const r2 = ring({ kek: nyKek(), version: 2, forrige: gammel });
  assert.equal(await paaAeldreVersion(db, 2), 4);
  assert.deepEqual(await roterMasternoegle(db, r2, NU), { omkuverteret: 4, version: 2 });
  assert.deepEqual(await versioner(db), Object.fromEntries(TENANTS.map((t) => [t, 2])));
  assert.equal(await paaAeldreVersion(db, 2), 0, 'the job is done: SKY_MASTERNOEGLE_FORRIGE can go');
  // After the job the new KEK alone opens everything; the old one opens nothing.
  const kunNy = ring({ kek: Buffer.from(r2.aktuel.noegle.aaben()).toString('base64'), version: 2 });
  for (const t of TENANTS) assert.equal((await hentDataNoegle(db, kunNy, t)).aaben().toString('hex'), foer[t]);
  await assert.rejects(hentDataNoegle(db, r1, 'hus-aaaaaaaa'), /kuverten kunne ikke åbnes/);
  // Running it again is a no-op.
  assert.deepEqual(await roterMasternoegle(db, r2, NU), { omkuverteret: 0, version: 2 });
  await db.close();
});

test('a crash halfway rolls back: every row still on the old version and openable; a rerun completes', async () => {
  const db = await migreretDb();
  const gammel = nyKek();
  const r1 = ring({ kek: gammel });
  for (const t of TENANTS) await opretTenantNoegle(db, r1, t, NU);
  const foer = Object.fromEntries(await Promise.all(TENANTS.map(async (t) => [t, (await hentDataNoegle(db, r1, t)).aaben().toString('hex')])));
  const r2 = ring({ kek: nyKek(), version: 2, forrige: gammel });

  await assert.rejects(roterMasternoegle(kraschVed(db, 3), r2, NU), /strømmen gik/);
  assert.deepEqual(await versioner(db), Object.fromEntries(TENANTS.map((t) => [t, 1])), 'nothing half-wrapped');
  for (const t of TENANTS) assert.equal((await hentDataNoegle(db, r1, t)).aaben().toString('hex'), foer[t]);

  assert.deepEqual(await roterMasternoegle(db, r2, NU), { omkuverteret: 4, version: 2 });
  for (const t of TENANTS) assert.equal((await hentDataNoegle(db, r2, t)).aaben().toString('hex'), foer[t]);
  await db.close();
});

test('a row under a version the ring does not hold stops the whole job (fail closed, nothing written)', async () => {
  const db = await migreretDb();
  const r1 = ring();
  for (const t of TENANTS) await opretTenantNoegle(db, r1, t, NU);
  const fremmed = ring({ kek: nyKek(), version: 2, forrige: nyKek() });
  await assert.rejects(roterMasternoegle(db, fremmed, NU), /kuverten kunne ikke åbnes/);
  assert.deepEqual(await versioner(db), Object.fromEntries(TENANTS.map((t) => [t, 1])));
  await db.close();
});
