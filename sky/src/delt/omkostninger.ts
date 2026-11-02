// The cost ledger (KC-0212, spec D18, AGENTS §0 r6): config/omkostninger.json in the repo root, read
// by path. Every resource has a monthly cost in øre and an `aktiv` flag; a paid one also has the
// revenue trigger that allows it (paid MRR ≥ mrrGange × its cost) and the source of its price. The
// tenant app reads the same file with its own validator (src/omkostninger/regnskab.ts; Sky and the
// tenant share no code), and test/fixtures/omkostninger-konformitet.json holds both to one verdict.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Udloeser = { mrrGange: number };
export type Ressource = {
  navn: string;
  /** Øre per month; 0 = free. */
  maanedlig: number;
  aktiv: boolean;
  note: string | null;
  /** The price is the cheapest listed option ("fra"). */
  fra: boolean;
  /** Where the price was read; required for a paid line. */
  kilde: string | null;
  /** The date (YYYY-MM-DD) the price was read; required for a paid line. */
  laest: string | null;
  /** Required for a paid line, null for a free one. */
  udloeser: Udloeser | null;
};
export type Omkostninger = { ressourcer: Record<string, Ressource> };

/** gratis: free and on · daekket/udaekket: paid and on, cover met or not · naer/klar/slukket: paid and off, MRR at ≥ 80 % of its trigger, past it, or below. */
export type LinjeTilstand = 'gratis' | 'daekket' | 'udaekket' | 'naer' | 'klar' | 'slukket';
export type Samlet = 'groen' | 'gul' | 'roed';
export type Linje = { id: string; navn: string; maanedlig: number; aktiv: boolean; tilstand: LinjeTilstand; kraevetMrr: number | null };
export type Daekning = { nu: number; krav: number; samlet: Samlet; linjer: Linje[] };

export const OMKOSTNINGSFIL = fileURLToPath(new URL('../../../config/omkostninger.json', import.meta.url));

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATO = /^\d{4}-\d{2}-\d{2}$/;
const NOEGLER = ['navn', 'maanedlig', 'aktiv', 'note', 'fra', 'kilde', 'laest', 'udloeser'] as const;
const KRAEVET = ['navn', 'maanedlig', 'aktiv', 'udloeser'] as const;

function fejl(sti: string, hvad: string): Error {
  return new Error(`config/omkostninger.json: ${sti} ${hvad}`);
}

function objekt(v: unknown, sti: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw fejl(sti || '(roden)', 'skal være et objekt');
  return v as Record<string, unknown>;
}

function tekst(v: unknown, sti: string): string {
  if (typeof v !== 'string' || !v.trim()) throw fejl(sti, 'skal være en tekst');
  return v;
}

function valgfriTekst(v: unknown, sti: string): string | null {
  return v === undefined || v === null ? null : tekst(v, sti);
}

function ressource(v: unknown, sti: string): Ressource {
  const o = objekt(v, sti);
  for (const k of Object.keys(o)) if (!k.startsWith('_') && !(NOEGLER as readonly string[]).includes(k)) throw fejl(`${sti}.${k}`, 'er ukendt (stavefejl?)');
  for (const k of KRAEVET) if (!(k in o)) throw fejl(`${sti}.${k}`, 'mangler');
  const maanedlig = o['maanedlig'];
  if (typeof maanedlig !== 'number' || !Number.isInteger(maanedlig) || maanedlig < 0) throw fejl(`${sti}.maanedlig`, 'skal være et heltal ≥ 0 (øre)');
  if (typeof o['aktiv'] !== 'boolean') throw fejl(`${sti}.aktiv`, 'skal være true eller false');
  if (o['fra'] !== undefined && typeof o['fra'] !== 'boolean') throw fejl(`${sti}.fra`, 'skal være true eller false');
  const r: Ressource = {
    navn: tekst(o['navn'], `${sti}.navn`), maanedlig, aktiv: o['aktiv'], note: valgfriTekst(o['note'], `${sti}.note`), fra: o['fra'] === true,
    kilde: valgfriTekst(o['kilde'], `${sti}.kilde`), laest: valgfriTekst(o['laest'], `${sti}.laest`), udloeser: null,
  };
  if (r.laest !== null && (!DATO.test(r.laest) || Number.isNaN(Date.parse(r.laest)))) throw fejl(`${sti}.laest`, 'skal være en dato som 2026-10-31');
  if (maanedlig === 0) {
    if (o['udloeser'] !== null) throw fejl(`${sti}.udloeser`, 'skal være null for en gratis ressource');
    return r;
  }
  // The invariant (D18): nothing paid without the trigger that allows it and the source of its price.
  if (o['udloeser'] === null) throw fejl(`${sti}.udloeser`, 'mangler: en betalt ressource skal have en indtægtsudløser');
  const u = objekt(o['udloeser'], `${sti}.udloeser`);
  for (const k of Object.keys(u)) if (k !== 'mrrGange') throw fejl(`${sti}.udloeser.${k}`, 'er ukendt (stavefejl?)');
  const g = u['mrrGange'];
  if (typeof g !== 'number' || !Number.isInteger(g) || g < 1) throw fejl(`${sti}.udloeser.mrrGange`, 'skal være et heltal ≥ 1');
  if (r.kilde === null) throw fejl(`${sti}.kilde`, 'mangler: hvor prisen er læst');
  if (r.laest === null) throw fejl(`${sti}.laest`, 'mangler: hvornår prisen er læst');
  return { ...r, udloeser: { mrrGange: g } };
}

