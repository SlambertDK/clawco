// KC-0203: what the closed beta remembers on the tenant: when it started, whether the household shares its numbers,
// the feedback it chose to send, and which cards are answered. One small file, $KC_DATA_DIR/beta.json, written
// atomically. Pure functions for the day count and the card that is due; the lager only reads and writes.
//
// Consent invariant (the ticket): `samtykke` starts from KC_BETA_SAMTYKKE at the very first read and is the person's
// after that — a restart with the env still saying ja never turns a no back on.

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { skrivAtomisk } from '../store/atomisk.ts';

export const FEEDBACK_DAGE = [3, 7, 14] as const;
export type FeedbackDag = (typeof FEEDBACK_DAGE)[number];
/** The last beta day a feedback card is still offered. */
export const SLUT_DAG = 21;
export const BETALE = ['ja', 'maaske', 'nej'] as const;
export type Betale = (typeof BETALE)[number];
export const TEKST_MAKS = 500;

export type Feedback = { dag: FeedbackDag; vurdering: 1 | 2 | 3 | 4 | 5; tekst: string | null; betale: Betale | null; tid: string };
export type BetaTilstand = {
  /** ISO instant of the first read under KC_BETA. */
  startet: string;
  samtykke: boolean;
  /** When the plain "lukket beta" card was dismissed; absent = it still shows. */
  betaKortLukket?: string;
  /** "Ikke nu" on a card: that card is hidden for the UTC date given. */
  udsat?: { dag: FeedbackDag; dato: string };
  /** When each card was answered. */
  svaret: Partial<Record<FeedbackDag, string>>;
  feedback: Feedback[];
};

export class BetaFejl extends Error {}

const DAG_MS = 86_400_000;
const utcDag = (d: Date): number => Math.floor(d.getTime() / DAG_MS);
export const utcDato = (d: Date): string => d.toISOString().slice(0, 10);

/** 1 on the day of the first start (UTC), then one more per UTC calendar day; never below 1. */
export function betaDag(startet: string, nu: Date): number {
  return Math.max(1, utcDag(nu) - utcDag(new Date(startet)) + 1);
}

/** The feedback card to show now, or null: the newest card whose day has come, if unanswered and not snoozed today; none after day 21. */
export function kortDue(t: BetaTilstand, nu: Date): FeedbackDag | null {
  const dag = betaDag(t.startet, nu);
  if (dag > SLUT_DAG) return null;
  const kort = [...FEEDBACK_DAGE].reverse().find((n) => dag >= n);
  if (kort === undefined || t.svaret[kort]) return null;
  if (t.udsat?.dag === kort && t.udsat.dato === utcDato(nu)) return null;
  return kort;
}

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const erIso = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && !Number.isNaN(Date.parse(v));
const erDag = (v: unknown): v is FeedbackDag => (FEEDBACK_DAGE as readonly unknown[]).includes(v);

function parseFeedback(v: unknown): Feedback | null {
  if (!erObj(v) || !erDag(v['dag']) || !Number.isInteger(v['vurdering']) || (v['vurdering'] as number) < 1 || (v['vurdering'] as number) > 5 || !erIso(v['tid'])) return null;
  const tekst = v['tekst'];
  if (tekst !== null && (typeof tekst !== 'string' || tekst.length > TEKST_MAKS)) return null;
  const betale = v['betale'];
  if (betale !== null && !(BETALE as readonly unknown[]).includes(betale)) return null;
  if (betale !== null && v['dag'] !== 14) return null; // the pay question exists on day 14 only
  return { dag: v['dag'], vurdering: v['vurdering'] as Feedback['vurdering'], tekst, betale: betale as Betale | null, tid: v['tid'] };
}

/** The file as it is read: anything that does not match is null (the caller fails loudly; nothing is repaired by guessing). */
export function parseBetaTilstand(raw: unknown): BetaTilstand | null {
  if (!erObj(raw) || !erIso(raw['startet']) || typeof raw['samtykke'] !== 'boolean' || !Array.isArray(raw['feedback']) || !erObj(raw['svaret'])) return null;
  const svaret: BetaTilstand['svaret'] = {};
  for (const [k, v] of Object.entries(raw['svaret'])) {
    const dag = Number(k);
    if (!erDag(dag) || !erIso(v)) return null;
    svaret[dag] = v;
  }
  const feedback = raw['feedback'].map(parseFeedback);
  if (feedback.some((f) => f === null)) return null;
  const lukket = raw['betaKortLukket'];
  if (lukket !== undefined && !erIso(lukket)) return null;
  const u = raw['udsat'];
  if (u !== undefined && !(erObj(u) && erDag(u['dag']) && typeof u['dato'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(u['dato']))) return null;
  return { startet: raw['startet'], samtykke: raw['samtykke'], ...(lukket !== undefined ? { betaKortLukket: lukket } : {}), ...(u !== undefined ? { udsat: { dag: (u as { dag: FeedbackDag }).dag, dato: (u as { dato: string }).dato } } : {}), svaret, feedback: feedback as Feedback[] };
}

export type BetaLager = {
  /** The state; the first read under the beta creates it. null only for `kunMedFil` without a file (the beta is off there). Throws BetaFejl on a damaged file. */
  laes(): Promise<BetaTilstand | null>;
  /** Read, change, write atomically — one change at a time. */
  aendre(fn: (s: BetaTilstand) => BetaTilstand): Promise<BetaTilstand>;
};

export function lavBetaLager(o: { dir: string; nu: () => Date; samtykkeStart: boolean; kunMedFil?: boolean }): BetaLager {
  const fil = path.join(o.dir, 'beta.json');
  let kaede: Promise<unknown> = Promise.resolve();
  const enkeltvis = <T>(fn: () => Promise<T>): Promise<T> => { const r = kaede.then(fn); kaede = r.catch(() => undefined); return r; };
  const skriv = async (s: BetaTilstand): Promise<void> => { await mkdir(o.dir, { recursive: true }); await skrivAtomisk(fil, JSON.stringify(s, null, 2)); };
  const laes = async (): Promise<BetaTilstand | null> => {
    let tekst: string;
    try { tekst = await readFile(fil, 'utf8'); } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw new BetaFejl(`beta.json kunne ikke læses: ${(err as Error).message}`);
      if (o.kunMedFil) return null;
      const ny: BetaTilstand = { startet: o.nu().toISOString(), samtykke: o.samtykkeStart, svaret: {}, feedback: [] };
      await skriv(ny);
      return ny;
    }
    let raw: unknown;
    try { raw = JSON.parse(tekst); } catch { throw new BetaFejl('beta.json er ikke gyldig JSON'); }
    const s = parseBetaTilstand(raw);
    if (!s) throw new BetaFejl('beta.json har forkert form');
    return s;
  };
  return {
    laes: () => enkeltvis(laes),
    aendre: (fn) => enkeltvis(async () => {
      const nu = await laes();
      if (!nu) throw new BetaFejl('betaen er ikke slået til');
      const ny = fn(nu);
      await skriv(ny);
      return ny;
    }),
  };
}
