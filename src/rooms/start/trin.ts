// KC-0126: the ordered steps of the journey (spec §3). This ticket ships step 1
// (velkommen); the other epics add theirs through registrerTrin (KC-0127 model,
// KC-0128 sources, KC-0129 import, KC-0130 first Ret, E5 household). Invariant
// (AGENTS §0 r2): a step is Klaret only when its real condition holds —
// erKlaret reads the thing the step configures, never a pressed button, so a
// step reopens when that thing breaks.

import type { Profil, StartState, TrinStatus } from './schema.ts';
import { slagsRaekkefoelge } from './situation.ts';
import { startTekst } from './tekster.ts';

export const NIVEAUER = ['lille', 'taenker'] as const;
export type Niveau = (typeof NIVEAUER)[number];
/** A tier's last live test as Start reads it (KC-0127; stored in indstillinger.json). */
export type ModelTestSyn = { ok: boolean; tid: string; ms: number; rev: string; fejl?: string };
/**
 * KC-0127: the model choice as the composition root hands it to Start: the provider, the tiers' models, each tier's
 * last test, and each tier's current revision (provider + model), so a test of another model does not count.
 */
export type ModelSyn = { udbyder?: string; modeller: Partial<Record<Niveau, string>>; test: Partial<Record<Niveau, ModelTestSyn>>; rev: Record<Niveau, string> };

/** KC-0127: both tiers have a model and each passed its live test for the revision it has now (step 2; KC-0180 health). */
export const modelKlaret = (m: ModelSyn): boolean =>
  NIVEAUER.every((n) => Boolean(m.modeller[n]) && m.test[n]?.ok === true && m.test[n]?.rev === m.rev[n]);

/** What a step's condition may read. Steps added later extend this with what they configure. */
export type TrinKontekst = { profil: Profil | null; model?: ModelSyn; kilder?: KildeTrin[] };

export type Trin = {
  id: string;
  titel: string;
  /** One sentence: what the step is for. */
  tekst: string;
  krav: 'obligatorisk' | 'valgfri';
  /** KC-0247: about how many minutes the step takes (the "≈ 1 min" a later step shows). */
  minutter: number;
  erKlaret(state: StartState | null, ctx: TrinKontekst): boolean;
};

const TRIN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const katalog: Trin[] = [];

/** Adds a step at the end of the journey. Throws on an invalid or duplicate id. */
export function registrerTrin(t: Trin): void {
  if (!TRIN_ID.test(t.id)) throw new Error(`ugyldigt trin-id: ${t.id.slice(0, 40)}`);
  if (katalog.some((x) => x.id === t.id)) throw new Error(`trinnet ${t.id} findes allerede`);
  katalog.push(t);
}

/** Every step, in journey order. */
export const alleTrin = (): readonly Trin[] => katalog;

/** The status a step shows: klaret iff its condition holds; a stored klaret whose condition broke reads i-gang. */
export function trinStatus(t: Trin, state: StartState | null, ctx: TrinKontekst): TrinStatus {
  if (t.erKlaret(state, ctx)) return 'klaret';
  const gemt = state?.trin[t.id]?.status;
  return gemt === 'klaret' ? 'i-gang' : gemt ?? 'ikke-startet';
}

// KC-0248: step 0, before everything (the journey's order is the order of registration). Klaret when the person went on
// with their pick — the pick is what the step configures; tapping a pick only previews it (state.situation.bekraeftet).
registrerTrin({
  id: 'situation',
  get titel() { return startTekst().trin['situation'].titel; },
  get tekst() { return startTekst().trin['situation'].tekst; },
  minutter: 1,
  krav: 'obligatorisk',
  // An installation from before step 0 (it has a profile and never made a pick) gets no new mandatory step: it reads as
  // done with the pick "everything" (the journey's own order), and nothing is written.
  erKlaret: (s, ctx) => Boolean(s?.situation?.bekraeftet) || (ctx.profil !== null && !s?.situation),
});

registrerTrin({
  id: 'velkommen',
  get titel() { return startTekst().trin['velkommen'].titel; },
  get tekst() { return startTekst().trin['velkommen'].tekst; },
  minutter: 1,
  krav: 'obligatorisk',
  erKlaret: (_s, ctx) => ctx.profil !== null,
});

// KC-0127: Klaret only while both tiers have a model and each passed its live test for the revision it has now.
registrerTrin({
  id: 'model',
  get titel() { return startTekst().trin['model'].titel; },
  get tekst() { return startTekst().trin['model'].tekst; },
  minutter: 2,
  krav: 'obligatorisk',
  erKlaret: (_s, ctx) => Boolean(ctx.model && modelKlaret(ctx.model)),
});

// ---------- KC-0128: steps 3–4 (spec §3 "First source", "Second source") ----------
// Which sources exist is data from the connector registry (RoomDeps.rejse); Start
// only knows the journey's order of kinds. A source "has read" when Start recorded
// its first value (stored, so it survives a restart and does not depend on what
// else this process happened to read).

