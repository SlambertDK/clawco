// The resource (KC-0150): a thing with its own calendar and an owner circle —
// the big car, the guest room, or a child ("hun kan kun være ét sted"). Owners
// book it directly; anyone else asks an owner (a forespørgsel, KC-0149). Pure:
// data in, data out, no I/O, the clock passed in.
//
// A clash (sammenfald) is between the person who wishes a slot (`ny`, never
// stored as a booking) and the person whose booking it hits (`mod`). Its options
// are outcomes, so both parties see the same list:
//   anden {hvem, ressourceId}  hvem's claim moves to another free resource of the same kind that hvem owns
//   afgiv {hvem}               hvem lets go (the holder: their booking goes and the wish is booked; the wisher: the wish is dropped)
// Invariant: nothing here ever returns a calendar with two overlapping bookings,
// and a booking is only removed by an outcome its booker chose (or accepted).

export const SLAGS = ['bil', 'rum', 'ting', 'person'] as const;
export type Slags = (typeof SLAGS)[number];
/** The kinds a person creates from the screen (KC-0215); `person` stands for a household member and is not made by name. */
export const OPRET_SLAGS = ['bil', 'rum', 'ting'] as const;
export type OpretSlags = (typeof OPRET_SLAGS)[number];
export type PersonId = string;
export type Tidsrum = { start: string; slut: string };

export type Booking = { id: string; ressourceId: string; af: PersonId; start: string; slut: string; titel: string; foresporgselId?: string };
export type Ressource = { id: string; navn: string; slags: Slags; ejere: PersonId[]; kalender: Booking[] };

type UtenId = { slags: 'anden'; hvem: PersonId; ressourceId: string } | { slags: 'afgiv'; hvem: PersonId };
export type Valg = UtenId & { id: string };
/** Hermes' suggestion: which option comes first, and one neutral sentence. Advice only. */
export type SammenfaldForslag = { foerste: string; anbefaling?: string };
export type Sammenfald = {
  id: string; ressourceId: string;
  /** The wish (not booked); `ny.af` is one party. */
  ny: Booking;
  /** The booking it hit, as it was; `mod.af` is the other party. */
  mod: Booking;
  valg: Valg[];
  oprettet: string;
  forslag?: SammenfaldForslag;
  /** A request created from an option involving the other person, and which option it asks for. */
  forespId?: string; forespValg?: string;
  /** `valg` is an option id, or 'bortfaldet' when the held booking went away by itself. */
  afgjort?: { valg: string; af: PersonId; tid: string };
};

export const MAX_VALG = 4;

/** Half-open: touching edges do not overlap. */
export const overlapper = (a: Tidsrum, b: Tidsrum): boolean => Date.parse(a.start) < Date.parse(b.slut) && Date.parse(b.start) < Date.parse(a.slut);

