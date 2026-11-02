// KC-0203: the closed set of numbers a beta tenant hands to Clawco Sky, and nothing else. Sky pulls it (GET
// /api/beta/maal, signed like its other control calls); no channel from the tenant to Sky exists.
//
// The schema is closed twice (AGENTS §0 r2, the pattern of sky/src/konto/hjaelp.ts): MaalFelter names every field that
// may ever be sent, and MAAL says for each whether it needs consent and how it is produced — a mapped type over the
// same keys, so a new field is a type error until it is decided here. The builder reads only those keys, so a caller
// cannot smuggle anything else in. With consent off only `version`, `samtykke` and the feedback the person sent on
// purpose are produced; the other sources are not even read.

import { faerdigeDage, type Dagstal } from '../tillid/dagstal.ts';
import type { StartState } from '../rooms/start/schema.ts';
import type { BetaTilstand, Betale, FeedbackDag } from './tilstand.ts';

/** Ms from the beta start to the first source's connection, and that source's own time to its first value (KC-0128). */
export type FoersteVaerdi = { kildeForbundetMs: number; foersteVaerdiMs: number };
/** How many distinct elements stood in Nu's "Kræver dig" band that Copenhagen day (KC-0147's count, a number only). */
export type MaalDag = { dag: string; kraever: number };
export type MaalFeedback = { dag: FeedbackDag; vurdering: 1 | 2 | 3 | 4 | 5; tekst: string | null; betale: Betale | null; tid: string };

/** The only facts that may ever leave. */
export type MaalFelter = {
  version: 1;
  samtykke: boolean;
  foersteVaerdi: FoersteVaerdi | null;
  dage: MaalDag[];
  feedback: MaalFeedback[];
};

/** What the builder reads from. The two numbers are functions so that nothing is read without consent. */
export type MaalKilder = { tilstand: BetaTilstand; foersteVaerdi: () => Promise<FoersteVaerdi | null>; dage: () => Promise<MaalDag[]> };

const MAAL: { [K in keyof MaalFelter]-?: { samtykke: boolean; bygg: (k: MaalKilder) => Promise<MaalFelter[K]> | MaalFelter[K] } } = {
  version: { samtykke: false, bygg: () => 1 },
  samtykke: { samtykke: false, bygg: (k) => k.tilstand.samtykke },
  foersteVaerdi: { samtykke: true, bygg: (k) => k.foersteVaerdi() },
  dage: { samtykke: true, bygg: (k) => k.dage() },
  // Picked field by field: a stray key in a stored row can never travel.
  feedback: { samtykke: false, bygg: (k) => k.tilstand.feedback.map((f) => ({ dag: f.dag, vurdering: f.vurdering, tekst: f.tekst, betale: f.betale, tid: f.tid })) },
};

/** The allowlist as a list, in the order the answer is written (a test pins it, so adding a field is a conscious act). */
export const MAAL_FELTER = Object.keys(MAAL) as (keyof MaalFelter)[];

/** The answer as it would go now. `samtykke` overrides the stored consent (the page shows what switching it on would send). */
export async function byggMaal(k: MaalKilder, samtykke: boolean = k.tilstand.samtykke): Promise<{ [K in keyof MaalFelter]?: MaalFelter[K] }> {
  const med: MaalKilder = { ...k, tilstand: { ...k.tilstand, samtykke } };
  const ud: Record<string, unknown> = {};
  for (const felt of MAAL_FELTER) {
    if (MAAL[felt].samtykke && !samtykke) continue;
    ud[felt] = await MAAL[felt].bygg(med);
  }
  return ud as { [K in keyof MaalFelter]?: MaalFelter[K] };
}

/** The first connected source by the time its first value was read; its connect time is that read minus its first-value time. */
export function foersteVaerdiFraStart(start: StartState | null, betaStartet: string): FoersteVaerdi | null {
  const kilder = Object.values(start?.kilder ?? {});
  const foerste = kilder.map((v) => ({ ms: v.foersteVaerdiMs, laest: Date.parse(v.tid) })).filter((v) => Number.isFinite(v.laest)).sort((a, b) => a.laest - b.laest)[0];
  if (!foerste) return null;
  const forbundet = foerste.laest - foerste.ms;
  return { kildeForbundetMs: Math.max(0, Math.round(forbundet - Date.parse(betaStartet))), foersteVaerdiMs: foerste.ms };
}

export const MAAL_DAGE = 21;
/** KC-0147's finished days (today's count is still growing), the last 21, oldest first, two fields each. */
export function dageFraDagstal(dage: readonly Dagstal[], idag: string): MaalDag[] {
  return faerdigeDage(dage, idag).slice(-MAAL_DAGE).map((d) => ({ dag: d.dato, kraever: d.kraevede }));
}
