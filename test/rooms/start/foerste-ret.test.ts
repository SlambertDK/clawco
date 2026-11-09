// KC-0130: step 6 (foerste-ret). Klaret reads the recorded first Ret / Ikke relevant, never a button;
// the recorder is a listener on the real events, and it ignores what happened before Start began.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { alleTrin, trinStatus } from '../../../src/rooms/start/trin.ts';
import { parseStartState, type StartState } from '../../../src/rooms/start/schema.ts';
import { modtagRet } from '../../../src/rooms/start/ret.ts';
import { createFileStore } from '../../../src/store/fileStore.ts';
import { createLiveBus } from '../../../src/live.ts';
import type { RoomDeps } from '../../../src/rooms/module.ts';

const STARTET = '2026-10-31T08:00:00.000Z';
const tom: StartState = { startet: STARTET, trin: {}, afvist: {} };
const trin = () => alleTrin().find((t) => t.id === 'foerste-ret')!;

async function medDeps(state: StartState | null, fn: (d: RoomDeps, s: { laes: () => Promise<StartState | null>; log: () => Promise<string[]>; notifs: string[] }) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-foerste-ret-'));
  try {
    const store = createFileStore(dir);
    if (state) await store.writeState('start', state);
    const live = createLiveBus();
    const notifs: string[] = [];
    live.subscribe('start', () => notifs.push('start'));
    const d = { store, live, now: () => new Date('2026-10-31T09:00:00Z'), person: { id: 'henrik', login: null, navn: 'Henrik', rolle: 'ejer' } } as unknown as RoomDeps;
    await fn(d, { laes: async () => parseStartState(await store.readState('start')), log: async () => (await store.readLog('start', 20)).map((e) => e.tekst), notifs });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
const haendelse = (o: Partial<Parameters<typeof modtagRet>[1]> = {}) => ({ art: 'ret' as const, tid: '2026-10-31T09:00:00.000Z', titel: 'Første kig', ...o });

test('step 6 is the last step of the journey and mandatory', () => {
  assert.equal(alleTrin().at(-1)?.id, 'foerste-ret');
  assert.equal(trin().krav, 'obligatorisk');
});

test('step 6 is Klaret exactly when a first Ret was recorded, whatever the stored status says', () => {
  assert.equal(trin().erKlaret(null, { profil: null }), false);
  assert.equal(trin().erKlaret(tom, { profil: null }), false);
  const rettet: StartState = { ...tom, ret: { art: 'ret', tid: '2026-10-31T09:00:00.000Z', titel: 'Første kig' } };
  assert.equal(trin().erKlaret(rettet, { profil: null }), true);
  const sagt: StartState = { ...tom, trin: { 'foerste-ret': { status: 'klaret' } } };
  assert.equal(trinStatus(trin(), sagt, { profil: null }), 'i-gang', 'a stored klaret without the Ret reopens');
  assert.equal(trinStatus(trin(), { ...tom, trin: { 'foerste-ret': { status: 'sprunget-over' } } }, { profil: null }), 'sprunget-over');
});

test('a Ret completes the step: state, a Start log line, a live notice', async () => {
  await medDeps(tom, async (d, s) => {
    assert.equal(await modtagRet(d, haendelse({ titel: 'Elregningen', kortId: 'k1', tekst: 'Det passer ikke' })), true);
    const st = await s.laes();
    assert.equal(st?.ret?.art, 'ret');
    assert.equal(st?.ret?.titel, 'Elregningen');
    assert.equal(st?.ret?.kortId, 'k1');
    assert.equal(st?.trin['foerste-ret']?.status, 'klaret');
    assert.match((await s.log())[0]!, /Elregningen/);
    assert.deepEqual(s.notifs, ['start']);
  });
});

test('Ikke relevant completes it too', async () => {
  await medDeps(tom, async (d, s) => {
    assert.equal(await modtagRet(d, haendelse({ art: 'ikke-relevant', titel: 'Nyhedsbrev' })), true);
    assert.equal((await s.laes())?.ret?.art, 'ikke-relevant');
  });
});

test('only the first counts: a later Ret does not overwrite or log again', async () => {
  await medDeps(tom, async (d, s) => {
    await modtagRet(d, haendelse({ titel: 'Først' }));
    assert.equal(await modtagRet(d, haendelse({ titel: 'Så' })), false);
    assert.equal((await s.laes())?.ret?.titel, 'Først');
    assert.equal((await s.log()).length, 1);
  });
});

test('a journey already Done (an install latched before step 6 existed) records nothing and writes no log line', async () => {
  await medDeps({ ...tom, faerdig: '2026-10-31T08:30:00.000Z' }, async (d, s) => {
    assert.equal(await modtagRet(d, haendelse()), false);
    assert.equal((await s.laes())?.ret, undefined);
    assert.deepEqual(await s.log(), []);
    assert.deepEqual(s.notifs, []);
  });
});

test('an entry older than Start is ignored, and so is one when Start has no state at all', async () => {
  await medDeps(tom, async (d, s) => {
    assert.equal(await modtagRet(d, haendelse({ tid: '2026-10-31T07:59:59.000Z' })), false);
    assert.equal((await s.laes())?.ret, undefined);
    assert.deepEqual(s.notifs, []);
  });
  await medDeps(null, async (d, s) => {
    assert.equal(await modtagRet(d, haendelse()), false);
    assert.equal(await s.laes(), null, 'nothing is created by a Ret');
  });
});

test('the state keeps a valid ret and regel and drops malformed ones', () => {
  const ok = parseStartState({ ...tom, ret: { art: 'ikke-relevant', tid: STARTET, titel: 'x', kortId: 'k:1', tekst: 'hej' }, regel: { forslag: 'abc123def456', svar: 'ja', tid: STARTET, regelId: 'R-0001' } });
  assert.equal(ok?.ret?.art, 'ikke-relevant');
  assert.equal(ok?.ret?.kortId, 'k:1');
  assert.equal(ok?.regel?.svar, 'ja');
  assert.equal(ok?.regel?.regelId, 'R-0001');
  const daarlig = parseStartState({ ...tom, ret: { art: 'slet', tid: STARTET, titel: 'x' }, regel: { forslag: '', svar: 'maaske', tid: 'nej' } });
  assert.equal(daarlig?.ret, undefined);
  assert.equal(daarlig?.regel, undefined);
});

// ---------- the room: the card, the edge, Spring over, Done ----------

import { medStart } from '../../helpers/start-deps.ts';
import { rejsen, startRoom } from '../../../src/rooms/start/room.ts';

const kort = (h: string): string => /<article[^>]*data-trin="foerste-ret"[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';
const RETTET: StartState = { ...tom, trin: { 'foerste-ret': { status: 'klaret' } }, ret: { art: 'ret', tid: '2026-10-31T08:30:00.000Z', titel: 'Elregningen' } };

test('open step with something in Nu names the element and says what Ret and Ikke relevant do — without a Ret button of its own', async () => {
  await medStart({ forbi: true, nu: { foersteKort: 'Elregningen <b>' } }, async (s) => {
    const k = kort(await s.main());
    assert.match(k, /data-foerste-ret="aaben"/);
    assert.match(k, /Elregningen &lt;b&gt;/, 'the title, escaped');
    assert.match(k, /Ret/);
    assert.match(k, /Ikke relevant/);
    assert.doesNotMatch(k, /data-ask=|class="[^"]*spoerg/, 'one way to do each thing: the card has no Ret button');
    assert.doesNotMatch(k, /data-tillidskort/, 'the explanation waits for the Ret');
  });
});

test('open step with something in Nu but no named card still points at Nu', async () => {
  await medStart({ forbi: true, nu: { foersteKort: null } }, async (s) => {
    assert.match(kort(await s.main()), /data-foerste-ret="aaben"/);
  });
});

test('edge: Nu empty — the step says there is nothing to correct yet, no dead end', async () => {
  await medStart({ forbi: true, nu: { elementer: 0, foersteKort: null } }, async (s) => {
    const k = kort(await s.main());
    assert.match(k, /data-foerste-ret="tom"/);
    assert.match(k, /Der er ikke noget at rette endnu; Hermes lægger det første op, når der er noget/);
  });
});

test('after the Ret the card thanks and shows the one explanation card', async () => {
  await medStart({ state: RETTET, nu: { rettet: true } }, async (s) => {
    const h = await s.main();
    assert.match(kort(h), /data-trin-status="klaret"/);
    assert.match(h, /data-foerste-ret="tak"/);
    assert.match(h, /data-tillidskort/);
  });
});

test('Done: Klaret plus an element latches once, with one "Rejsen er gennemført" line', async () => {
  await medStart({ state: RETTET }, async (s) => {
    assert.equal((await rejsen(s.d)).faerdig, true);
    assert.ok((await s.state())?.faerdig);
    await s.main(); await rejsen(s.d); await Promise.all([rejsen(s.d), rejsen(s.d)]);
    assert.equal((await s.log()).filter((t) => t.includes('Rejsen er gennemført')).length, 1);
  });
});

test('Done is derived: a recorded Ret with nothing in Nu is not Done; an element without a Ret is not Done', async () => {
  await medStart({ state: RETTET, nu: { elementer: 0, foersteKort: null } }, async (s) => {
    assert.equal((await rejsen(s.d)).faerdig, false);
  });
  await medStart({ nu: { rettet: false } }, async (s) => {
    assert.equal((await rejsen(s.d)).faerdig, false);
  });
});

test('Spring over: the step is sprunget-over, Done still needs the one Ret, Start stays and the step still waits in Nu', async () => {
  await medStart({}, async (s) => {
    await s.aktion('ret-spring-over');
    assert.equal((await s.state())?.trin['foerste-ret']?.status, 'sprunget-over');
    assert.equal((await rejsen(s.d)).faerdig, false);
    assert.match(kort(await s.main()), /data-trin-status="sprunget-over"/);
    assert.ok((await startRoom.hjemVenter(s.d)).some((l) => l.tekst.includes('Ret én ting')), 'still a waiting line in Nu');
    // The Ret then comes: Klaret and Done follow, from the event alone.
    await s.d.retBus!.meld(s.d, { art: 'ikke-relevant', tid: '2026-10-31T09:00:00.000Z', titel: 'Nyhedsbrev' });
    assert.equal((await rejsen(s.d)).faerdig, true);
  });
});

test('Spring over is the owner\'s and only while the step is open', async () => {
  await medStart({ person: { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' } }, async (s) => {
    await assert.rejects(s.aktion('ret-spring-over'), /Kun ejeren/);
  });
  await medStart({ state: RETTET }, async (s) => {
    await assert.rejects(s.aktion('ret-spring-over'), /klaret/);
  });
});
