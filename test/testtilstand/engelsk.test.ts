// KC-0170: the test world's moment `engelsk` is the morning with a profile that chose English in Start, so every
// room can be looked at in English (live:tjek --test walks it like any other moment).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ALLE_MOMENTER, MOMENTER, froe } from '../../src/testtilstand/indhold.ts';
import { ENGELSK } from '../../src/testtilstand/indhold/fakta.ts';
import { lavTestverden } from '../../src/testtilstand/verden.ts';
import { ROOMS } from '../../src/rooms/registry.ts';

const DAG = '2026-10-26';
const rod = await mkdtemp(path.join(tmpdir(), 'kc-engelsk-'));
after(() => rm(rod, { recursive: true, force: true }));

test('engelsk is the morning plus an English profile; it is not part of the day\'s order', () => {
  assert.ok(ALLE_MOMENTER.some((m) => m.id === ENGELSK));
  assert.ok(!MOMENTER.some((m) => m.id === ENGELSK));
  const { profil, rum: engelskeRum, ...resten } = froe(ENGELSK, DAG);
  const { rum: danskeRum, ...danskeResten } = froe('morgen', DAG);
  assert.deepEqual(profil, { navn: 'Henrik', sprog: 'en', husstand: 'husstand' });
  assert.equal(JSON.stringify(resten), JSON.stringify(danskeResten));
  // KC-0244: the cards of the front page's screenshots (Mail's decision, Husstanden's request and cars) are written in English;
  // every other room is the Danish morning exactly (test/testtilstand/site-engelsk.test.ts holds the English words).
  const oversat = ['mail', 'husstand'];
  assert.deepEqual(Object.keys(engelskeRum), Object.keys(danskeRum));
  for (const r of Object.keys(danskeRum).filter((x) => !oversat.includes(x))) assert.equal(JSON.stringify(engelskeRum[r]), JSON.stringify(danskeRum[r]), r);
  for (const r of oversat) assert.notEqual(JSON.stringify(engelskeRum[r]), JSON.stringify(danskeRum[r]), r);
  assert.equal(froe('morgen', DAG).profil, undefined, 'the Danish day has no profile, like the reference installation');
});

test('at engelsk every built room answers in English: <html lang="en"> and the nav says Now', async () => {
  const v = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
  assert.ok(await v.hop(ENGELSK));
  for (const r of ROOMS.filter((x) => x.built)) {
    const res = await v.app.request(`/rum/${r.id}`);
    assert.equal(res.status, 200, r.id);
    const doc = await res.text();
    assert.match(doc, /<html lang="en">/, r.id);
    assert.match(doc, /<span>Now<\/span>/, r.id);
  }
  await v.hop('morgen');
  assert.match(await (await v.app.request('/rum/hjem')).text(), /<html lang="da">/);
});
