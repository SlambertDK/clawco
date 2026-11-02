// KC-0124: the test world's moment "Sat på pause". Its pause.json and audit
// lines live in the test world's own data dir; the page shows the band with
// Start igen (the test world's person is the owner), new runs are refused, and
// jumping to another moment runs again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden, type Testverden } from '../../src/testtilstand/verden.ts';
import { lavRevisionslog } from '../../src/graenser/revisionslog.ts';

async function medVerden(fn: (v: Testverden, dir: string) => Promise<void>): Promise<void> {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-pause-'));
  const dir = path.join(rod, 'data-test');
  try { await fn(await lavTestverden({ dataDir: dir, delayMs: 0 }), dir); } finally { await rm(rod, { recursive: true, force: true }); }
}
const post = (v: Testverden, url: string, body: unknown = {}) => v.app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const pause = async (v: Testverden): Promise<boolean> => ((await (await v.app.request('/health')).json()) as { pause: boolean }).pause;

test('"Sat på pause": the band, Start igen for the owner, the audit log with refusals, and 503 on new runs — all in the test dir', async () => {
  await medVerden(async (v, dir) => {
    assert.equal(await pause(v), false, 'the first moment runs');
    assert.deepEqual(await v.hop('pause'), { url: '/rum/hjem' });
    assert.equal(await pause(v), true);
    assert.ok((await readdir(dir)).includes('pause.json'));

    const hjem = await (await v.app.request('/rum/hjem')).text();
    assert.match(hjem, /data-nodstop="pause"/);
    assert.match(hjem, /Maja stoppede alt kl\. 07\.52\./);
    assert.match(hjem, /data-nodstop="genoptag"[^>]*>Start igen</);

    const koe = (await (await v.app.request('/api/koe')).json()) as { revision: string };
    assert.match(koe.revision, /Maja trykkede Stop alt/);
    assert.match(koe.revision, /Mail: sagde nej til at skrive til andre/);
    assert.match(koe.revision, /data-nej/);
    assert.deepEqual(await lavRevisionslog(dir).tjekKaede(), { ok: true });

    assert.equal((await post(v, '/api/rum/hjem/chat', { besked: 'Hvad nu?' })).status, 503);
  });
});

test('Start igen in the paused moment resumes; jumping away and back reseeds the pause', async () => {
  await medVerden(async (v) => {
    await v.hop('pause');
    assert.equal((await post(v, '/api/nodstop/genoptag')).status, 200);
    assert.equal(await pause(v), false);
    const linjer = ((await (await v.app.request('/api/revision')).json()) as { linjer: { udfald: string }[] }).linjer;
    assert.equal(linjer[0]?.udfald, 'genoptag');

    await v.hop('pause');
    assert.equal(await pause(v), true, 'the moment is paused again');
    await v.hop('morgen');
    assert.equal(await pause(v), false, 'another moment runs');
    const side = await (await v.app.request('/rum/hjem')).text();
    assert.doesNotMatch(side, /data-nodstop="pause"/);
    assert.match(side, /data-nodstop="stop"/);
  });
});