export function validerOmkostninger(raw: unknown): Omkostninger {
  const r = objekt(raw, '');
  for (const k of Object.keys(r)) if (!k.startsWith('_') && k !== 'ressourcer') throw fejl(k, 'er ukendt (stavefejl?)');
  if (!('ressourcer' in r)) throw fejl('ressourcer', 'mangler');
  const o = objekt(r['ressourcer'], 'ressourcer');
  const ressourcer: Record<string, Ressource> = {};
  for (const [id, v] of Object.entries(o)) {
    if (id.startsWith('_')) continue;
    if (!SLUG.test(id)) throw fejl(`ressourcer.${id}`, 'skal være et id med små bogstaver, tal og bindestreg');
    ressourcer[id] = ressource(v, `ressourcer.${id}`);
  }
  if (Object.keys(ressourcer).length === 0) throw fejl('ressourcer', 'skal have mindst én ressource');
  return { ressourcer };
}

export function laesOmkostninger(sti: string = OMKOSTNINGSFIL): Omkostninger {
  let indhold: string;
  try {
    indhold = fs.readFileSync(sti, 'utf8');
  } catch {
    throw new Error(`kan ikke læse omkostningsfilen ${sti}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(indhold);
  } catch (e) {
    throw new Error(`omkostningsfilen ${sti} er ikke gyldig JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return validerOmkostninger(raw);
}

/**
 * The ledger against paid MRR (øre per month). Active paid lines are covered cumulatively in file
 * order: each adds mrrGange × cost to what MRR must reach. An inactive paid line's trigger is what
 * MRR must reach with it on top of everything active. Red = something paid is on without cover;
 * amber = an inactive line's trigger is near (MRR at ≥ 80 % of it).
 */
export function daekning(o: Omkostninger, mrrOere: number): Daekning {
  const mrr = Math.max(0, Math.floor(mrrOere));
  const betalt = (r: Ressource): r is Ressource & { udloeser: Udloeser } => r.maanedlig > 0 && r.udloeser !== null;
  const aktivtKrav = Object.values(o.ressourcer).filter((r) => r.aktiv && betalt(r)).reduce((s, r) => s + r.maanedlig * r.udloeser!.mrrGange, 0);
  let krav = 0;
  const linjer = Object.entries(o.ressourcer).map(([id, r]): Linje => {
    const base = { id, navn: r.navn, maanedlig: r.maanedlig, aktiv: r.aktiv };
    if (!betalt(r)) return { ...base, tilstand: r.aktiv ? 'gratis' : 'slukket', kraevetMrr: null };
    const egen = r.maanedlig * r.udloeser.mrrGange;
    if (r.aktiv) {
      krav += egen;
      return { ...base, tilstand: mrr >= krav ? 'daekket' : 'udaekket', kraevetMrr: krav };
    }
    const kraevet = aktivtKrav + egen;
    return { ...base, tilstand: mrr >= kraevet ? 'klar' : mrr * 100 >= kraevet * 80 ? 'naer' : 'slukket', kraevetMrr: kraevet };
  });
  const nu = Object.values(o.ressourcer).filter((r) => r.aktiv).reduce((s, r) => s + r.maanedlig, 0);
  const samlet: Samlet = linjer.some((l) => l.tilstand === 'udaekket') ? 'roed' : linjer.some((l) => l.tilstand === 'naer') ? 'gul' : 'groen';
  return { nu, krav, samlet, linjer };
}

/** Whether `id` is a paid resource that is switched on AND covered by `mrrOere` (what a paid driver needs before it acts). */
export function erDaekketAktiv(o: Omkostninger, id: string, mrrOere: number): boolean {
  const r = o.ressourcer[id];
  if (!r || !r.aktiv || r.maanedlig === 0) return false;
  return daekning(o, mrrOere).linjer.find((l) => l.id === id)?.tilstand === 'daekket';
}
