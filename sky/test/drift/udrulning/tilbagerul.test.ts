// KC-0186: rolling a tenant back is starting its previous image (the id it ran before, recorded on its row) on the
// same volume, delivering its key again and seeing /health show the previous sha — then the route follows the new
// container. `tilbage` does that for every tenant a rollout upgraded, and is resumable. A rollback that fails is
// never silent: the tenant row says fejlet, the rollout halts, an ADVARSEL line counts it, and the gateway's update
// page is cleared (a stuck "Opdaterer" would hide that it is down).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fortsaet, fremad, startUdrulning } from '../../../src/drift/udrulning/udrul.ts';
import { tilbage, tilbagerulTenant } from '../../../src/drift/udrulning/tilbagerul.ts';
import { aktivUdrulning, senesteUdrulning, tenanterI } from '../../../src/drift/udrulning/tilstand.ts';
import { GAMMEL, NY, raekke, tilEnde, verden } from './hjaelp.ts';

const A1 = 'hus-aaaaaaaa';
const A2 = 'hus-bbbbbbbb';

test('tilbagerulTenant starts the previous image id on the same volume, delivers the key, verifies the previous sha, moves the route', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }]);
  v.beholdere.set(A1, { billede: NY.id, adresse: 'http://172.18.0.99:8750', koerer: true });
  await tilbagerulTenant(v.d, A1, { billede: GAMMEL.id, sha: GAMMEL.sha });
  assert.deepEqual(v.kald, [`opgrader ${A1} gammel`, `lever ${A1} clawco-t-${A1}`]);
  const t = await raekke(v.db, A1);
  assert.deepEqual([t.billede, t.release, t.adresse, t.opdateres], [GAMMEL.id, GAMMEL.sha, v.beholdere.get(A1)!.adresse, null]);
  await v.db.close();
});

test('a previous image that does not come back with its own sha is a failed rollback (thrown, never assumed)', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }]);
  v.defekte.add(GAMMEL.id);
  await assert.rejects(tilbagerulTenant(v.d, A1, { billede: GAMMEL.id, sha: GAMMEL.sha }), /i stedet for aaaaaaa/);
  await v.db.close();
});

test('a tenant already back on its previous image and healthy is not restarted again', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }]);
  await tilbagerulTenant(v.d, A1, { billede: GAMMEL.id, sha: GAMMEL.sha });
  assert.deepEqual(v.kald, []);
  await v.db.close();
});

test('when the rollback fails too: the tenant is fejlet, the rollout halts, an ADVARSEL counts it, the update page is cleared', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }]);
  await startUdrulning(v.d, NY.tag);
  // From the upgrade on, neither the new image nor the old one answers.
  const opgrader = v.d.flaade.opgrader;
  v.d.flaade.opgrader = async (t) => { v.defekte.add(NY.id); v.defekte.add(GAMMEL.id); return opgrader(t); };
  const r = await fremad(v.d);
  assert.equal(r.tilstand, 'standset');
  const [t] = await tenanterI(v.db, (await aktivUdrulning(v.db))!.id);
  assert.equal(t!.tilstand, 'fejlet');
  assert.match(t!.fejl!, /tilbagerulning fejlede/);
  assert.equal((await raekke(v.db, A1)).opdateres, null);
  assert.deepEqual(v.log.filter((l) => l.startsWith('ADVARSEL')), ['ADVARSEL: 1 kunde kunne ikke rulles tilbage og svarer ikke — se udrul.ts status']);
  await v.db.close();
});

test('a crash-looping container that cannot even be looked at is still replaced by the rollback (found live 2026-11-01)', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }]);
  v.beholdere.set(A1, { billede: NY.id, adresse: 'http://172.18.0.99:8750', koerer: true });
  v.d.flaade.beholder = async () => { throw new Error('beholderen clawco-t-hus-aaaaaaaa har ingen adresse på clawco-sky'); };
  await tilbagerulTenant(v.d, A1, { billede: GAMMEL.id, sha: GAMMEL.sha });
  assert.deepEqual(v.kald, [`opgrader ${A1} gammel`, `lever ${A1} clawco-t-${A1}`]);
  await v.db.close();
});

test('tilbage also takes a tenant whose automatic rollback failed: that is the one down (found live 2026-11-01)', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }]);
  await startUdrulning(v.d, NY.tag);
  const opgrader = v.d.flaade.opgrader;
  v.d.flaade.opgrader = async (t) => { v.defekte.add(NY.id); v.defekte.add(GAMMEL.id); return opgrader(t); };
  assert.equal((await fremad(v.d)).tilstand, 'standset');
  const id = (await aktivUdrulning(v.db))!.id;
  assert.equal((await tenanterI(v.db, id))[0]!.tilstand, 'fejlet');
  // The operator fixes what blocked the old image, then asks for the rollback by hand.
  v.d.flaade.opgrader = opgrader;
  v.defekte.delete(GAMMEL.id);
  assert.deepEqual(await tilbage(v.d), { tilbagerullet: 1, fejlet: 0 });
  const [t] = await tenanterI(v.db, id);
  assert.equal(t!.tilstand, 'tilbagerullet');
  assert.deepEqual([(await raekke(v.db, A1)).billede, (await raekke(v.db, A1)).release], [GAMMEL.id, GAMMEL.sha]);
  await v.db.close();
});

test('tilbage rolls every upgraded tenant of the rollout back, verified, and ends the rollout as tilbagerullet', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }, { slug: A2, hold: 'alle' }]);
  await startUdrulning(v.d, NY.tag);
  // Halfway: the kanari tenant is upgraded and soaking, the other one waits.
  await fremad(v.d);
  const kanari = (await raekke(v.db, A1)).hold === 'kanari' ? A1 : A2;
  assert.equal((await raekke(v.db, kanari)).release, NY.sha);
  const r = await tilbage(v.d);
  assert.deepEqual(r, { tilbagerullet: 1, fejlet: 0 });
  for (const slug of [A1, A2]) assert.equal((await raekke(v.db, slug)).release, GAMMEL.sha);
  const u = await senesteUdrulning(v.db);
  assert.equal(u!.tilstand, 'tilbagerullet');
  assert.equal(await aktivUdrulning(v.db), null);
  await v.db.close();
});

test('tilbage is resumable: killed after the first tenant was back, run again it restarts only the rest', async () => {
  const v = await verden([{ slug: A1, hold: 'alle' }, { slug: A2, hold: 'alle' }]);
  await startUdrulning(v.d, NY.tag);
  assert.equal(await tilEnde(v, fortsaet), 'faerdig');
  // Pretend it was still active: rolled back in full while active is what `tilbage` does.
  await v.db.query("UPDATE drift.udrulning SET slut = NULL");
  // The state a kill leaves: rollout tilbagerulles, A1's container already back on its old image, its row not ended.
  await v.db.query("UPDATE drift.udrulning SET tilstand = 'tilbagerulles'");
  v.beholdere.set(A1, { billede: GAMMEL.id, adresse: 'http://172.18.0.77:8750', koerer: true });
  const foer = v.kald.length;
  const r = await tilbage(v.d);
  assert.deepEqual(r, { tilbagerullet: 2, fejlet: 0 });
  assert.deepEqual(v.kald.slice(foer).filter((k) => k.startsWith('opgrader')), [`opgrader ${A2} gammel`]);
  assert.equal((await raekke(v.db, A1)).adresse, 'http://172.18.0.77:8750');
  assert.equal((await senesteUdrulning(v.db))!.tilstand, 'tilbagerullet');
  await v.db.close();
});
