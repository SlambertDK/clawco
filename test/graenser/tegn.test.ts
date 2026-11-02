import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lavTegn } from '../../src/graenser/tegn.ts';

const binding = { person: 'henrik', rum: 'mail', slags: 'aktion', id: 'send:m1' };

test('a token is good once, for exactly the element it was issued for', () => {
  let nu = 0;
  const t = lavTegn(() => nu);
  const a = t.udsted(binding);
  assert.equal(t.indloes(a, { ...binding, id: 'send:m2' }), false, 'another element');
  assert.equal(t.indloes(a, { ...binding, person: 'maja' }), false, 'another person');
  assert.equal(t.indloes(a, binding), true);
  assert.equal(t.indloes(a, binding), false, 'one time only');
});

test('a token expires after two minutes; unknown and empty tokens never pass', () => {
  let nu = 0;
  const t = lavTegn(() => nu);
  const a = t.udsted(binding);
  nu = 120_001;
  assert.equal(t.indloes(a, binding), false);
  assert.equal(t.indloes('', binding), false);
  assert.equal(t.indloes('findes-ikke', binding), false);
  assert.equal(t.indloes(undefined, binding), false);
});
