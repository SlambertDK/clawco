// KC-0130: the hand-off to E4 (KC-0108). Start shows E4's rule proposal under the explanation card as
// a beslutning block; a rule is created only by the user's own POST (Ja), once, for the proposal Start
// offered — never by rendering, the listener, the chat or a forged id (spec D6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medStart, STARTET } from '../../helpers/start-deps.ts';
import type { RegelSeam } from '../../../src/rooms/start/regelforslag.ts';
import { forslagId } from '../../../src/rooms/start/regelforslag.ts';
import type { RegelForslag } from '../../../src/graenser/regelforslag.ts';
import type { RetHaendelse } from '../../../src/rooms/rethaendelse.ts';
import type { StartState } from '../../../src/rooms/start/schema.ts';

const RET: StartState = { startet: STARTET, trin: { 'foerste-ret': { status: 'klaret' } }, afvist: {}, ret: { art: 'ret', tid: '2026-10-31T08:30:00.000Z', titel: 'Elregningen', kortId: 'k1', tekst: 'Den hører til i det private regnskab' } };
const FORSLAG: RegelForslag = { titel: 'Elregninger i det private regnskab', tekst: 'Regninger fra elselskabet skrives i det private regnskab.', trin: 2, gaelder: { kilde: 'mail', slags: 'regning' }, oprindelse: { art: 'ret', kortId: 'k1' } };

function stub(o: { svar?: RegelForslag | null | 'kast' } = {}) {
  const kald = { foreslaa: [] as RetHaendelse[], opret: [] as RegelForslag[] };
  const seam: RegelSeam = {
    foreslaaRegel: (h) => { kald.foreslaa.push(h); if (o.svar === 'kast') throw new Error('E4 faldt'); return o.svar === undefined ? FORSLAG : o.svar; },
    opretRegel: async (f) => { kald.opret.push(f); return { id: 'R-0007' }; },
  };
  return { seam, kald };
}
const beslutning = (h: string): string => /<article[^>]*data-blok="beslutning"[^>]*data-regel-forslag[\s\S]*?<\/article>/.exec(h)?.[0] ?? '';

test('a proposal shows as a beslutning block with Ja and Nej, under the explanation card', async () => {
  const { seam, kald } = stub();
  await medStart({ state: RET, regelforslag: seam }, async (s) => {
    const h = await s.main();
    const b = beslutning(h);
    assert.match(b, /Elregninger i det private regnskab/);
    assert.match(b, /data-aktion="regel-ja"/);
    assert.match(b, /Ja, gør det/);
    assert.match(b, /data-aktion="regel-nej"/);
    assert.ok(h.indexOf('data-tillidskort') < h.indexOf('data-regel-forslag'), 'the explanation first, the proposal under it');
    assert.equal(kald.opret.length, 0, 'showing a proposal creates nothing');
    assert.equal(kald.foreslaa[0]?.titel, 'Elregningen');
    assert.equal(kald.foreslaa[0]?.tekst, 'Den hører til i det private regnskab');
  });
});

test('no proposal: the explanation only — null, no seam, a seam that throws, invalid output', async () => {
  for (const svar of [null, 'kast', { titel: '', tekst: 'x', trin: 9, gaelder: { kilde: '' }, oprindelse: { art: 'ret' } } as unknown as RegelForslag] as const) {
    const { seam } = stub({ svar });
    await medStart({ state: RET, regelforslag: seam }, async (s) => {
      const h = await s.main();
      assert.match(h, /data-tillidskort/);
      assert.equal(beslutning(h), '');
    });
  }
  await medStart({ state: RET }, async (s) => {
    const h = await s.main();
    assert.match(h, /data-tillidskort/);
    assert.equal(beslutning(h), '');
  });
});

test('before a first Ret there is no explanation card and no proposal (and E4 is not asked)', async () => {
  const { seam, kald } = stub();
  await medStart({ regelforslag: seam }, async (s) => {
    const h = await s.main();
    assert.doesNotMatch(h, /data-tillidskort/);
    assert.equal(beslutning(h), '');
    assert.equal(kald.foreslaa.length, 0);
  });
});

