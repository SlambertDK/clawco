// KC-0186: the operator's rollout command. `start` and `fortsaet` run in the foreground pass after pass, sleeping
// through each soak, until the rollout is done or halts; killed, `fortsaet` carries on. Output is counts and slugs
// only. Exit 0 done, 1 halted or failed, 2 usage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kommando } from '../../scripts/udrul.ts';
import { NY, raekke, verden } from '../drift/udrulning/hjaelp.ts';

const I = 'hus-iiiiiiii';
const A1 = 'hus-aaaaaaaa';
const A2 = 'hus-bbbbbbbb';

async function stativ() {
  const v = await verden([{ slug: I, hold: 'alle' }, { slug: A1, hold: 'alle' }, { slug: A2, hold: 'alle' }]);
  const ud: string[] = [];
  const sove: number[] = [];
  const sov = async (ms: number) => { sove.push(ms); v.ur.frem(ms); };
  const k = (...argv: string[]) => kommando(argv, v.d, (l) => ud.push(l), sov);
  return { v, ud, sove, k };
}

test('usage: no or unknown command, a bad cohort → 2', async () => {
  const s = await stativ();
  assert.equal(await s.k(), 2);
  assert.equal(await s.k('rul'), 2);
  assert.equal(await s.k('hold', I, 'beta'), 2);
  assert.match(s.ud.at(-1)!, /^brug: udrul\.ts /);
  await s.v.db.close();
});

test('hold marks the internal test tenant by its slug (never hardcoded); an unknown slug → 1', async () => {
  const s = await stativ();
  assert.equal(await s.k('hold', I, 'intern'), 0);
  assert.equal((await raekke(s.v.db, I)).hold, 'intern');
  assert.equal(await s.k('hold', 'hus-zzzzzzzz', 'intern'), 1);
  await s.v.db.close();
});

test('start runs every cohort through its soak to the end and says so in counts', async () => {
  const s = await stativ();
  await s.k('hold', I, 'intern');
  assert.equal(await s.k('start', NY.tag), 0);
  for (const slug of [I, A1, A2]) assert.equal((await raekke(s.v.db, slug)).release, NY.sha);
  assert.ok(s.sove.length >= 2, 'slept through the intern and kanari soaks');
  assert.ok(s.sove.every((ms) => ms <= 60_000), 'wakes at least every minute to re-check the soaking tenants');
  assert.ok(s.ud.some((l) => /3 kunder planlagt \(intern 1, kanari 1, alle 1\)/.test(l)));
  assert.match(s.ud.at(-1)!, /færdig/);
  await s.v.db.close();
});

test('a halt ends the command with 1 and names the tenant; status shows counts and the slugs that need a look', async () => {
  const s = await stativ();
  await s.k('hold', I, 'intern');
  s.v.luner.set(NY.id, 'fffffff');
  assert.equal(await s.k('start', NY.tag), 1);
  assert.ok(s.ud.some((l) => l.includes('standset') && l.includes(I)));
  s.ud.length = 0;
  assert.equal(await s.k('status'), 0);
  assert.match(s.ud.join('\n'), /udrulning \d+ af clawco:bbbbbbb: standset \(hold intern\)/);
  assert.match(s.ud.join('\n'), /intern: 1 tilbagerullet/);
  assert.match(s.ud.join('\n'), /kræver et kig: hus-iiiiiiii \(tilbagerullet\)/);
  assert.ok(!s.ud.join('\n').includes('sha256:'), 'no image ids in the status');
  // tilbage: nothing was upgraded, so nothing more to roll back; the rollout ends.
  assert.equal(await s.k('tilbage'), 0);
  s.ud.length = 0;
  await s.k('status');
  assert.match(s.ud.join('\n'), /tilbagerullet/);
  await s.v.db.close();
});

test('status with no rollout ever says so', async () => {
  const s = await stativ();
  assert.equal(await s.k('status'), 0);
  assert.deepEqual(s.ud, ['ingen udrulning endnu']);
  await s.v.db.close();
});
