// KC-0186 (AGENTS §0 r1): a release must run on data written by the previous release, or a rollback would not
// work. Before a rollout starts, the new image runs on a fresh scratch disk until its /health shows the new sha,
// then the previous image runs on that same disk until /health shows the previous sha; otherwise the release is
// refused and no rollout is created. Scratch is always removed. A stub image runner stands in for Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrerUdgave, tjekKompatibilitet } from '../../../src/drift/udrulning/udgave.ts';
import { startUdrulning } from '../../../src/drift/udrulning/udrul.ts';
import { GAMMEL, NY, verden } from './hjaelp.ts';

test('the new image runs on a fresh disk, then the old one on the same disk; scratch is removed', async () => {
  const v = await verden([]);
  await tjekKompatibilitet(v.d, NY, GAMMEL);
  const k = (v.d.koerer as unknown as { kald: string[] }).kald;
  const disk = 'clawco-u-00000000-data';
  assert.deepEqual(k, [
    `nyDisk ${NY.id}`,
    `start ${NY.id} ${disk}`, 'stop clawco-u-00000000',
    `start ${GAMMEL.id} ${disk}`, 'stop clawco-u-00000000',
    'stop clawco-u-00000000', `fjernDisk ${disk}`,
  ]);
  await v.db.close();
});

test('the old image not starting on data the new one wrote fails the release, and scratch is still removed', async () => {
  const v = await verden([]);
  v.uforenelige.add(GAMMEL.id);
  await assert.rejects(tjekKompatibilitet(v.d, NY, GAMMEL), /kan ikke rulles tilbage/);
  const k = (v.d.koerer as unknown as { kald: string[] }).kald;
  assert.equal(k.at(-1), 'fjernDisk clawco-u-00000000-data');
  await v.db.close();
});

test('a new image that does not answer on a fresh disk fails the release too', async () => {
  const v = await verden([]);
  v.defekte.add(NY.id);
  await assert.rejects(tjekKompatibilitet(v.d, NY, GAMMEL), /den nye udgave/);
  await v.db.close();
});

test('a new image whose container dies at start fails the release with that reason, not a cleanup error (found live 2026-11-01)', async () => {
  const v = await verden([]);
  const k = v.d.koerer;
  const start = k.start.bind(k);
  k.start = async (billede, disk) => {
    if (billede === NY.id) throw new Error('beholderen clawco-u-00000000 stoppede med det samme');
    return start(billede, disk);
  };
  k.fjernDisk = async () => { throw new Error('Docker: volume rm fejlede (1): volume is in use'); };
  await assert.rejects(tjekKompatibilitet(v.d, NY, GAMMEL), (err: Error) => {
    assert.match(err.message, /^den nye udgave starter ikke på en ny disk: beholderen clawco-u-00000000 stoppede med det samme/);
    assert.match(err.message, /oprydningen fejlede: Docker: volume rm/);
    return true;
  });
  await v.db.close();
});

test('a release is a local tag recorded with its image id and sha; a missing image or a moved tag is refused', async () => {
  const v = await verden([]);
  assert.deepEqual(await registrerUdgave(v.d, NY.tag), { tag: NY.tag, sha: NY.sha, billedeId: NY.id });
  assert.deepEqual(await registrerUdgave(v.d, NY.tag), { tag: NY.tag, sha: NY.sha, billedeId: NY.id });
  await assert.rejects(registrerUdgave(v.d, 'clawco:findesikke'), /findes ikke/);
  await assert.rejects(registrerUdgave(v.d, 'clawco:latest; rm -rf'), /ugyldigt/);
  await v.db.query('UPDATE drift.udgave SET billede_id = $1 WHERE tag = $2', [`sha256:${'f'.repeat(64)}`, NY.tag]);
  await assert.rejects(registrerUdgave(v.d, NY.tag), /andet billede/);
  await v.db.close();
});

test('startUdrulning with a release the previous one cannot run after creates no rollout', async () => {
  const v = await verden([{ slug: 'hus-aaaaaaaa', hold: 'intern' }]);
  v.uforenelige.add(GAMMEL.id);
  await assert.rejects(startUdrulning(v.d, NY.tag), /kan ikke rulles tilbage/);
  assert.equal((await v.db.query('SELECT * FROM drift.udrulning')).length, 0);
  assert.deepEqual(v.kald, []);
  await v.db.close();
});