test('Ja creates the rule once, with the app-set origin, logs it and removes the block', async () => {
  const { seam, kald } = stub();
  await medStart({ state: RET, regelforslag: seam }, async (s) => {
    const id = forslagId(FORSLAG);
    await s.aktion('regel-ja', { forslagId: id });
    assert.equal(kald.opret.length, 1);
    assert.deepEqual(kald.opret[0]?.oprindelse, { art: 'ret', kortId: 'k1' });
    assert.deepEqual({ ...(await s.state())?.regel, tid: 'x' }, { forslag: id, svar: 'ja', tid: 'x', regelId: 'R-0007' });
    assert.ok((await s.log()).some((t) => /R-0007/.test(t)), 'logged');
    assert.equal(beslutning(await s.main()), '', 'answered: the block is gone');
    await assert.rejects(s.aktion('regel-ja', { forslagId: id }), /findes ikke/);
    assert.equal(kald.opret.length, 1, 'a second tap creates nothing');
  });
});

test('two Ja taps that race create one rule', async () => {
  const { seam, kald } = stub();
  await medStart({ state: RET, regelforslag: seam }, async (s) => {
    const id = forslagId(FORSLAG);
    await Promise.allSettled([s.aktion('regel-ja', { forslagId: id }), s.aktion('regel-ja', { forslagId: id })]);
    assert.equal(kald.opret.length, 1);
  });
});

test('Nej records the answer, creates nothing and the block is gone', async () => {
  const { seam, kald } = stub();
  await medStart({ state: RET, regelforslag: seam }, async (s) => {
    await s.aktion('regel-nej', { forslagId: forslagId(FORSLAG) });
    assert.equal(kald.opret.length, 0);
    assert.equal((await s.state())?.regel?.svar, 'nej');
    assert.equal(beslutning(await s.main()), '');
    assert.match(await s.main(), /data-tillidskort/, 'the explanation stays');
  });
});

test('a proposal Start did not offer creates no rule: forged id, stale id, no proposal, a member, no seam', async () => {
  const { seam, kald } = stub();
  await medStart({ state: RET, regelforslag: seam }, async (s) => {
    await assert.rejects(s.aktion('regel-ja', { forslagId: 'aaaaaaaaaaaa' }), /findes ikke/);
    await assert.rejects(s.aktion('regel-ja', {}), /findes ikke/);
    assert.equal(kald.opret.length, 0);
  });
  const { seam: ingen, kald: k2 } = stub({ svar: null });
  await medStart({ state: RET, regelforslag: ingen }, async (s) => {
    await assert.rejects(s.aktion('regel-ja', { forslagId: forslagId(FORSLAG) }), /findes ikke/);
    assert.equal(k2.opret.length, 0);
  });
  const { seam: s3, kald: k3 } = stub();
  await medStart({ state: RET, regelforslag: s3, person: { id: 'maja', login: null, navn: 'Maja', rolle: 'medlem' } }, async (s) => {
    await assert.rejects(s.aktion('regel-ja', { forslagId: forslagId(FORSLAG) }), /Kun ejeren/);
    assert.equal(k3.opret.length, 0);
  });
  await medStart({ state: RET }, async (s) => {
    await assert.rejects(s.aktion('regel-ja', { forslagId: forslagId(FORSLAG) }), /findes ikke/);
  });
});

test('proposal text is escaped', async () => {
  const { seam } = stub({ svar: { ...FORSLAG, titel: 'Regel <script>alert(1)</script>', tekst: 'Tekst "med" <b>fed</b> & mere' } });
  await medStart({ state: RET, regelforslag: seam }, async (s) => {
    const h = await s.main();
    assert.doesNotMatch(h, /<script>alert/);
    assert.doesNotMatch(h, /<b>fed<\/b>/);
    assert.match(h, /&lt;script&gt;/);
  });
});
