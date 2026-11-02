import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOMS, findRoom } from '../../src/rooms/registry.ts';

test('the registry lists the rooms in nav order, Univers and then Husstanden (KC-0148, drawn under Univers) last', () => {
  assert.deepEqual(ROOMS.map((r) => r.id), ['hjem', 'start', 'dagen', 'mail', 'skrive', 'nyheder', 'univers', 'husstand']);
});

test('every drawn room is built', () => {
  assert.deepEqual(ROOMS.filter((r) => r.built).map((r) => r.id), ['hjem', 'start', 'dagen', 'mail', 'skrive', 'nyheder', 'univers', 'husstand']);
});

test('findRoom returns undefined for unknown ids', () => {
  assert.equal(findRoom('bank'), undefined);
  assert.equal(findRoom('dagen')?.navn, 'Dagen');
  assert.equal(findRoom('husstand')?.navn, 'Husstanden');
});

test('every id univers-<slug> is the Univers room family; other prefixes and odd slugs are not', () => {
  assert.equal(findRoom('univers')?.navn, 'Univers');
  assert.equal(findRoom('univers-min-arena')?.navn, 'Univers');
  assert.equal(findRoom('univers-min-arena')?.id, 'univers-min-arena');
  assert.equal(findRoom('univers-')?.id, undefined);
  assert.equal(findRoom('univers-Min Arena'), undefined);
  assert.equal(findRoom('univers-../x'), undefined);
  assert.equal(findRoom('universet'), undefined);
});

test('KC-0115: the room with id hjem is called Nu', () => {
  assert.equal(findRoom('hjem')?.navn, 'Nu');
});
