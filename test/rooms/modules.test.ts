import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRoomModule, ROOM_MODULES } from '../../src/rooms/modules.ts';

test('built rooms have a module with the same id; unknown ids have none', () => {
  assert.equal(getRoomModule('dagen')?.id, 'dagen');
  assert.equal(getRoomModule('bank'), undefined);
  for (const m of ROOM_MODULES) {
    for (const fn of ['view', 'opdater', 'handling', 'fortryd', 'chat', 'venter'] as const) {
      assert.equal(typeof m[fn], 'function', `${m.id}.${fn}`);
    }
  }
});

test('univers is a static module and univers-<slug> gets a module made for that slug', () => {
  assert.equal(getRoomModule('univers')?.id, 'univers');
  assert.ok(ROOM_MODULES.some((m) => m.id === 'univers'));
  const m = getRoomModule('univers-min-arena');
  assert.equal(m?.id, 'univers-min-arena');
  assert.equal(typeof m?.aktion, 'function');
  assert.equal(typeof m?.fil, 'function');
  assert.equal(getRoomModule('univers-'), undefined);
  assert.equal(getRoomModule('univers-Stort'), undefined);
  assert.equal(getRoomModule('universe'), undefined);
});
