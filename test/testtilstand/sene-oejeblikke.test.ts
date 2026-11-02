// KC-0103: the two moments after the evening. "Sent aften": everything is handled, so Hjem says
// "Alt er ordnet" (KC-0099) and nothing is counted anywhere. "Næste morgen": the clock is on the
// next day and the morning build has not run, so Dagen waits with "Byg Dagen nu" (KC-0095) and
// pressing it builds the new day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lavTestverden, type Testverden } from '../../src/testtilstand/verden.ts';
import { idagKbh } from '../../src/testtilstand/ur.ts';
import { plusDag } from '../../src/testtilstand/indhold/fakta.ts';
import { PRODUKT } from '../../src/shell/navn.ts';

const sov = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function medVerden(fn: (v: Testverden) => Promise<void>): Promise<void> {
  const rod = await mkdtemp(path.join(tmpdir(), 'kc-sene-'));
  try { await fn(await lavTestverden({ dataDir: path.join(rod, 'data-test'), delayMs: 0 })); } finally { await rm(rod, { recursive: true, force: true }); }
}
const side = async (v: Testverden, sti: string): Promise<string> => (await v.app.request(sti)).text();

test('KC-0103: "Sent aften" — nothing waits: Hjem says Alt er ordnet and the title has no number', async () => {
  await medVerden(async (v) => {
    assert.deepEqual(await v.hop('sent-aften'), { url: '/rum/hjem' });
    const hjem = await side(v, '/rum/hjem');
    assert.match(hjem, /class="card alt-ordnet"/);
    assert.match(hjem, /<span>Intet venter på dig<\/span>/);
    assert.match(hjem, new RegExp(`<title>Nu · ${PRODUKT}</title>`));
    assert.match(hjem, /Fødselsdag hos Birthe ligger lørdag/, 'the evening\'s question is handled, and the log says so');
    assert.doesNotMatch(hjem, /Venter på dit svar om lørdag/, 'Hermes\' status line no longer waits on lørdag');
  });
});

test('KC-0103: "Næste morgen" — the clock is on the next day and Dagen waits to be built; Byg Dagen nu builds it', async () => {
  await medVerden(async (v) => {
    assert.deepEqual(await v.hop('naeste-morgen'), { url: '/rum/dagen' });
    assert.equal(idagKbh(v.ur.now()), plusDag(idagKbh(new Date()), 1));
    const dagen = await side(v, '/rum/dagen');
    assert.match(dagen, /data-element="Dagen er ikke bygget i dag"/);
    assert.match(dagen, /<span class="tilstand-kraever">1 venter på dig<\/span>/);
    assert.match(dagen, /friskhed-gammel">fra i går/);
    assert.match(dagen, /id="hermes-status">Venter på at bygge Dagen</);
    assert.match(await side(v, '/rum/hjem'), /Dagen er ikke bygget i dag/, 'Hjem lists it too');
    const res = await v.app.request('/api/rum/dagen/opdater', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'opdater' }) });
    assert.ok(res.ok, `opdater: ${res.status}`);
    for (let i = 0; i < 50 && (await side(v, '/rum/dagen')).includes('Dagen er ikke bygget i dag'); i++) await sov(20);
    const bygget = await side(v, '/rum/dagen');
    assert.doesNotMatch(bygget, /Dagen er ikke bygget i dag/);
    assert.match(bygget, /<span class="friskhed">opdateret 07\.4\d<\/span>/, 'built this morning');
  });
});
