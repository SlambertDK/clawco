// KC-0132: the connector data shapes in src/kilder/types.ts restate what the
// rooms read today (src/kilder imports nothing from src/rooms). These
// assignments fail typecheck the moment either side drifts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Envelope } from '../../src/rooms/mail/source.ts';
import type { KildeStatus, RaaNyhed } from '../../src/rooms/nyheder/source.ts';
import type { Kuvert, Nyhed, NyhedsStatus } from '../../src/kilder/types.ts';

type Lig<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const kuvert: Lig<Kuvert, Envelope> = true;
const nyhed: Lig<Nyhed, RaaNyhed> = true;
const status: Lig<NyhedsStatus, KildeStatus> = true;

test('the connector shapes equal the rooms\' shapes (checked by typecheck)', () => {
  assert.deepEqual([kuvert, nyhed, status], [true, true, true]);
});
