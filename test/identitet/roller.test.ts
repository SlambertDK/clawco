import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLLER, RETTIGHEDER, kan } from '../../src/identitet/roller.ts';

// The full role × right matrix (KC-0116). A child has a member's rights (Henrik, gate G4,
// 2026-10-31: "Som voksne"); a guest gets the narrowest set.
const FORVENTET: Record<string, Record<string, boolean>> = {
  ejer:   { laese: true, handle: true,  'aendre-indstillinger': true,  'aendre-husstand': true,  nodstop: true,  genoptag: true },
  medlem: { laese: true, handle: true,  'aendre-indstillinger': false, 'aendre-husstand': false, nodstop: true,  genoptag: false },
  barn:   { laese: true, handle: true,  'aendre-indstillinger': false, 'aendre-husstand': false, nodstop: true,  genoptag: false },
  gaest:  { laese: true, handle: false, 'aendre-indstillinger': false, 'aendre-husstand': false, nodstop: false, genoptag: false },
};

test('the roles and rights are the closed lists from the ticket', () => {
  assert.deepEqual([...ROLLER], ['ejer', 'medlem', 'barn', 'gaest']);
  assert.deepEqual([...RETTIGHEDER], ['laese', 'handle', 'aendre-indstillinger', 'aendre-husstand', 'nodstop', 'genoptag']);
});

test('kan() matches the full matrix, cell by cell', () => {
  for (const rolle of ROLLER) {
    for (const ret of RETTIGHEDER) {
      assert.equal(kan(rolle, ret), FORVENTET[rolle]?.[ret], `${rolle} × ${ret}`);
    }
  }
});

test('an unknown role or right is never allowed', () => {
  assert.equal(kan('admin' as never, 'laese'), false);
  assert.equal(kan('ejer', 'betal' as never), false);
});
