// KC-0185: the backup job's key seam over the real envelope — a tenant's `backup` key from its DEK, the
// control-plane dump key from the master key of a given version, and deleted tenants' purge dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afled, afledKontrolplan } from '../../src/hemmeligheder/afled.ts';
import { kopiNoegler, slettedeNoegler } from '../../src/hemmeligheder/kopi.ts';
import { destruerUdloebne, hentDataNoegle, markerSlettet, opretTenantNoegle } from '../../src/hemmeligheder/tenantnoegle.ts';
import { migreretDb, nyKek, ring } from './hjaelp.ts';

const DAG = 86_400_000;

test("tenant(slug) is the tenant's backup key derived from its own DEK", async () => {
  const db = await migreretDb();
  const r = ring();
  const t0 = new Date('2026-11-01T00:00:00Z');
  await opretTenantNoegle(db, r, 'hus-aaaaaaaa', t0);
  const k = kopiNoegler({ db, ring: r });
  const forventet = afled(await hentDataNoegle(db, r, 'hus-aaaaaaaa'), 'hus-aaaaaaaa', 'backup').aaben();
  assert.ok((await k.tenant('hus-aaaaaaaa')).aaben().equals(forventet));
  await assert.rejects(k.tenant('hus-bbbbbbbb'), /ingen nøgle/);
});

test('db() derives from the current master key, db(v) from the previous one during a rotation; an unknown version refuses', () => {
  const gammel = nyKek();
  const ny = nyKek();
  const r = ring({ kek: ny, version: 2, forrige: gammel });
  const k = kopiNoegler({ db: null as never, ring: r });
  assert.equal(k.db().version, 2);
  assert.ok(k.db().noegle.aaben().equals(afledKontrolplan(r.aktuel.noegle, 'db-backup').aaben()));
  assert.ok(k.db(1).noegle.aaben().equals(afledKontrolplan(r.forrige!.noegle, 'db-backup').aaben()));
  assert.throws(() => k.db(7), /version 7/);
});

test("deleted tenants with their purge date; a destroyed key says so", async () => {
  const db = await migreretDb();
  const r = ring();
  const t0 = new Date('2026-11-01T00:00:00Z');
  for (const t of ['hus-aaaaaaaa', 'hus-bbbbbbbb', 'hus-cccccccc']) await opretTenantNoegle(db, r, t, t0);
  await markerSlettet(db, 'hus-aaaaaaaa', t0);
  await markerSlettet(db, 'hus-bbbbbbbb', new Date(t0.getTime() - 40 * DAG));
  await destruerUdloebne(db, t0);
  const s = (await slettedeNoegler(db)).sort((a, b) => (a.tenant < b.tenant ? -1 : 1));
  assert.deepEqual(s, [
    { tenant: 'hus-aaaaaaaa', destrueres: new Date(t0.getTime() + 30 * DAG), destrueret: false },
    { tenant: 'hus-bbbbbbbb', destrueres: new Date(t0.getTime() - 10 * DAG), destrueret: true },
  ]);
});
