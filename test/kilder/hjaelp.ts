// Test helpers for the connector framework (KC-0132): a minimal connector per
// test and a tmp data dir with a store.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFileStore } from '../../src/store/fileStore.ts';
import type { RumLager } from '../../src/store/types.ts';
import type { Kilde, KildeKort, Laesning } from '../../src/kilder/types.ts';

export const NU = new Date('2026-10-31T10:00:00Z');

export const KORT: KildeKort = {
  titel: 'Testkalender', tekst: 'Til test.', handling: 'Forbind',
  felter: [{ navn: 'konto', etiket: 'Konto', type: 'tekst', paakraevet: true }, { navn: 'adgangskode', etiket: 'Adgangskode', type: 'hemmelig', paakraevet: true }, { navn: 'note', etiket: 'Note', type: 'tekst', paakraevet: false, maks: 10 }],
};

/** A kalender connector with fixed data; `over` replaces any part. */
export function testKilde(over: Partial<Kilde> = {}): Kilde {
  const laesning: Laesning = { slags: 'kalender', hentet: NU.toISOString(), uklar: true, data: { generated: NU.toISOString(), days: [{ date: '2026-10-31', events: [{ title: 'Stand-up' }, { title: 'Frokost' }] }], errors: [] } };
  return {
    id: 'test-kalender', navn: 'Testkalender', slags: 'kalender', zone: 'privat', auth: 'bridge',
    read: async () => laesning,
    kort: async () => KORT,
    helbred: async () => ({ status: 'ok' }),
    ...over,
  };
}

export async function medData(fn: (dir: string, store: RumLager) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'kc-kilder-'));
  try { await fn(dir, createFileStore(dir, { now: () => NU })); } finally { await rm(dir, { recursive: true, force: true }); }
}
