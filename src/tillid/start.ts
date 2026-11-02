// The first rules for the reference install (KC-0142 migration): only the
// behaviours Hermes already follows today, as documented in this repo, so the
// rules file starts as a true description rather than an empty one. Written
// once, only when no rules file exists (Henrik's file is never overwritten).
// KC-0144's proposal card replaces this one-off once it exists.

import { nyRegel, type Regel, type Regelsaet } from './regler.ts';
import type { ReglerLager } from './lager.ts';

type Start = Omit<Regel, 'id' | 'oprindelse'>;

export const STARTREGLER: readonly Start[] = [
  // Source: docs/superpowers/specs/2026-10-27-mail-room-design.md, "What already exists on kira-home" (cron
  // "Automatisk mailsortering", skill mail-triage-proton; the Mail room shows it as "Ordnet af Hermes i dag").
  {
    titel: 'Mail sorteres i mapper', trin: 1, gaelder: { kilde: 'mail', slags: 'indbakke' }, status: 'aktiv',
    tekst: 'Hvert kvarter flytter Hermes mail fra Indbakken til Handling, Afventer, Måske, Regninger, køb, vigtige docs eller Arkiv. Hermes sletter aldrig mail og lægger intet i papirkurven.',
  },
  // Source: src/kurator/kurator.ts (skrivRegninger) and src/kurator/regnskab.ts: Kuratoren proposes the line,
  // the app writes it into the ShelfAtlas ledger or the private subscriptions file, each with Fortryd.
  {
    titel: 'Regnskabslinjer for abonnementer og køb', trin: 2, gaelder: { kilde: 'mail', slags: 'regning' }, status: 'aktiv',
    tekst: 'Når en regning eller kvittering kommer, foreslår Hermes linjen, og appen skriver den i ShelfAtlas-regnskabet eller i det private budget (abonnementer). Hver linje kan fortrydes. Hermes betaler aldrig.',
  },
];

/** Writes STARTREGLER as import rules dated `dato` (YYYY-MM-DD) when no rules file exists. 'findes' = a file is there (untouched). */
export async function skrivStartregler(lager: ReglerLager, dato: string): Promise<'skrevet' | 'findes'> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dato)) throw new Error(`ugyldig dato: ${dato}`);
  if ((await lager.laes()).tilstand !== 'mangler') return 'findes';
  let saet: Regelsaet = { naesteId: 1, regler: [], ugyldige: [] };
  for (const r of STARTREGLER) saet = nyRegel(saet, { ...r, oprindelse: { art: 'import', dato } }).saet;
  await lager.skriv(saet);
  return 'skrevet';
}
