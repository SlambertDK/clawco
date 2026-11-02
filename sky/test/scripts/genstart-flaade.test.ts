// KC-0217: the operator's "recreate every klar tenant's container with the current environment" — no new image,
// no new release. It is what puts SKY_KONTO_PUBKEY_NY into tenants that already run (a container's environment is
// fixed when it is created). Same order as a rollout (intern, kanari, alle), one tenant at a time, the same
// health wait, stops on the first failure, and --dry-run touches nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genstartFlaade, kommando } from '../../scripts/genstart-flaade.ts';
import { startUdrulning } from '../../src/drift/udrulning/udrul.ts';
import { GAMMEL, NY, raekke, verden } from '../drift/udrulning/hjaelp.ts';

const I = 'hus-iiiiiiii';
const K = 'hus-kkkkkkkk';
const A1 = 'hus-aaaaaaaa';
const A2 = 'hus-bbbbbbbb';

const stativ = () => verden([{ slug: A1, hold: 'alle' }, { slug: K, hold: 'kanari' }, { slug: A2, hold: 'alle' }, { slug: I, hold: 'intern' }]);

test('every klar tenant is recreated on the image it runs now, in cohort order, one at a time, with its key delivered again', async () => {
  const v = await stativ();
  const ud: string[] = [];
  const r = await genstartFlaade(v.d, (l) => ud.push(l));
  assert.deepEqual(r, { genstartet: 4, fejlet: null });
  assert.deepEqual(v.kald.filter((k) => k.startsWith('opgrader')).map((k) => k.split(' ')[1]), [I, K, A1, A2]);
  // Same image (gammel), never a new one; each recreate is followed by its key delivery before the next tenant starts.
  assert.ok(v.kald.filter((k) => k.startsWith('opgrader')).every((k) => k.endsWith(' gammel')));
  assert.deepEqual(v.kald.filter((k) => /^(opgrader|lever)/.test(k)).map((k) => k.split(' ').slice(0, 2).join(' ')), [
    `opgrader ${I}`, `lever ${I}`, `opgrader ${K}`, `lever ${K}`, `opgrader ${A1}`, `lever ${A1}`, `opgrader ${A2}`, `lever ${A2}`,
  ]);
  for (const s of v.slugs) {
    const rk = await raekke(v.db, s);
    assert.equal(rk.billede, GAMMEL.id);
    assert.equal(rk.release, GAMMEL.sha);
    assert.equal(rk.opdateres, null, 'the update page is gone again');
    assert.equal(rk.adresse, v.beholdere.get(s)!.adresse, 'the route follows the new container');
  }
  assert.deepEqual(ud, [`${I}: genstartet`, `${K}: genstartet`, `${A1}: genstartet`, `${A2}: genstartet`, '4 genstartet, 0 fejlede']);
  await v.db.close();
});

test('it stops on the first failure: that tenant is named, the rest are not touched, and no update page is left standing', async () => {
  const v = await stativ();
  v.fejlNaeste('lever');
  const ud: string[] = [];
  const r = await genstartFlaade(v.d, (l) => ud.push(l));
  assert.equal(r.genstartet, 0);
  assert.equal(r.fejlet, I);
  assert.deepEqual(v.kald.filter((k) => k.startsWith('opgrader')).map((k) => k.split(' ')[1]), [I]);
  assert.equal((await raekke(v.db, I)).opdateres, null);
  assert.match(ud.join('\n'), new RegExp(`${I}: fejlede \\(falsk lever-fejl\\)`));
  assert.match(ud.at(-1)!, /standset/);
  await v.db.close();
});

test('a tenant that does not answer before the restart stops the run without being touched', async () => {
  const v = await stativ();
  v.syge.add(K);
  const r = await genstartFlaade(v.d, () => {});
  assert.deepEqual(r, { genstartet: 1, fejlet: K });
  assert.deepEqual(v.kald.filter((k) => k.startsWith('opgrader')).map((k) => k.split(' ')[1]), [I]);
  await v.db.close();
});

test('--dry-run lists what it would do and changes nothing', async () => {
  const v = await stativ();
  const ud: string[] = [];
  const antal = v.kald.length;
  assert.equal(await kommando(['--dry-run'], v.d, (l) => ud.push(l)), 0);
  assert.equal(v.kald.length, antal);
  assert.deepEqual(ud, [`ville genstarte ${I} (intern)`, `ville genstarte ${K} (kanari)`, `ville genstarte ${A1} (alle)`, `ville genstarte ${A2} (alle)`, '4 ville blive genstartet (ingen ændring: --dry-run)']);
  assert.equal((await raekke(v.db, I)).opdateres, null);
  await v.db.close();
});

test('it refuses while a rollout is active (two operators on one fleet), and a bad argument is usage', async () => {
  const v = await stativ();
  await startUdrulning(v.d, NY.tag);
  const ud: string[] = [];
  assert.equal(await kommando([], v.d, (l) => ud.push(l)), 1);
  assert.match(ud.join('\n'), /udrulning \d+ .*er i gang/);
  assert.equal(v.kald.filter((k) => k.startsWith('opgrader')).length, 0);
  const u2: string[] = [];
  assert.equal(await kommando(['--hurtigt'], v.d, (l) => u2.push(l)), 2);
  assert.match(u2.at(-1)!, /^brug: genstart-flaade\.ts/);
  await v.db.close();
});

test('an empty fleet is a finished job, not an error', async () => {
  const v = await verden([]);
  const ud: string[] = [];
  assert.equal(await kommando([], v.d, (l) => ud.push(l)), 0);
  assert.deepEqual(ud, ['ingen klare kunder at genstarte']);
  await v.db.close();
});
