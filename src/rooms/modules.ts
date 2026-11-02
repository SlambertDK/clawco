// The built rooms, by id. Add a room here once it has a RoomModule.

import { vogt, type VogtetRum } from '../graenser/port.ts';
import { dagenRoom } from './dagen/room.ts';
import { mailRoom } from './mail/room.ts';
import { skriveRoom } from './skrive/room.ts';
import { nyhederRoom } from './nyheder/room.ts';
import { universOversigt, universRoom } from './univers/room.ts';
import { startRoom } from './start/room.ts';
import { husstandRoom } from '../hushold/room.ts';
import { UNIVERS_ID } from './registry.ts';

// KC-0122: only wrapped modules leave this file — every handling passes the policy layer (src/graenser/port.ts).
export const ROOM_MODULES: readonly VogtetRum[] = [startRoom, dagenRoom, mailRoom, skriveRoom, nyhederRoom, universOversigt, husstandRoom].map((m) => vogt(m));

/** The static rooms by id; `univers-<slug>` gets a module for that slug (existence is the module's business). */
export function getRoomModule(id: string): VogtetRum | undefined {
  const fast = ROOM_MODULES.find((m) => m.id === id);
  if (fast) return fast;
  const m = UNIVERS_ID.exec(id);
  return m ? vogt(universRoom(m[1] as string)) : undefined;
}
