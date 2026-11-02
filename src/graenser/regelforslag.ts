// Rule proposals (KC-0123, spec D6): nothing the model returns can create or
// widen a rule. Agent output (or a card's "Ret") can only become a
// RegelForslag — cut to its declared fields, its origin set by the app — that
// the UI shows. A proposal becomes a rule only through regelFraForslag, which
// takes a Ja; the only way to get a Ja is jaFraTryk, which redeems a human-tap
// token (KC-0122 tegn.ts) for exactly that binding, once. E4 (KC-0108) builds
// the endpoint and the rules UI on this; test/graenser/regelforslag.test.ts
// holds the structural invariant.

import { validerRegel, nyRegel, type Regel, type Regelsaet, type Trin } from '../tillid/regler.ts';
import type { Binding, Tegn } from './tegn.ts';

/** Text, level, scope, origin. The origin is the app's (the card or the hand that asked), never the model's. */
export type RegelForslag = {
  titel: string;
  tekst: string;
  trin: Trin;
  gaelder: { kilde: string; slags?: string };
  oprindelse: { art: 'ret' | 'ikke-relevant' | 'haand'; kortId?: string };
};

declare const JA: unique symbol;
/** A redeemed human tap. Only jaFraTryk makes one; it is good for one rule. */
export type Ja = { readonly [JA]: true; readonly binding: Readonly<Binding> };

const udstedte = new WeakSet<object>();
const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A proposal from untrusted JSON: only titel, tekst, trin and gaelder survive, and only when they make a valid rule. */
export function forslagFra(raw: unknown, oprindelse: RegelForslag['oprindelse']): RegelForslag | null {
  if (!erObj(raw)) return null;
  const g = erObj(raw['gaelder']) ? raw['gaelder'] : {};
  const gaelder = { kilde: g['kilde'], ...(g['slags'] !== undefined ? { slags: g['slags'] } : {}) };
  // The one rule check (tillid/regler.ts), with placeholders for what the app sets when the rule is made.
  const r = validerRegel({ id: 'R-0001', titel: raw['titel'], tekst: raw['tekst'], trin: raw['trin'], gaelder, oprindelse: { art: oprindelse.art, dato: '2000-01-01', ...(oprindelse.kortId ? { kortId: oprindelse.kortId } : {}) }, status: 'aktiv' });
  if ('fejl' in r) return null;
  return { titel: r.titel, tekst: r.tekst, trin: r.trin, gaelder: { ...r.gaelder }, oprindelse: { ...oprindelse } };
}

/** The yes behind a rule: the human-tap token redeemed for exactly this binding. Null when it is missing, wrong, used or old. */
export function jaFraTryk(tegn: Tegn, ja: string | undefined, b: Binding): Ja | null {
  if (!tegn.indloes(ja, b)) return null;
  const j = Object.freeze({ binding: Object.freeze({ ...b }) }) as unknown as Ja;
  udstedte.add(j);
  return j;
}

/** The only path from a proposal to a rule: dated by the app, active, next id. Throws without a fresh Ja. */
export function regelFraForslag(saet: Regelsaet, f: RegelForslag, ja: Ja, dato: string): { saet: Regelsaet; regel: Regel } {
  if (!udstedte.has(ja as object)) throw new Error('en regel kræver et ja fra et tryk');
  udstedte.delete(ja as object);
  const { kortId } = f.oprindelse;
  return nyRegel(saet, { titel: f.titel, tekst: f.tekst, trin: f.trin, gaelder: { ...f.gaelder }, oprindelse: { art: f.oprindelse.art, dato, ...(kortId ? { kortId } : {}) }, status: 'aktiv' });
}
