// KC-0186: a release reaches tenants cohort by cohort (intern, kanari, alle). Per tenant: a fresh restore point,
// the gateway's update page, the new image on the same volume, the key delivered again, and the tenant counts as
// upgraded only when its own /health shows the new sha. A failure rolls that tenant back to its previous image
// (verified by the previous sha) and halts the rollout; a cohort's soak must pass before the next one starts.
// Killing the command and running it again continues: no tenant twice, none skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fortsaet, fremad, startUdrulning, udrulStatus } from '../../../src/drift/udrulning/udrul.ts';
import { tagLaas, tenanterI, aktivUdrulning } from '../../../src/drift/udrulning/tilstand.ts';
import { ruteTabel } from '../../../src/gateway/rute.ts';
import { FORKERT, GAMMEL, NY, raekke, tilEnde, verden } from './hjaelp.ts';

const I = 'hus-iiiiiiii';
const K = 'hus-kkkkkkkk';
const A1 = 'hus-aaaaaaaa';
const A2 = 'hus-bbbbbbbb';
const A3 = 'hus-cccccccc';
const MIN = 60_000;

async function fire() {
  return verden([{ slug: I, hold: 'intern' }, { slug: K, hold: 'kanari' }, { slug: A1, hold: 'alle' }, { slug: A2, hold: 'alle' }, { slug: A3, hold: 'alle' }]);
}

const opgraderinger = (kald: string[]) => kald.filter((k) => k.startsWith('opgrader '));
const tilstande = async (v: Awaited<ReturnType<typeof fire>>) => {
  const u = await aktivUdrulning(v.db) ?? null;
  const id = u?.id ?? Number((await v.db.query<{ id: number }>('SELECT max(id) AS id FROM drift.udrulning'))[0]!.id);
  return Object.fromEntries((await tenanterI(v.db, id)).map((t) => [t.slug, t.tilstand]));
};

test('cohorts in order: intern, then (after 10 min healthy) kanari, then (after 1 hour) alle; each counted on its own /health', async () => {
  const v = await fire();
  const s = await startUdrulning(v.d, NY.tag);
  assert.equal(s.planlagt, 5);
  let r = await fremad(v.d);
  assert.deepEqual(opgraderinger(v.kald), [`opgrader ${I} ny`]);
  assert.equal(r.tilstand, 'koerer');
  assert.ok(r.ventTil, 'soaking after intern');
  // Not a minute early.
  v.ur.frem(r.ventTil!.getTime() - v.ur.nu().getTime() - MIN);
  r = await fremad(v.d);
  assert.deepEqual(opgraderinger(v.kald), [`opgrader ${I} ny`]);
  v.ur.frem(MIN);
  r = await fremad(v.d);
  assert.deepEqual(opgraderinger(v.kald), [`opgrader ${I} ny`, `opgrader ${K} ny`]);
  assert.ok(r.ventTil);
  assert.ok(r.ventTil!.getTime() - v.ur.nu().getTime() > 59 * MIN);
  v.ur.frem(61 * MIN);
  r = await fremad(v.d);
  assert.equal(r.tilstand, 'faerdig');
  assert.equal(r.ventTil, null);
  assert.deepEqual(opgraderinger(v.kald).slice(2).sort(), [A1, A2, A3].map((x) => `opgrader ${x} ny`));
  for (const slug of [I, K, A1, A2, A3]) {
    const t = await raekke(v.db, slug);
    assert.equal(t.release, NY.sha);
    assert.equal(t.billede, NY.id);
    assert.equal(t.adresse, v.beholdere.get(slug)!.adresse, 'the route follows the new container');
    assert.equal(t.opdateres, null);
  }
  assert.deepEqual(new Set(Object.values(await tilstande(v))), new Set(['opgraderet']));
  await v.db.close();
});

