// KC-0273: each tenant's own /24 from the pool, recorded on its row (flaade.tenant.undernet, migration 0020): the lowest
// free index 1..255, kept for the tenant's life, freed when it is `slettet`, and a full pool refuses with a clear error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEllerOpretKonto } from '../../src/konto/konto.ts';
import { bestil, skift, tildelUndernet } from '../../src/fleet/tilstand.ts';
import { opsaet } from './hjaelp.ts';

async function tenant(o: Awaited<ReturnType<typeof opsaet>>, email: string): Promise<string> {
  const { konto } = await findEllerOpretKonto(o.db, email, o.ur.nu());
  return (await bestil(o.db, { kontoId: konto.id, driver: 'lokal', nu: o.ur.nu() })).slug;
}

test('the lowest free index, recorded and stable; a slettet tenant frees its index', async () => {
  const o = await opsaet();
  const a = await tenant(o, 'a@example.test');
  const b = await tenant(o, 'b@example.test');
  assert.equal(await tildelUndernet(o.db, a), 1);
  assert.equal(await tildelUndernet(o.db, b), 2);
  assert.equal(await tildelUndernet(o.db, a), 1, 'stable');
  const [r] = await o.db.query<{ undernet: number }>('SELECT undernet FROM flaade.tenant WHERE slug = $1', [b]);
  assert.equal(Number(r!.undernet), 2, 'on the row');
  await skift(o.db, a, ['bestilt'], 'afvikles', o.ur.nu());
  await skift(o.db, a, ['afvikles'], 'slettet', o.ur.nu());
  const c = await tenant(o, 'c@example.test');
  assert.equal(await tildelUndernet(o.db, c), 1, 'a deleted tenant\'s index is free again');
  await o.db.close();
});

test('two tenants asking at once never get the same index', async () => {
  const o = await opsaet();
  const slugs = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((x) => tenant(o, `${x}@example.test`)));
  const n = await Promise.all(slugs.map((s) => tildelUndernet(o.db, s)));
  assert.deepEqual([...n].sort((x, y) => x - y), [1, 2, 3, 4, 5]);
  await o.db.close();
});

test('a full pool refuses with an error that says so; an unknown tenant throws', async () => {
  const o = await opsaet();
  const a = await tenant(o, 'a@example.test');
  const b = await tenant(o, 'b@example.test');
  assert.equal(await tildelUndernet(o.db, a, 1), 1);
  await assert.rejects(tildelUndernet(o.db, b, 1), /ingen ledige undernet/);
  await assert.rejects(tildelUndernet(o.db, 'hus-findesikke'), /ukendt tenant/);
  await o.db.close();
});
