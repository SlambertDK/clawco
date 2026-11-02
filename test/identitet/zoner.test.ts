import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATAZONER, ZoneFejl, blandetZoner, synligFor, zoneAf, zoneFra } from '../../src/identitet/zoner.ts';
import { ROLLER, type Rolle } from '../../src/identitet/roller.ts';
import type { Person } from '../../src/identitet/husstand.ts';

const p = (id: string, rolle: Rolle): Person => ({ id, login: `${id}@x`, navn: id, rolle });

test('the data zones are the closed list from the spec', () => {
  assert.deepEqual([...DATAZONER], ['privat', 'arbejde', 'husstand']);
});

test('an element without a zone reads as privat (old state files, no migration)', () => {
  assert.equal(zoneAf({}), 'privat');
  assert.equal(zoneAf({ zone: 'arbejde' }), 'arbejde');
  assert.equal(zoneAf({ zone: 'noget' as never }), 'privat', 'an unknown stored zone is the most private one');
});

test('zoneFra: absent → the run zone; the same zone → kept; unknown or another zone → rejected', () => {
  assert.equal(zoneFra(undefined, 'privat'), 'privat');
  assert.equal(zoneFra('arbejde', 'arbejde'), 'arbejde');
  assert.throws(() => zoneFra('firma', 'privat'), ZoneFejl);
  assert.throws(() => zoneFra(7, 'privat'), ZoneFejl);
  assert.throws(() => zoneFra('husstand', 'privat'), ZoneFejl, 'an element cannot claim a zone its run did not read');
});

test('blandetZoner: true only when the sources span more than one zone', () => {
  assert.equal(blandetZoner([]), false);
  assert.equal(blandetZoner(['privat']), false);
  assert.equal(blandetZoner(['arbejde', 'arbejde']), false);
  assert.equal(blandetZoner(['privat', 'arbejde']), true);
  assert.equal(blandetZoner(['husstand', 'privat', 'husstand']), true);
});

test('synligFor: the full matrix over roles × zones × owner', () => {
  const ejer = p('henrik', 'ejer');
  for (const rolle of ROLLER) {
    const mig = p('mig', rolle);
    // husstand: every non-guest
    assert.equal(synligFor(mig, { zone: 'husstand' }), rolle !== 'gaest', `husstand × ${rolle}`);
    for (const zone of ['privat', 'arbejde'] as const) {
      // own element: always
      assert.equal(synligFor(mig, { zone, ejer: 'mig' }), true, `${zone} own × ${rolle}`);
      // someone else's: never, not even for the household owner
      assert.equal(synligFor(mig, { zone, ejer: 'anden' }), false, `${zone} foreign × ${rolle}`);
      // no ejer recorded (old data, single owner): only the household's owner
      assert.equal(synligFor(mig, { zone }), rolle === 'ejer', `${zone} legacy × ${rolle}`);
    }
  }
  assert.equal(synligFor(ejer, {}), true, 'a legacy element without zone is the owner\'s privat');
  assert.equal(synligFor(p('maja', 'medlem'), {}), false);
});
