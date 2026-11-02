// KC-0052: when Henrik last opened each room — rum-lager room `nav`. The nav
// shows a room he opened today (shell/synlig.ts). Only the last opening per
// room is kept; a lost write only means a room shows up a visit later.

import type { RumLager } from './types.ts';

const NAV = 'nav';
type NavState = { aabnet: Record<string, string> };

export async function laesAabnet(store: RumLager): Promise<Record<string, string>> {
  return (await store.readState<NavState>(NAV))?.aabnet ?? {};
}

export async function markerAabnet(store: RumLager, rum: string, now: Date): Promise<void> {
  const aabnet = await laesAabnet(store);
  await store.writeState<NavState>(NAV, { aabnet: { ...aabnet, [rum]: now.toISOString() } });
}