/** A registered source as the steps see it. */
export type KildeTrin = { id: string; navn: string; slags: string; forbundet: boolean };

/**
 * KC-0236: the sources of the Danmark-pakke (Start's group, danmarkpakke.ts). They are offered there, never as a first
 * source in step 3 nor in step 4's pile, and they do not make step 3 or 4 Klaret. The ids are the connectors' own
 * (rooms import nothing from src/kilder), held equal by test/rooms/start/danmarkpakke.test.ts.
 */
export const PAKKE_KILDER: readonly string[] = ['aula-kalender'];
export const erPakkeKilde = (id: string): boolean => PAKKE_KILDER.includes(id);
/** The registry as the journey's steps and suggestions read it: without the pack's sources. */
export const utenPakke = <T extends { id: string }>(kilder: readonly T[]): T[] => kilder.filter((k) => !erPakkeKilde(k.id));

/** Step 3 offers these kinds (the user picks one); step 4 offers the other, then the rest in this order. */
export const FOERSTE_SLAGS: readonly string[] = ['kalender', 'mail'];
const FLERE_SLAGS: readonly string[] = ['noter', 'nyheder', 'beskeder'];

const harLaest = (k: KildeTrin, s: StartState | null): boolean => k.forbundet && Boolean(s?.kilder?.[k.id]);

/** Step 3's condition: a calendar or mail source is connected and its first read gave a value. */
export const harFoersteKilde = (s: StartState | null, ctx: TrinKontekst): boolean =>
  (ctx.kilder ?? []).some((k) => FOERSTE_SLAGS.includes(k.slags) && harLaest(k, s));

/**
 * Step 4's pile, in order: nothing until step 3 holds; then per kind — the other of calendar/mail, notes, news,
 * messages — every registered source of a kind with none connected, unless skipped. Start shows the first only.
 */
export function flereKilderKoe(s: StartState | null, ctx: TrinKontekst): KildeTrin[] {
  if (!harFoersteKilde(s, ctx)) return [];
  const kilder = ctx.kilder ?? [];
  const forbundneSlags = new Set(kilder.filter((k) => k.forbundet).map((k) => k.slags));
  // KC-0248: in the order the pick gives (kinds the pick does not name keep the journey's own order after it).
  const orden = [...new Set([...slagsRaekkefoelge(s?.situation?.valg), ...FOERSTE_SLAGS, ...FLERE_SLAGS])].filter((x) => FOERSTE_SLAGS.includes(x) || FLERE_SLAGS.includes(x));
  return orden.flatMap((slags) => (forbundneSlags.has(slags) ? [] : kilder.filter((k) => k.slags === slags && !s?.sprunget?.[k.id])));
}

registrerTrin({
  id: 'foerste-kilde',
  get titel() { return startTekst().trin['foerste-kilde'].titel; },
  get tekst() { return startTekst().trin['foerste-kilde'].tekst; },
  minutter: 2,
  krav: 'obligatorisk',
  erKlaret: harFoersteKilde,
});

registrerTrin({
  id: 'flere-kilder',
  get titel() { return startTekst().trin['flere-kilder'].titel; },
  get tekst() { return startTekst().trin['flere-kilder'].tekst; },
  minutter: 2,
  krav: 'valgfri',
  // Klaret when nothing more is offered and a source beyond the first is connected; all skipped is not Klaret.
  erKlaret: (s, ctx) => harFoersteKilde(s, ctx) && flereKilderKoe(s, ctx).length === 0
    && (ctx.kilder ?? []).filter((k) => k.forbundet && [...FOERSTE_SLAGS, ...FLERE_SLAGS].includes(k.slags)).length >= 2,
});

// ---------- KC-0129: step 5 (spec §3 "Migration is a first-class source") ----------
// Optional. Klaret reads the saved imports in Start's state (a Fortryd removes its entry, so the step reopens);
// Spring over stores sprunget-over. Done (rejsen.ts) never depends on it.

registrerTrin({
  id: 'import',
  get titel() { return startTekst().trin['import'].titel; },
  get tekst() { return startTekst().trin['import'].tekst; },
  minutter: 3,
  krav: 'valgfri',
  erKlaret: (s) => Boolean(s?.import?.gemt?.length),
});

// ---------- KC-0130: step 6 (spec §3 "First Ret") ----------
// Klaret reads the recorded first Ret / Ikke relevant (ret.ts: a listener on the real events), never a button.
// With step 4's sources done, this is the last step; Done (rejsen.ts) additionally needs an element in Nu.

registrerTrin({
  id: 'foerste-ret',
  get titel() { return startTekst().trin['foerste-ret'].titel; },
  get tekst() { return startTekst().trin['foerste-ret'].tekst; },
  minutter: 1,
  krav: 'obligatorisk',
  erKlaret: (s) => Boolean(s?.ret),
});
