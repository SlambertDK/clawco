// The one price source (KC-0190, AGENTS §0 r6): config/priser.json in the repo root. Sky reads it
// by path (never an import from the tenant's src/); the pricing page (KC-0199), Checkout (KC-0191)
// and entitlements (KC-0192) read the same file. Validation is strict and names the JSON path that
// is wrong, so a typo stops the setup command before a single Stripe call.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Integers in øre (dkk) and cent (eur). */
export type Beloeb = { dkk: number; eur: number };
export type Plan = { navn: string; medlemmer: number; maanedlig: Beloeb; aarlig: Beloeb };
export type Tilvalg = { navn: string; status: 'senere' | 'aktiv'; fraMaanedlig: Beloeb };
export type Priser = {
  /** Gate G5: `udkast` until Henrik says yes; live Stripe is only written with `godkendt`. */
  status: 'udkast' | 'godkendt';
  /** Off while Henrik is not VAT-registered (D17); KC-0194 turns it on. */
  moms: { aktiv: boolean };
  proeve: { dage: number; kort: boolean };
  /** Days from a failed payment to read-only (KC-0196). */
  fristVedFejl: number;
  /** Days from a failed payment to the second, sharper mail (KC-0196); after day 0, before fristVedFejl. */
  paamindelseVedFejl: number;
  /** Plan id → plan. Plan ids and member limits live here and nowhere else. */
  planer: Record<string, Plan>;
  tilvalg: Record<string, Tilvalg>;
};

export const PRISFIL = fileURLToPath(new URL('../../../config/priser.json', import.meta.url));

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function fejl(sti: string, hvad: string): Error {
  return new Error(`config/priser.json: ${sti} ${hvad}`);
}

function objekt(v: unknown, sti: string, noegler: readonly string[] | null): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw fejl(sti, 'skal være et objekt');
  const o = v as Record<string, unknown>;
  if (noegler) {
    for (const k of Object.keys(o)) if (!k.startsWith('_') && !noegler.includes(k)) throw fejl(sti ? `${sti}.${k}` : k, 'er ukendt (stavefejl?)');
    for (const k of noegler) if (!(k in o)) throw fejl(sti ? `${sti}.${k}` : k, 'mangler');
  }
  return o;
}

function heltal(v: unknown, sti: string, min: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw fejl(sti, `skal være et heltal ≥ ${min}`);
  return v;
}

function tekst(v: unknown, sti: string): string {
  if (typeof v !== 'string' || !v.trim()) throw fejl(sti, 'skal være en tekst');
  return v;
}

function sandhed(v: unknown, sti: string): boolean {
  if (typeof v !== 'boolean') throw fejl(sti, 'skal være true eller false');
  return v;
}

function beloeb(v: unknown, sti: string): Beloeb {
  const o = objekt(v, sti, ['dkk', 'eur']);
  return { dkk: heltal(o['dkk'], `${sti}.dkk`, 1), eur: heltal(o['eur'], `${sti}.eur`, 1) };
}

function ordbog<T>(v: unknown, sti: string, del: (v: unknown, sti: string) => T): Record<string, T> {
  const o = objekt(v, sti, null);
  const ud: Record<string, T> = {};
  for (const [k, x] of Object.entries(o)) {
    if (k.startsWith('_')) continue;
    if (!SLUG.test(k)) throw fejl(`${sti}.${k}`, 'skal være et id med små bogstaver, tal og bindestreg');
    ud[k] = del(x, `${sti}.${k}`);
  }
  return ud;
}

export function validerPriser(raw: unknown): Priser {
  const r = objekt(raw, '', ['status', 'moms', 'proeve', 'fristVedFejl', 'paamindelseVedFejl', 'planer', 'tilvalg']);
  const status = r['status'];
  if (status !== 'udkast' && status !== 'godkendt') throw fejl('status', 'skal være "udkast" eller "godkendt"');

  const m = objekt(r['moms'], 'moms', ['aktiv']);
  if (sandhed(m['aktiv'], 'moms.aktiv')) throw fejl('moms.aktiv', 'kan ikke være true endnu: moms bygges i KC-0194');

  const pr = objekt(r['proeve'], 'proeve', ['dage', 'kort']);
  const proeve = { dage: heltal(pr['dage'], 'proeve.dage', 0), kort: sandhed(pr['kort'], 'proeve.kort') };

  const planer = ordbog(r['planer'], 'planer', (v, sti) => {
    const o = objekt(v, sti, ['navn', 'medlemmer', 'maanedlig', 'aarlig']);
    return {
      navn: tekst(o['navn'], `${sti}.navn`),
      medlemmer: heltal(o['medlemmer'], `${sti}.medlemmer`, 1),
      maanedlig: beloeb(o['maanedlig'], `${sti}.maanedlig`),
      aarlig: beloeb(o['aarlig'], `${sti}.aarlig`),
    };
  });
  if (Object.keys(planer).length === 0) throw fejl('planer', 'skal have mindst én plan');

  const tilvalg = ordbog(r['tilvalg'], 'tilvalg', (v, sti) => {
    const o = objekt(v, sti, ['navn', 'status', 'fraMaanedlig']);
    const s = o['status'];
    if (s !== 'senere' && s !== 'aktiv') throw fejl(`${sti}.status`, 'skal være "senere" eller "aktiv"');
    return { navn: tekst(o['navn'], `${sti}.navn`), status: s, fraMaanedlig: beloeb(o['fraMaanedlig'], `${sti}.fraMaanedlig`) } satisfies Tilvalg;
  });

  const fristVedFejl = heltal(r['fristVedFejl'], 'fristVedFejl', 1);
  const paamindelseVedFejl = heltal(r['paamindelseVedFejl'], 'paamindelseVedFejl', 1);
  if (paamindelseVedFejl >= fristVedFejl) throw fejl('paamindelseVedFejl', 'skal komme før fristVedFejl');
  return { status, moms: { aktiv: false }, proeve, fristVedFejl, paamindelseVedFejl, planer, tilvalg };
}

export function laesPriser(sti: string = PRISFIL): Priser {
  let tekstIndhold: string;
  try {
    tekstIndhold = fs.readFileSync(sti, 'utf8');
  } catch {
    throw new Error(`kan ikke læse prisfilen ${sti}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(tekstIndhold);
  } catch (e) {
    throw new Error(`prisfilen ${sti} er ikke gyldig JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return validerPriser(raw);
}
