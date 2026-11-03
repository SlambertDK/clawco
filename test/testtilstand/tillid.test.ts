// KC-0142 in the test world: every moment seeds a fictional rules file (one
// rule per trin 1–4 and one written wrong) in the world's own vault, the app
// reads it into the prompt; "Næste morgen" has a file Henrik broke in the
// night, so Nu shows "Reglerne kan ikke læses".

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden } from '../../src/testtilstand/verden.ts';
import { FORBUDT, MOMENTER } from '../../src/testtilstand/indhold.ts';
import { reglerTekst } from '../../src/testtilstand/indhold/tillid.ts';
import { parseRegler } from '../../src/tillid/regler.ts';
import { createApp } from '../../src/server.ts';
import { createFileStore } from '../../src/store/fileStore.ts';
import { createFakeAgent } from '../../src/agent/fake.ts';
import { TEST_EJER } from '../../src/testtilstand/indhold/husstand.ts';

const rod = await mkdtemp(path.join(tmpdir(), 'kc-tillid-verden-'));
after(() => rm(rod, { recursive: true, force: true }));

test('the seed: one valid rule per trin 0–4 (KC-0143) and one invalid, fictional only', () => {
  const s = parseRegler(reglerTekst('morgen', '2026-11-02'));
  assert.deepEqual(s.regler.map((r) => r.trin).sort(), [0, 1, 2, 3, 4]);
  assert.equal(s.ugyldige.length, 1);
  assert.ok(s.naesteId > Math.max(...s.regler.map((r) => Number(r.id.slice(2)))), 'a deleted id stays taken');
  for (const m of MOMENTER) {
    const t = reglerTekst(m.id, '2026-11-02');
    for (const ord of FORBUDT) assert.ok(!t.includes(ord), `${m.id}: ${ord}`);
  }
  assert.throws(() => parseRegler(reglerTekst('naeste-morgen', '2026-11-02')), 'the next morning\'s file is broken');
});

test('the seeded rules reach the prompt (fake Hermes captures it); the broken moment shows the card', async () => {
  const dir = path.join(rod, 'data-test');
  const v = await lavTestverden({ dataDir: dir, delayMs: 0 });
  const hermes = createFakeAgent({ answer: () => 'Ja.' });
  const app = createApp({ store: createFileStore(dir), hermes, sourceGlob: path.join(dir, 'avis_{date}.json'), dataDir: dir, vaultInbox: path.join(dir, 'vault', '00-Indbakke'), mailRunner: async () => ({ code: 0, stdout: '[]', stderr: '' }), identitet: { fast: TEST_EJER } }).app;
  const res = await app.request('/api/rum/hjem/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ besked: 'Hvad må du?' }) });
  assert.equal(res.status, 202);
  for (let i = 0; i < 200 && hermes.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  const instr = hermes.calls[0]?.instructions ?? '';
  for (const trin of [0, 1, 2, 3, 4]) assert.match(instr, new RegExp(`R-000\\d · trin ${trin} · `));
  assert.match(instr, /R-0005 · Betal regninger selv: skrevet forkert, følges ikke/);
  assert.doesNotMatch(await (await v.app.request('/rum/hjem')).text(), /Reglerne kan ikke læses/);

  await v.hop('naeste-morgen');
  const hjem = await (await v.app.request('/rum/hjem')).text();
  assert.match(hjem, /data-element="Reglerne kan ikke læses"/);
  // KC-0143: with the file broken nothing above trin 0 is done on its own — the night's bill waits as a card.
  assert.match(hjem, /data-kraever-regel>Jeg må ikke bogføre dette endnu: hvilken regel skal dække det\?</);
  await v.hop('morgen');
  assert.doesNotMatch(await (await v.app.request('/rum/hjem')).text(), /Reglerne kan ikke læses/);
});

test('KC-0146: Slet alt in the test world empties the world\'s own data dir only; its vault notes stay; a jump reseeds', async () => {
  const dir = path.join(rod, 'slet-test');
  const ved = path.join(rod, 'naboen');
  await mkdir(ved, { recursive: true });
  await writeFile(path.join(ved, 'rigtig.json'), '{}', 'utf8');
  const v = await lavTestverden({ dataDir: dir, delayMs: 0 });
  const side = await (await v.app.request('/viden/slet-alt')).text();
  assert.match(side, /data-slet-alt="bekraeft"/);
  const res = await v.app.request('/api/tillid/slet-alt', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'bekraeft=SLET' });
  assert.equal(res.status, 303);
  const rester = (await readdir(dir)).sort();
  assert.deepEqual(rester.filter((n) => !/^revision-\d{4}-\d{2}\.jsonl$/.test(n)), ['husstand.json', 'pause.json', 'revision.anker', 'vault'], 'the vault, and what Slet alt keeps by design (KC-0275): the household, the pause and the fresh audit log with its anchor');
  assert.equal(rester.filter((n) => /^revision-/.test(n)).length, 1, 'one fresh audit log (the tombstone)');
  assert.deepEqual(await readdir(path.join(dir, 'vault', 'Clawco')), [], 'its Clawco folder is empty');
  assert.ok((await readdir(path.join(dir, 'vault', '40-Mennesker', 'People'), { recursive: true })).some((n) => n.endsWith('.md')), 'the invented people stay');
  assert.deepEqual(await readdir(ved), ['rigtig.json'], 'nothing next to the world is touched');
  assert.match(await (await v.app.request('/viden?slettet=1')).text(), /Alt er slettet/);
  await v.hop(MOMENTER[0]!.id);
  assert.ok((await readdir(dir)).includes('rum'), 'a jump seeds the world again');
});