test('per tenant: restore point first, then the new image, then the key again; the gateway shows the update page meanwhile', async () => {
  const v = await verden([{ slug: I, hold: 'intern' }]);
  const ruter = ruteTabel({ db: v.db, ttlMs: 0 });
  const set: unknown[] = [];
  const opgrader = v.d.flaade.opgrader;
  v.d.flaade.opgrader = async (t) => { set.push((await ruter.find(I))?.opdateres); return opgrader(t); };
  await startUdrulning(v.d, NY.tag);
  await fremad(v.d);
  assert.deepEqual(set, [true]);
  assert.deepEqual(v.kald, [`opgrader ${I} ny`, `lever ${I} clawco-t-${I}`]);
  const [t] = await tenanterI(v.db, (await aktivUdrulning(v.db))!.id);
  assert.match(t!.genopret!, /^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
  assert.equal(t!.genopretLager, 'lokal');
  assert.equal(t!.fraBillede, GAMMEL.id);
  assert.equal(t!.fraSha, GAMMEL.sha);
  assert.equal((await ruter.find(I))?.opdateres, false);
  assert.equal((await ruter.find(I))?.adresse, v.beholdere.get(I)!.adresse);
  await v.db.close();
});

test('a wrong sha counts as a failure: that tenant is rolled back to its previous image, verified, and the rollout halts', async () => {
  const v = await fire();
  v.luner.set(NY.id, 'fffffff'); // the new image answers, but with another sha (a "Ready" deploy that shipped nothing)
  await startUdrulning(v.d, NY.tag);
  const r = await fremad(v.d);
  assert.equal(r.tilstand, 'standset');
  assert.deepEqual(opgraderinger(v.kald), [`opgrader ${I} ny`, `opgrader ${I} gammel`]);
  assert.equal(v.kald.filter((k) => k.startsWith(`lever ${I}`)).length, 2, 'key delivered after both starts');
  const t = await raekke(v.db, I);
  assert.equal(t.release, GAMMEL.sha);
  assert.equal(t.billede, GAMMEL.id);
  assert.equal(t.opdateres, null);
  assert.equal((await tilstande(v))[I], 'tilbagerullet');
  assert.match((await aktivUdrulning(v.db))!.grund!, /hus-iiiiiiii: .*fffffff/);
  // Halted: nothing else is touched, however often it is run.
  v.ur.frem(2 * 60 * MIN);
  assert.equal((await fremad(v.d)).tilstand, 'standset');
  assert.equal(opgraderinger(v.kald).length, 2);
  await v.db.close();
});

test('one failure in a cohort halts it; tenants already upgraded stay where they are, later cohorts are untouched', async () => {
  const v = await fire();
  await startUdrulning(v.d, NY.tag);
  let r = await fremad(v.d);
  v.ur.frem(11 * MIN); r = await fremad(v.d);
  v.ur.frem(61 * MIN);
  // A2's new container never answers (it answered before its upgrade).
  const opgrader = v.d.flaade.opgrader;
  v.d.flaade.opgrader = async (t) => { if (t.id === A2 && t.billede === NY.id) v.syge.add(A2); if (t.id === A2 && t.billede === GAMMEL.id) v.syge.delete(A2); return opgrader(t); };
  const foer = v.kald.length;
  r = await fremad(v.d);
  assert.equal(r.tilstand, 'standset');
  const s = await tilstande(v);
  assert.equal(s[I], 'opgraderet');
  assert.equal(s[K], 'opgraderet');
  assert.equal(s[A2], 'tilbagerullet');
  assert.ok(v.kald.slice(foer).includes(`opgrader ${A2} gammel`));
  assert.equal((await raekke(v.db, I)).release, NY.sha);
  await v.db.close();
});

test('a tenant that is not healthy before its upgrade is skipped, never upgraded and then "rolled back" into a broken state', async () => {
  const v = await verden([{ slug: I, hold: 'intern' }, { slug: A1, hold: 'alle' }]);
  v.syge.add(I);
  await startUdrulning(v.d, NY.tag);
  assert.equal(await tilEnde(v, fortsaet), 'faerdig');
  assert.deepEqual(opgraderinger(v.kald), [`opgrader ${A1} ny`]);
  assert.equal((await tilstande(v))[I], 'sprunget-over');
  assert.equal((await raekke(v.db, I)).release, GAMMEL.sha);
  await v.db.close();
});

test('no restore point, no upgrade: the tenant is skipped with a count-only ADVARSEL', async () => {
  const v = await verden([{ slug: I, hold: 'intern' }, { slug: A1, hold: 'alle' }]);
  v.fejlNaeste('pak');
  await startUdrulning(v.d, NY.tag);
  await fremad(v.d);
  assert.deepEqual(opgraderinger(v.kald), [`opgrader ${A1} ny`]);
  assert.equal((await tilstande(v))[I], 'sprunget-over');
  const adv = v.log.filter((l) => l.startsWith('ADVARSEL'));
  assert.deepEqual(adv, ['ADVARSEL: 1 kunde sprunget over uden genopretningspunkt (ingen opdatering uden et)']);
  assert.ok(!adv.some((l) => l.includes(I)), 'count only');
  await v.db.close();
});

test('killed mid-tenant and run again: it continues, and no tenant is upgraded twice or skipped', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }, { slug: A2, hold: 'alle' }, { slug: A3, hold: 'alle' }]);
  await startUdrulning(v.d, NY.tag);
  class Draebt extends Error {}
  // The command dies right after A1's new container answered, before the tenant row is written.
  v.fejlNaeste('noterKoersel', new Draebt('kill -9'));
  await assert.rejects(fremad(v.d), Draebt);
  assert.equal(await tilEnde(v, (d) => fortsaet({ ...d, ejer: 'en-anden' })), 'faerdig');
  const pr = new Map<string, number>();
  for (const k of opgraderinger(v.kald)) pr.set(k, (pr.get(k) ?? 0) + 1);
  assert.deepEqual([...pr.values()], [1, 1, 1]);
  assert.equal(pr.size, 3);
  assert.deepEqual(await tilstande(v), { [A1]: 'opgraderet', [A2]: 'opgraderet', [A3]: 'opgraderet' });
  for (const slug of [A1, A2, A3]) assert.equal((await raekke(v.db, slug)).opdateres, null);
  await v.db.close();
});

