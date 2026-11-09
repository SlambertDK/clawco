// KC-0247: Start shows one step at a time (the open step is the only card), so a server test of a later step's card
// first brings a fresh data dir past the steps before it — through the files the app itself reads (profil.json,
// indstillinger.json, kilder.json, Start's state), never a stub at the UI layer. A test that goes past step 2 registers
// the fake connectors (FORBI_KILDER) so the calendar counts as connected.

import { createFileStore } from '../../src/store/fileStore.ts';
import { lavProfilLager } from '../../src/store/profil.ts';
import { skrivKonfig } from '../../src/kilder/register.ts';
import { falskeKilder, type FalskData } from '../../src/kilder/falsk/falsk.ts';
import { createSettings, modelRevision } from '../../src/settings.ts';
import type { StartState } from '../../src/rooms/start/schema.ts';

/** The steps in the order a test can bring a fresh install past them (each includes the ones before). */
const ORDEN = ['situation', 'velkommen', 'model', 'foerste-kilde', 'foerste-ret'] as const;
export type Forbi = (typeof ORDEN)[number];

const KALENDER = 'falsk-kalender';
const TOM: FalskData = {
  kalender: () => ({ generated: '2026-10-31T08:00:00.000Z', days: [], errors: [] }),
  mail: () => [],
  nyheder: () => ({ nyheder: [], status: { antal: 0, medNyheder: 0, nyheder: 0, fejlede: [] } }),
  noter: () => ({ personer: [], noter: [] }),
  beskeder: () => [],
};
/** The fake connectors a test registers (createApp `kilder`) when it goes past step 2. */
export const FORBI_KILDER = (data: FalskData = TOM) => falskeKilder({ data, forsinkelseMs: 0 });

/** Step 2 done on its own: both tiers have a model that passed its live test (so Start's chat is the model's, KC-0249). */
export async function modelVirker(dir: string, nu: Date = new Date('2026-10-31T08:00:00.000Z')): Promise<void> {
  const tid = nu.toISOString();
  const s = createSettings(dir);
  await s.setModels({ lille: 'model-lille', taenker: 'model-taenker' }, { udbyder: 'anthropic' });
  const testet = (model: string) => ({ ok: true, tid, ms: 800, rev: modelRevision('anthropic', model) });
  await s.setModelTest({ lille: testet('model-lille'), taenker: testet('model-taenker') });
}

/** Writes `dir` as if the journey's steps up to and including `til` were done (the owner `af` made them). */
export async function forbiTil(dir: string, til: Forbi, o: { nu?: Date; af?: string; sprog?: 'da' | 'en' } = {}): Promise<void> {
  const tid = (o.nu ?? new Date('2026-10-31T08:00:00.000Z')).toISOString();
  const n = ORDEN.indexOf(til);
  // KC-0248: step 0 (the pick) is the first step; a test that goes past it has made and confirmed the pick.
  const situation = { valg: 'alt' as const, tid, bekraeftet: tid };
  if (n < 1) { await createFileStore(dir).writeState('start', { startet: tid, trin: {}, afvist: {}, situation } satisfies StartState); return; }
  await lavProfilLager(dir).skriv({ navn: 'Henrik', sprog: o.sprog ?? 'da', husstand: 'alene' });
  if (n >= 2) await modelVirker(dir, o.nu);
  if (n < 3) { await createFileStore(dir).writeState('start', { startet: tid, trin: {}, afvist: {}, situation } satisfies StartState); return; }
  await skrivKonfig(dir, { kilder: [{ id: KALENDER, status: 'forbundet', zone: 'privat', valg: {}, tid, af: o.af ?? 'henrik' }] });
  const state: StartState = {
    startet: tid, trin: {}, afvist: {}, situation,
    kilder: { [KALENDER]: { foersteVaerdiMs: 1000, tid, forhaandsvisning: { kildeId: KALENDER, navn: 'Falsk kalender', slags: 'kalender', titel: 'Ingen aftaler i dag', linje: '', hentet: tid }, erstattet: tid } }, // replaced by the curated view, so Nu holds only what the test puts there
    ...(n >= 4 ? { ret: { art: 'ret' as const, tid, titel: 'Ingen aftaler i dag' } } : {}),
  };
  await createFileStore(dir).writeState('start', state);
}
