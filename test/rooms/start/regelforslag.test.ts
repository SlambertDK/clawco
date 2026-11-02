// KC-0227: the rule proposals Nu asks about ("Skal jeg gøre det til en regel?") can be answered in Start too, under
// the explanation card of step 6. Start owns no proposal and no route: it reads the same pending list (RoomDeps.regelforslag)
// and draws the very same card (src/shell/regelforslagkort.ts), whose buttons the one handler in app.js serves in both rooms.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medStart, STARTET } from '../../helpers/start-deps.ts';
import type { RegelSeam } from '../../../src/rooms/start/regelforslag.ts';
import { renderHjem } from '../../../src/rooms/hjem/render.ts';
import { lavForslag, type Regelforslag } from '../../../src/tillid/forslag.ts';
import { startRoom } from '../../../src/rooms/start/room.ts';
import type { StartState } from '../../../src/rooms/start/schema.ts';

const NOW = new Date('2026-11-01T10:00:00Z');
const RET: StartState = { startet: STARTET, trin: { 'foerste-ret': { status: 'klaret' } }, afvist: {}, ret: { art: 'ret', tid: '2026-10-31T08:30:00.000Z', titel: 'Elregningen', kortId: 'k1', tekst: 'Den hører til i det private regnskab' } };
const forslag = (o: Partial<Regelforslag> = {}, kortId = 'k1'): Regelforslag => ({
  ...lavForslag({ titel: 'Elregninger i det private regnskab', tekst: 'Regninger fra elselskabet skrives i det private regnskab.', trin: 2, gaelder: { kilde: 'mail', slags: 'regning' } }, { kort: { id: kortId, titel: 'Elregningen' }, art: 'ret', nu: NOW }),
  ...o,
});
const ventende = (...f: Regelforslag[]): RegelSeam => ({ afventer: async () => f });
/** Nu's band gives each of its elements a `data-id` for the live swap; Start's card is inside a step, so it has none. */
const udenId = (k: string): string => k.replace(/ data-id="[^"]*"/, '');
/** The proposal cards in a page, each as its own tag-and-all string. */
const kortene = (h: string): string[] => h.match(/<article[^>]*data-regelforslag="[^"]*"[\s\S]*?<\/article>/g) ?? [];

test('a pending proposal is a card under the explanation, with the three answers Nu offers and the same attributes', async () => {
  const f = forslag();
  await medStart({ state: RET, regelforslag: ventende(f) }, async (s) => {
    const h = await s.main();
    const [k, ...flere] = kortene(h);
    assert.equal(flere.length, 0);
    assert.match(k!, /Elregninger i det private regnskab/);
    assert.match(k!, new RegExp(`<button type="button" class="btn btn-primary" data-regelforslag-ja="${f.id}">Ja, gør det til en regel</button>`));
    assert.match(k!, /data-ask="Forslag: Elregninger i det private regnskab"[\s\S]*Ret reglen/);
    assert.match(k!, new RegExp(`data-regelforslag-nej="${f.id}">Nej tak</button>`));
    assert.doesNotMatch(k!, /data-aktion/, 'no handling of Start\'s own: the answer goes through the one proposal route');
    assert.ok(h.indexOf('data-tillidskort') < h.indexOf('data-regelforslag="'), 'the explanation first, the proposal under it');
  });
});

test('it is the same card as in Nu: the markup equals Nu\'s, but for Start\'s coverage mark', async () => {
  const f = forslag();
  await medStart({ state: RET, regelforslag: ventende(f) }, async (s) => {
    const iStart = kortene(await s.main())[0]!.replace(` data-regelforslag-start="${f.id}"`, '');
    const iNu = udenId(kortene(String(renderHjem({ hilsen: 'Goddag', venter: [], hermes: [], now: NOW, regelforslag: [f] })))[0]!);
    assert.equal(iStart, iNu);
  });
});

test('a pause proposal (the Sunday sample) is the same card in Start as in Nu', async () => {
  const p = forslag({ kunPause: true, pauser: 'R-0001', titel: 'Sæt «Nyhedsbreve» på pause' }, 'skjult:x');
  await medStart({ state: RET, regelforslag: ventende(p) }, async (s) => {
    const k = kortene(await s.main())[0]!;
    assert.match(k, /data-regelforslag-pause="R-0001"/);
    assert.match(k, /Ja, sæt den på pause/);
    assert.equal(k.replace(` data-regelforslag-start="${p.id}"`, ''), udenId(kortene(String(renderHjem({ hilsen: 'Goddag', venter: [], hermes: [], now: NOW, regelforslag: [p] })))[0]!));
  });
});

test('several pending proposals are one card each', async () => {
  await medStart({ state: RET, regelforslag: ventende(forslag(), forslag({}, 'k2')) }, async (s) => {
    assert.equal(kortene(await s.main()).length, 2);
  });
});

test('nothing pending: the explanation card alone — no seam, an empty list, a list that fails', async () => {
  const brudt: RegelSeam = { afventer: async () => { throw new Error('læsning fejlede'); } };
  for (const seam of [undefined, ventende(), brudt]) {
    await medStart({ state: RET, ...(seam ? { regelforslag: seam } : {}) }, async (s) => {
      const h = await s.main();
      assert.match(h, /data-tillidskort/);
      assert.deepEqual(kortene(h), []);
    });
  }
});

test('before a first Ret there is no explanation card and no proposal, and nothing is asked for', async () => {
  let spurgt = 0;
  const seam: RegelSeam = { afventer: async () => { spurgt++; return [forslag()]; } };
  await medStart({ regelforslag: seam }, async (s) => {
    const h = await s.main();
    assert.doesNotMatch(h, /data-tillidskort/);
    assert.deepEqual(kortene(h), []);
    assert.equal(spurgt, 0);
  });
});

test('Start has no answer of its own: the old regel-ja and regel-nej are gone', async () => {
  await medStart({ state: RET, regelforslag: ventende(forslag()) }, async (s) => {
    for (const navn of ['regel-ja', 'regel-nej']) {
      assert.equal(await startRoom.startAction!(s.d, navn, { forslagId: forslag().id }), null, `${navn} is not a handling of Start`);
      assert.equal(startRoom.aktionVerber?.[navn], undefined);
    }
  });
});

test('proposal text is escaped', async () => {
  await medStart({ state: RET, regelforslag: ventende(forslag({ titel: 'Regel <script>alert(1)</script>', tekst: 'Tekst "med" <b>fed</b> & mere' })) }, async (s) => {
    const h = await s.main();
    assert.doesNotMatch(h, /<script>alert/);
    assert.doesNotMatch(h, /<b>fed<\/b>/);
    assert.match(h, /&lt;script&gt;/);
  });
});