test('a tenant that turns unhealthy during the soak is rolled back and the rollout halts before the next cohort', async () => {
  const v = await fire();
  await startUdrulning(v.d, NY.tag);
  await fremad(v.d);
  v.ur.frem(5 * MIN);
  v.syge.add(I);
  const r = await fremad(v.d);
  assert.equal(r.tilstand, 'standset');
  assert.deepEqual(opgraderinger(v.kald), [`opgrader ${I} ny`, `opgrader ${I} gammel`]);
  await v.db.close();
});

test('fortsaet after a halt carries on with the rest; the failed tenant stays on its previous release', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }, { slug: A2, hold: 'alle' }, { slug: A3, hold: 'alle' }]);
  await startUdrulning(v.d, NY.tag);
  v.fejlNaeste('opgrader');
  const r1 = await fremad(v.d);
  assert.equal(r1.tilstand, 'standset');
  assert.equal(await tilEnde(v, fortsaet), 'faerdig');
  const s = await tilstande(v);
  assert.equal(Object.values(s).filter((x) => x === 'tilbagerullet').length, 1);
  assert.equal(Object.values(s).filter((x) => x === 'opgraderet').length, 2);
  await v.db.close();
});

test('a second rollout cannot start while one is active; a rollout only plans tenants not on the release', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }]);
  await startUdrulning(v.d, NY.tag);
  await assert.rejects(startUdrulning(v.d, FORKERT.tag), /allerede/);
  assert.equal(await tilEnde(v, fremad), 'faerdig');
  const igen = await startUdrulning(v.d, NY.tag);
  assert.deepEqual(igen, { id: null, planlagt: 0, kanari: [] });
  await v.db.close();
});

test('starting fills kanari to at least one tenant from alle and keeps it for later rollouts', async () => {
  const v = await verden([{ slug: I, hold: 'intern' }, { slug: A1, hold: 'alle' }, { slug: A2, hold: 'alle' }]);
  const s = await startUdrulning(v.d, NY.tag);
  assert.equal(s.kanari.length, 1);
  assert.equal((await raekke(v.db, s.kanari[0]!)).hold, 'kanari');
  await v.db.close();
});

test('status: the cohort, counts per cohort and state, the slugs that need a look, and when the soak ends', async () => {
  const v = await fire();
  await startUdrulning(v.d, NY.tag);
  await fremad(v.d);
  const st = await udrulStatus(v.d);
  assert.equal(st.udrulning!.hold, 'intern');
  assert.equal(st.udrulning!.udgave.tag, NY.tag);
  assert.deepEqual(st.antal.intern, { opgraderet: 1 });
  assert.deepEqual(st.antal.alle, { venter: 3 });
  assert.deepEqual(st.problemer, []);
  assert.equal(st.ventTil!.toISOString(), new Date(v.ur.nu().getTime() + 10 * MIN).toISOString());
  await v.db.close();
});

test('a second command refuses while another one holds the lease, and may continue once it has expired', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }]);
  const s = await startUdrulning(v.d, NY.tag);
  assert.equal(await tagLaas(v.db, s.id!, 'den-foerste', v.ur.nu(), new Date(v.ur.nu().getTime() + 2 * MIN)), true);
  await assert.rejects(fremad(v.d), /en anden/);
  assert.deepEqual(v.kald, []);
  v.ur.frem(3 * MIN);
  assert.equal(await tilEnde(v, fremad), 'faerdig');
  await v.db.close();
});
