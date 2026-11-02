import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stemmeNyheder } from '../../src/rooms/nyheder/stemme.ts';
import type { NyhederState } from '../../src/rooms/nyheder/schema.ts';
import type { LogEntry } from '../../src/store/types.ts';

const state: NyhederState = {
  dato: '2026-10-27', genereret: '2026-10-27T05:00:00Z',
  femLinjer: ['Elpriserne falder', 'Ny aftale om havvind.', 'Regeringen lægger finanslov'],
  baner: [{ navn: 'Mig', nyheder: [{ id: 'n1', titel: 'x', hvorfor: 'y' }] }],
  forslag: [
    { id: 'f1', tekst: 'Gem artiklen om havvind som note', handling: { id: 'forslag-1-gem', label: 'Gem noten', instruktion: 'i' } },
    { id: 'f2', tekst: 'Overvej at abonnere på ugebrevet' },
    { id: 'f3', tekst: 'Læs rapporten i weekenden', handling: { id: 'forslag-3-laes', label: 'Læg på læseliste', instruktion: 'i' } },
  ],
  nyhedsbreve: [], kilder: { antal: 1, medNyheder: 1, nyheder: 1, fejlede: [] }, gemt: [], hermesStatus: 'ok',
};
const entry = (handlingId: string): LogEntry => ({ id: 'l1', tid: '2026-10-27T08:00:00Z', kilde: 'hermes', tekst: 'Gjort.', handlingId });

test('résumé is the five lines as sentences; punkter are forslag with an open handling', () => {
  const r = stemmeNyheder(state, []);
  assert.equal(r.rum, 'nyheder');
  assert.equal(r.resume, 'Elpriserne falder. Ny aftale om havvind. Regeringen lægger finanslov.');
  assert.deepEqual(r.punkter.map((p) => p.id), ['f1', 'f3']);
  assert.equal(r.punkter[0]?.sig, 'Gem artiklen om havvind som note.');
  assert.deepEqual(r.punkter[0]?.valg, [{ id: 'forslag-1-gem', label: 'Gem noten' }]);
});

test('a forslag whose handling has a result is no longer a punkt', () => {
  assert.deepEqual(stemmeNyheder(state, [entry('forslag-1-gem')]).punkter.map((p) => p.id), ['f3']);
});

test('no state: résumé says the paper is not built, no punkter', () => {
  assert.deepEqual(stemmeNyheder(null, []), { rum: 'nyheder', resume: 'Avisen er ikke bygget endnu.', punkter: [] });
});
