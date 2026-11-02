// KC-0170: sproglig() answers from the table of the language being rendered, at read time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medSprog } from '../../src/store/sprog.ts';
import { efterSprog, sproglig } from '../../src/kilder/tekst-hjaelp.ts';

const t = { da: { a: 'ja', b: 'to' }, en: { a: 'yes', b: 'two' } };

test('efterSprog: Danish when no language is set, else the language of the request', () => {
  assert.equal(efterSprog(t).a, 'ja');
  assert.equal(medSprog('en', () => efterSprog(t).a), 'yes');
  assert.equal(medSprog('da', () => efterSprog(t).a), 'ja');
});

test('sproglig: one constant object that follows the language at every read', () => {
  const k = sproglig(t);
  assert.equal(k.a, 'ja');
  assert.equal(medSprog('en', () => k.a), 'yes');
  assert.deepEqual(Object.keys(k), ['a', 'b']);
  assert.deepEqual(Object.values(k), ['ja', 'to']);
  assert.deepEqual(medSprog('en', () => ({ ...k })), { a: 'yes', b: 'two' });
  assert.equal('a' in k, true);
  assert.equal('c' in k, false);
});
