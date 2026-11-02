// KC-0126: an install past onboarding. Tests about Nu, the nav and its counts
// on an install in use seed this, so Start (shown until the journey is Done)
// stays out of them; test/server-start.test.ts covers a fresh install.

import type { RumLager } from '../../src/store/types.ts';

export async function rejsenFaerdig(store: RumLager, tid = '2026-10-01T08:00:00.000Z'): Promise<void> {
  await store.writeState('start', { startet: tid, trin: {}, afvist: {}, faerdig: tid });
}
