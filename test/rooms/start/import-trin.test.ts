// KC-0129: step 5 (import) in the registry and the state. Optional; Klaret reads the saved imports; Done never depends on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alleTrin, trinStatus } from '../../../src/rooms/start/trin.ts';
import { parseStartState, type StartState } from '../../../src/rooms/start/schema.ts';
import { erFoersteGang, rejsen, startRoom } from '../../../src/rooms/start/room.ts';
import { medStart, STARTET } from '../../helpers/start-deps.ts';

const tom: StartState = { startet: STARTET, trin: {}, afvist: {} };
const trin = () => alleTrin().find((t) => t.id === 'import')!;
const GEMT = { logId: 'l1', tid: STARTET, slags: 'chatgpt', antal: 2 };

test('step 5 sits right before the first Ret, and is optional', () => {
  const ider = alleTrin().map((t) => t.id);
  assert.equal(ider.indexOf('import'), ider.indexOf('foerste-ret') - 1);
  assert.equal(trin().krav, 'valgfri');
});

test('step 5 is Klaret iff an import is saved; a stored klaret without one reopens; Spring over is kept', () => {
  assert.equal(trin().erKlaret(null, { profil: null }), false);
  assert.equal(trin().erKlaret(tom, { profil: null }), false);
  assert.equal(trin().erKlaret({ ...tom, import: { gemt: [GEMT] } }, { profil: null }), true);
  assert.equal(trinStatus(trin(), { ...tom, trin: { import: { status: 'klaret' } } }, { profil: null }), 'i-gang');
  assert.equal(trinStatus(trin(), { ...tom, trin: { import: { status: 'sprunget-over' } } }, { profil: null }), 'sprunget-over');
});

test('the state parser keeps a valid import and drops malformed pieces', () => {
  const ok = parseStartState({ ...tom, import: { bunke: { tid: STARTET, slags: 'chatgpt', uaendret: 1, forslag: [{ id: 'p1', art: 'person', status: 'nyt', navn: 'Ingrid', relation: 'kone', mappe: 'familie', zone: 'privat' }] }, gemt: [GEMT] } });
  assert.equal(ok?.import?.bunke?.forslag[0]?.navn, 'Ingrid');
  assert.equal(ok?.import?.gemt?.[0]?.antal, 2);
  const daarlig = parseStartState({ ...tom, import: { bunke: { tid: 'nej', slags: 'x', forslag: [] }, gemt: [{ logId: '../x', tid: STARTET, slags: 'a', antal: 1 }, 7] } });
  assert.equal(daarlig?.import, undefined);
  const delvis = parseStartState({ ...tom, import: { bunke: { tid: STARTET, slags: 'noter', forslag: [{ id: '../1', art: 'person', status: 'nyt', navn: 'x' }, { id: 'p2', art: 'person', status: 'nyt', navn: 'Tore', mappe: '../../etc' }] } } });
  assert.equal(delvis?.import?.bunke?.forslag.length, 1);
  assert.equal(delvis?.import?.bunke?.forslag[0]?.mappe, undefined, 'a folder outside the four is dropped');
});

test('Henrik\'s install (Done latched, no import state): Start stays hidden, nothing counts, nothing is written', async () => {
  const foer: StartState = { ...tom, faerdig: STARTET };
  await medStart({ state: foer }, async (s) => {
    assert.equal(await startRoom.venter(s.d), 0);
    assert.deepEqual(await startRoom.hjemVenter(s.d), []);
    assert.equal(await erFoersteGang(s.d), false);
    assert.equal((await rejsen(s.d)).faerdig, true);
    await s.main();
    const { forslag: _cache, ...efter } = (await s.state())!; // the 15-minute suggestion cache is the one write a view always made
    assert.deepEqual(efter, foer, 'the view changed nothing else: no step state, no import state');
  });
});
