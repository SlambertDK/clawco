// KC-0259: the test world has the built-in agent's forenoon: the same story as "Morgen", but the world's agent has no tools,
// so every button and suggestion that only works with Hermes' tools is gone from Nu, Nyheder and Mail (not greyed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden } from '../../src/testtilstand/verden.ts';
import { ALLE_MOMENTER } from '../../src/testtilstand/indhold.ts';
import { UDEN_VAERKTOEJ } from '../../src/testtilstand/indhold/fakta.ts';

const MARKOERER: Record<string, RegExp> = {
  '/rum/hjem': /\sdata-kort-handling="/,
  '/rum/nyheder': /\sdata-handling="forslag-/,
  '/rum/dagen': /\sdata-handling="/,
  '/rum/mail': /\sdata-handling="/,
};

test('"Morgen, uden Hermes-værktøjer": Hermes\' buttons and suggestions are on screen in "Morgen" and gone in this moment', async () => {
  assert.ok(ALLE_MOMENTER.some((m) => m.id === UDEN_VAERKTOEJ));
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-uvt-'));
  try {
    const verden = await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 });
    const side = async (sti: string): Promise<string> => (await verden.app.request(sti)).text();
    await verden.hop('morgen');
    for (const [sti, m] of Object.entries(MARKOERER)) assert.match(await side(sti), m, `${sti}: with Hermes the element is there`);
    assert.ok(await verden.hop(UDEN_VAERKTOEJ));
    for (const [sti, m] of Object.entries(MARKOERER)) {
      const ud = await side(sti);
      assert.doesNotMatch(ud, m, `${sti}: without tools the element is gone`);
      assert.ok(ud.length > 2000, `${sti}: the room itself is still there`);
    }
    const hjem = await side('/rum/hjem');
    assert.ok(!hjem.includes('Hermes-forslag') && !hjem.includes('data-nuforslag'), 'no leftover forslag line in Nu');
  } finally { await rm(rod, { recursive: true, force: true }); }
});
