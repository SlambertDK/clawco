// The test world's story (KC-0068): one fictional day in six moments. MOMENTER
// are the moments the band jumps between; froe() is everything a moment needs
// on disk; svar() is the scripted Hermes that answers every kind of run the app
// can start; FORBUDT is the deny-list the content is held to. The parts live
// per room under indhold/. All names, firms and numbers are invented.

import type { Moment } from './typer.ts';
import { MOMENT_TABEL } from './indhold/fakta.ts';
import { KOLD_START } from './indhold/start.ts';

export { froe } from './indhold/froe.ts';
export { svar } from './indhold/svar.ts';

/** The six moments of the day, in order. */
export const MOMENTER: Moment[] = MOMENT_TABEL.map((m) => ({ ...m }));

/** KC-0126: every moment the band can jump to — the day, then the world variant kold (a fresh install). */
export const ALLE_MOMENTER: Moment[] = [...MOMENTER, ...KOLD_START.map((m) => ({ ...m }))];

/** Accounts and services that must never appear in seeded test content (lifted from the demo's test, KC-0058).
 * Real people's names and the owner's employer are guarded for the whole code by the private test/privat/offentlig.test.ts (KC-0228). */
export const FORBUDT: readonly string[] = ['ShelfAtlas', 'Cloudflare', 'Vercel', 'Kira', 'Proton', 'Lambert', 'EnergiWatch', 'Elektrikeren ApS', 'Rør & Co'];
