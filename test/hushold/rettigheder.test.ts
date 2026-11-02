// KC-0154: the household's visibility matrix, role × element kind, and what each role may do — derived from the one
// role table (src/identitet/roller.ts), so a role's rights cannot drift between the household and the rest of the app.
// The invariant: no role ever sees another person's privat or arbejde zone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AKTION_HANDLING, ELEMENT_SLAGS, HANDLING_SLAGS, maaHandle, maaSe, type ElementSlags, type HandlingSlags } from '../../src/hushold/rettigheder.ts';
import { ROLLER, type HusRolle as Rolle } from '../../src/identitet/roller.ts';
import { DATAZONER } from '../../src/identitet/zoner.ts';
import type { Person } from '../../src/identitet/husstand.ts';
import { husstandRoom } from '../../src/hushold/room.ts';
import { FAMILIE } from '../../src/testtilstand/familie.ts';

const p = (rolle: Rolle, id = 'mig'): Person => ({ id, login: `${id}@example.com`, navn: id, rolle });
const ANDEN = FAMILIE.partner.id;

/** The matrix as the ticket states it (G4: a child = a member). Party kinds are checked with the person as a party. */
const SE: Record<ElementSlags, Record<Rolle, boolean>> = {
  uge:        { ejer: true, medlem: true, barn: true, gaest: false },
  ressource:  { ejer: true, medlem: true, barn: true, gaest: false },
  medlem:     { ejer: true, medlem: true, barn: true, gaest: false },
  foresp:     { ejer: true, medlem: true, barn: true, gaest: true },
  sammenfald: { ejer: true, medlem: true, barn: true, gaest: true },
  konflikt:   { ejer: true, medlem: true, barn: true, gaest: true },
  udkast:     { ejer: true, medlem: true, barn: true, gaest: true },
  invitation: { ejer: true, medlem: false, barn: false, gaest: false },
  linje:      { ejer: true, medlem: true, barn: true, gaest: false }, // a husstand-zone line; an own privat line is below
};

const GOER: Record<HandlingSlags, Record<Rolle, boolean>> = {
  spoerg:            { ejer: true, medlem: true, barn: true, gaest: false },
  svar:              { ejer: true, medlem: true, barn: true, gaest: false },
  book:              { ejer: true, medlem: true, barn: true, gaest: false },
  ressource:         { ejer: true, medlem: true, barn: true, gaest: false },
  inviter:           { ejer: true, medlem: false, barn: false, gaest: false },
  'send-invitation': { ejer: true, medlem: false, barn: false, gaest: false },
  'skift-rolle':     { ejer: true, medlem: false, barn: false, gaest: false },
  'fjern-medlem':    { ejer: true, medlem: false, barn: false, gaest: false },
};

test('maaSe: role × element kind, cell by cell (the person a party where the kind has parties)', () => {
  assert.deepEqual([...ELEMENT_SLAGS].sort(), Object.keys(SE).sort(), 'every kind has a row');
  for (const slags of ELEMENT_SLAGS) {
    for (const rolle of ROLLER) {
      const mig = p(rolle);
      assert.equal(maaSe(mig, { slags, parter: [mig.id, ANDEN], zone: 'husstand' }), SE[slags][rolle], `${slags} × ${rolle}`);
    }
  }
});

test('a request, clash, weekend card or draft between two others is seen by neither role, the owner included', () => {
  for (const slags of ['foresp', 'sammenfald', 'konflikt', 'udkast'] as const) {
    for (const rolle of ROLLER) assert.equal(maaSe(p(rolle), { slags, parter: [ANDEN, FAMILIE.medlem.id] }), false, `${slags} × ${rolle}`);
  }
});

test('invariant: no role ever sees another person\'s privat or arbejde zone, whatever kind the element claims', () => {
  for (const rolle of ROLLER) {
    for (const zone of DATAZONER.filter((z) => z !== 'husstand')) {
      for (const slags of ELEMENT_SLAGS) {
        assert.equal(maaSe(p(rolle), { slags, zone, ejer: ANDEN, parter: ['mig', ANDEN] }), false, `${rolle} × ${zone} × ${slags}`);
      }
      assert.equal(maaSe(p(rolle), { slags: 'linje', zone, ejer: 'mig' }), true, `own ${zone} line × ${rolle}`);
    }
  }
});

test('maaHandle: role × handling, cell by cell; svar only for a party', () => {
  assert.deepEqual([...HANDLING_SLAGS].sort(), Object.keys(GOER).sort());
  for (const slags of HANDLING_SLAGS) {
    for (const rolle of ROLLER) assert.equal(maaHandle(p(rolle), { slags }), GOER[slags][rolle], `${slags} × ${rolle}`);
  }
  assert.equal(maaHandle(p('medlem'), { slags: 'svar', parter: [ANDEN, FAMILIE.medlem.id] }), false, 'not a party');
  assert.equal(maaHandle(p('medlem'), { slags: 'svar', parter: [ANDEN, 'mig'] }), true);
});

test('an unknown kind, handling or role is never allowed (fail closed)', () => {
  assert.equal(maaSe(p('ejer'), { slags: 'noget' as never }), false);
  assert.equal(maaHandle(p('ejer'), { slags: 'betal' as never }), false);
  assert.equal(maaSe(p('admin' as never), { slags: 'uge' }), false);
  assert.equal(maaHandle(p('admin' as never), { slags: 'inviter' }), false);
});

test('every action of the room is one handling of the matrix (a new action fails here until it is placed)', () => {
  assert.deepEqual(Object.keys(husstandRoom.aktionVerber ?? {}).sort(), Object.keys(AKTION_HANDLING).sort());
  for (const h of Object.values(AKTION_HANDLING)) assert.ok((HANDLING_SLAGS as readonly string[]).includes(h), h);
});
