// KC-0126: the ordered step catalogue of the journey (spec §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alleTrin, registrerTrin, trinStatus } from '../../../src/rooms/start/trin.ts';
import type { StartState } from '../../../src/rooms/start/schema.ts';

const profil = { navn: 'Alma', sprog: 'da' as const, husstand: 'alene' as const };
const tom: StartState = { startet: '2026-10-31T08:00:00.000Z', trin: {}, afvist: {} };

test('velkommen is the first step and mandatory', () => {
  const [forst] = alleTrin();
  assert.equal(forst?.id, 'velkommen');
  assert.equal(forst?.krav, 'obligatorisk');
});

test('velkommen is Klaret exactly when a profile exists, whatever the stored status says', () => {
  const v = alleTrin().find((t) => t.id === 'velkommen')!;
  assert.equal(v.erKlaret(tom, { profil: null }), false);
  assert.equal(v.erKlaret(tom, { profil }), true);
  const sagt: StartState = { ...tom, trin: { velkommen: { status: 'klaret', tid: tom.startet } } };
  assert.equal(trinStatus(v, sagt, { profil: null }), 'i-gang', 'a stored klaret whose condition broke reopens');
  assert.equal(trinStatus(v, tom, { profil: null }), 'ikke-startet');
  assert.equal(trinStatus(v, tom, { profil }), 'klaret');
  assert.equal(trinStatus(v, { ...tom, trin: { velkommen: { status: 'sprunget-over' } } }, { profil: null }), 'sprunget-over');
});

test('registrerTrin appends in order, keeps optional steps optional and rejects a duplicate id', () => {
  const foer = alleTrin().length;
  registrerTrin({ id: 'test-valgfri', titel: 'Valgfrit', tekst: 'Et valgfrit trin.', krav: 'valgfri', minutter: 1, erKlaret: () => false });
  const alle = alleTrin();
  assert.equal(alle.length, foer + 1);
  assert.equal(alle.at(-1)?.id, 'test-valgfri');
  assert.equal(alle.at(-1)?.krav, 'valgfri');
  assert.throws(() => registrerTrin({ id: 'velkommen', titel: 'x', tekst: 'x', krav: 'valgfri', minutter: 1, erKlaret: () => true }), /findes allerede/);
  assert.throws(() => registrerTrin({ id: 'Ugyldig Id', titel: 'x', tekst: 'x', krav: 'valgfri', minutter: 1, erKlaret: () => true }), /ugyldigt/);
});
