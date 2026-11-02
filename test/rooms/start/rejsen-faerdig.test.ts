// KC-0126: Done (spec §3) = Nu shows at least one real element AND Ret or Ikke relevant was pressed once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erRejsenFaerdig } from '../../../src/rooms/start/rejsen.ts';

test('the truth table of Done', () => {
  assert.equal(erRejsenFaerdig({ nuElementer: 0, rettet: false }), false, 'nothing yet');
  assert.equal(erRejsenFaerdig({ nuElementer: 0, rettet: true }), false, 'a Ret but nothing in Nu');
  assert.equal(erRejsenFaerdig({ nuElementer: 1, rettet: false }), false, 'one element, no Ret');
  assert.equal(erRejsenFaerdig({ nuElementer: 1, rettet: true }), true, 'both');
  assert.equal(erRejsenFaerdig({ nuElementer: 7, rettet: true }), true);
});