/** The bookings of `kalender` that `ny` overlaps (never `ny` itself), earliest first. */
export function sammenfald(ny: Pick<Booking, 'id' | 'start' | 'slut'>, kalender: readonly Booking[]): Booking[] {
  return kalender.filter((x) => x.id !== ny.id && overlapper(ny, x)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export const erEjer = (r: Pick<Ressource, 'ejere'>, person: PersonId): boolean => r.ejere.includes(person);

/** KC-0215: who may edit or remove a resource — an adult in its owner circle, or the household's owner. (Roles: KC-0154 refines.) */
export const maaRetteRessource = (r: Pick<Ressource, 'ejere'>, m: { id: PersonId; rolle: string }): boolean =>
  m.rolle === 'ejer' || (m.rolle === 'medlem' && erEjer(r, m.id));

/** Upcoming bookings (not yet ended) made by anyone but `person`. */
export const kommendeAfAndre = (r: Pick<Ressource, 'kalender'>, person: PersonId, nu: Date): Booking[] =>
  r.kalender.filter((b) => b.af !== person && Date.parse(b.slut) > nu.getTime());

/**
 * Why a resource may not be removed right now (Danish, for the screen), or null. The invariant above holds: another
 * person's upcoming booking, an open clash that touches the resource and an open request for it all wait to be settled
 * by the people they belong to; the remover's own upcoming bookings go with it (they are the booker).
 */
export function hvorforIkkeFjernes(
  r: Ressource,
  o: { person: PersonId; nu: Date; sammenfald: readonly Sammenfald[]; forespoergsler: readonly { ressourceId?: string; tilstand: string }[] },
): string | null {
  const andres = kommendeAfAndre(r, o.person, o.nu);
  if (andres.length) return `Der er kommende bookinger af andre på ${iSaetning(r.navn)}. Vent til de er overstået.`;
  if (o.sammenfald.some((s) => aabenSammenfald(s, o.nu) && (s.ressourceId === r.id || s.valg.some((v) => v.slags === 'anden' && v.ressourceId === r.id)))) {
    return `Der er et åbent kort om ${iSaetning(r.navn)}. Afgør det først.`;
  }
  if (o.forespoergsler.some((f) => f.ressourceId === r.id && (f.tilstand === 'spurgt' || f.tilstand === 'alternativ'))) {
    return `Der er en åben forespørgsel om ${iSaetning(r.navn)}. Vent på svaret først.`;
  }
  return null;
}

/** Whether any two bookings of the calendar overlap. */
export const dobbeltBooket = (r: Pick<Ressource, 'kalender'>): boolean => r.kalender.some((x) => sammenfald(x, r.kalender).length > 0);

const ledig = (r: Ressource, t: Tidsrum, undtagen: readonly string[] = []): boolean =>
  !r.kalender.some((x) => !undtagen.includes(x.id) && overlapper(t, x));

export type Indsat = { ok: true; ressourcer: Ressource[] } | { ok: false; hvorfor: string; mod: Booking[] };

/** Puts a booking into its resource's calendar, only when the slot is free. */
export function indsaet(ressourcer: readonly Ressource[], ny: Booking): Indsat {
  const r = ressourcer.find((x) => x.id === ny.ressourceId);
  if (!r) return { ok: false, hvorfor: 'Den ting findes ikke (længere).', mod: [] };
  const mod = sammenfald(ny, r.kalender);
  if (mod.length) return { ok: false, hvorfor: `${r.navn} er optaget i det tidsrum.`, mod };
  return { ok: true, ressourcer: ressourcer.map((x) => (x.id === r.id ? { ...x, kalender: [...x.kalender, { ...ny }] } : x)) };
}

/** The outcomes of a clash, in default order — anden(wisher), afgiv(holder), anden(holder), afgiv(wisher) — at most four, ids v1…. */
export function valgFor(ressourcer: readonly Ressource[], ny: Booking, mod: Booking): Valg[] {
  const res = ressourcer.find((x) => x.id === ny.ressourceId);
  const anden = (hvem: PersonId, t: Tidsrum): UtenId[] => {
    const r = ressourcer.find((x) => res && x.id !== res.id && x.slags === res.slags && erEjer(x, hvem) && ledig(x, t));
    return r ? [{ slags: 'anden', hvem, ressourceId: r.id }] : [];
  };
  const alle: UtenId[] = [...anden(ny.af, ny), { slags: 'afgiv', hvem: mod.af }, ...anden(mod.af, mod), { slags: 'afgiv', hvem: ny.af }];
  return alle.slice(0, MAX_VALG).map((v, i): Valg => ({ ...v, id: `v${i + 1}` }));
}

export function nySammenfald(o: { id: string; ny: Booking; mod: Booking; ressourcer: readonly Ressource[]; nu: Date }): Sammenfald {
  return { id: o.id, ressourceId: o.ny.ressourceId, ny: { ...o.ny }, mod: { ...o.mod }, valg: valgFor(o.ressourcer, o.ny, o.mod), oprettet: o.nu.toISOString() };
}

export const parterI = (s: Pick<Sammenfald, 'ny' | 'mod'>): [PersonId, PersonId] => [s.ny.af, s.mod.af];
export const erPartI = (s: Pick<Sammenfald, 'ny' | 'mod'>, person: PersonId): boolean => s.ny.af === person || s.mod.af === person;
/** The other party, seen from `person`. */
export const andenPart = (s: Pick<Sammenfald, 'ny' | 'mod'>, person: PersonId): PersonId => (s.ny.af === person ? s.mod.af : s.ny.af);

/** Not decided, and the wish has not ended yet. */
export const aabenSammenfald = (s: Pick<Sammenfald, 'afgjort' | 'ny'>, nu: Date): boolean => !s.afgjort && Date.parse(s.ny.slut) > nu.getTime();

/** The options in the order shown: Hermes' first, then the rest in default order. */
export function ordnedeValg(s: Pick<Sammenfald, 'valg' | 'forslag'>): Valg[] {
  const f = s.valg.find((v) => v.id === s.forslag?.foerste);
  return f ? [f, ...s.valg.filter((v) => v !== f)] : [...s.valg];
}

export type Loesning = { ok: true; ressourcer: Ressource[]; booket: Booking[]; fjernet: Booking[] } | { ok: false; hvorfor: string };

/**
 * Applies one outcome of an open clash. `nyId` is the id the wish gets when it is booked; `foresporgselId` stamps it
 * when the outcome came through an accepted request. Refuses (never displaces) when the world moved since the clash.
 */
export function loesSammenfald(ressourcer: readonly Ressource[], s: Sammenfald, valgId: string, nyId: string, o: { foresporgselId?: string } = {}): Loesning {
  if (s.afgjort) return { ok: false, hvorfor: 'Det er allerede afgjort.' };
  const v = s.valg.find((x) => x.id === valgId);
  if (!v) return { ok: false, hvorfor: 'Ukendt valg.' };
  const oensket: Booking = { ...s.ny, id: nyId, ...(o.foresporgselId ? { foresporgselId: o.foresporgselId } : {}) };
  const holdt = ressourcer.find((x) => x.id === s.ressourceId)?.kalender.find((x) => x.id === s.mod.id);
  if (v.slags === 'afgiv' && v.hvem === s.ny.af) return { ok: true, ressourcer: [...ressourcer], booket: [], fjernet: [] };
  if (v.slags === 'anden' && v.hvem === s.ny.af) {
    const r = indsaet(ressourcer, { ...oensket, ressourceId: v.ressourceId });
    return r.ok ? { ok: true, ressourcer: r.ressourcer, booket: [{ ...oensket, ressourceId: v.ressourceId }], fjernet: [] } : { ok: false, hvorfor: r.hvorfor };
  }
  // The holder's outcomes: their booking must still be there.
  if (!holdt) return { ok: false, hvorfor: 'Bookingen findes ikke længere.' };
  const uden = ressourcer.map((x) => (x.id === s.ressourceId ? { ...x, kalender: x.kalender.filter((y) => y.id !== holdt.id) } : x));
  let efter = uden;
  const booket: Booking[] = [];
  if (v.slags === 'anden') {
    const flyttet: Booking = { ...holdt, ressourceId: v.ressourceId };
    const r = indsaet(uden, flyttet);
    if (!r.ok) return { ok: false, hvorfor: r.hvorfor };
    efter = r.ressourcer;
    booket.push(flyttet);
  }
  const r = indsaet(efter, oensket);
  if (!r.ok) return { ok: false, hvorfor: r.hvorfor };
  return { ok: true, ressourcer: r.ressourcer, booket: [...booket, oensket], fjernet: v.slags === 'afgiv' ? [holdt] : [] };
}

/** "Den store bil" inside a sentence is "den store bil"; a proper name keeps its capital. */
export const iSaetning = (navn: string): string => (/^(Den|Det|De) /.test(navn) ? navn[0]!.toLowerCase() + navn.slice(1) : navn);

/** An option in neutral words, both parties by name (Hermes' prompt, the log line when it is chosen). */
export function valgNeutralt(s: Pick<Sammenfald, 'ny' | 'mod'>, v: Valg, navn: (id: PersonId) => string, ressourcer: readonly Pick<Ressource, 'id' | 'navn'>[]): string {
  const anden = v.hvem === s.ny.af ? s.mod.af : s.ny.af;
  if (v.slags === 'anden') return `${navn(v.hvem)} tager ${iSaetning(ressourcer.find((r) => r.id === v.ressourceId)?.navn ?? 'en anden')}`;
  return v.hvem === s.mod.af ? `${navn(v.hvem)} lader ${navn(anden)} få den (bytte)` : `${navn(v.hvem)} dropper det, ${navn(anden)} beholder den`;
}
