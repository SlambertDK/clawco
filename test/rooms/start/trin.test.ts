// KC-0126: the ordered step catalogue of the journey (spec §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alleTrin, registrerTrin, trinStatus } from '../../../src/rooms/start/trin.ts';
import type { StartState } from '../../../src/rooms/start/schema.ts';

const profil = { navn: 'Alma', sprog: 'da' as const, husstand: 'alene' as const };
const tom: StartState = { startet: '2026-10-31T08:00:00.000Z', trin: {}, afvist: {} };

// KC-0248: step 0, before everything.
test('situation is the first step, mandatory; velkommen the second', () => {
  const [forst, andet] = alleTrin();
  assert.equal(forst?.id, 'situation');
  assert.equal(forst?.krav, 'obligatorisk');
  assert.equal(andet?.id, 'velkommen');
  assert.equal(andet?.krav, 'obligatorisk');
});

test('situation is Klaret exactly when the person went on with their pick; a pick alone is i-gang at most', () => {
  const s = alleTrin()[0]!;
  const ctx = { profil: null };
  assert.equal(s.erKlaret(null, ctx), false);
  assert.equal(s.erKlaret(tom, ctx), false);
  const valgt: StartState = { ...tom, situation: { valg: 'familie', tid: tom.startet } };
  assert.equal(s.erKlaret(valgt, ctx), false, 'a tap only previews');
  const videre: StartState = { ...tom, situation: { valg: 'familie', tid: tom.startet, bekraeftet: tom.startet } };
  assert.equal(s.erKlaret(videre, ctx), true);
  const sagt: StartState = { ...tom, trin: { situation: { status: 'klaret', tid: tom.startet } } };
  assert.equal(trinStatus(s, sagt, ctx), 'i-gang', 'a stored klaret without the pick reopens');
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
