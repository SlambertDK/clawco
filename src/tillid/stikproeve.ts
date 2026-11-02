// KC-0145 "Søndagsstikprøven": was what Clawco hid this week right? Pure sampling and the ledger's rules, plus the
// ledger file ($KC_DATA_DIR/tillid/stikproever.json). The number on the card is the count of the app's own `skjult`
// records for the ISO week (src/tillid/skjulte.ts), taken when the week's sample is drawn — never a Hermes sentence.
// Invariants: the draw is a pure function of the records and the week (a reload shows the same five); every drawn line
// is answered once; a clean week = no wrong and every drawn line answered; three clean weeks in a row (after the last
// stop question) → the app asks "Skal vi stoppe søndagstjekket?"; a wrong resets the streak.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { iUge, type Skjult } from './skjulte.ts';

export type Svar = 'rigtigt' | 'forkert';
export type TraekPost = Skjult & { svar?: Svar; svaret?: string };
/** One week's sample: `uge` = its Monday, `skjulte` = what the app hid that week (counted at the draw), `forkerte` = wrongs. */
export type Stikuge = { uge: string; skjulte: number; traek: TraekPost[]; forkerte: number; perRegel?: Record<string, number> };
/** `stop`: the last time the app asked "Skal vi stoppe søndagstjekket?" (the week it was asked in) and the answer. */
export type Stikbog = { uger: Stikuge[]; stop?: { uge: string; tid: string; svar?: 'ja' | 'nej' } };

export const ANTAL = 5;
/** Clean weeks in a row before the app offers to stop (Claude's call in the ticket). */
export const RENE_FOER_STOP = 3;

/** mulberry32: a small seeded generator — the draw must be the same on every reload. */
function generator(froe: string): () => number {
  let a = createHash('sha256').update(froe).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bland<T>(liste: readonly T[], tal: () => number): T[] {
  const ud = [...liste];
  for (let i = ud.length - 1; i > 0; i--) {
    const j = Math.floor(tal() * (i + 1));
    [ud[i], ud[j]] = [ud[j] as T, ud[i] as T];
  }
  return ud;
}

/**
 * The week's sample: up to `n` of the records hidden in the week starting `uge`, seeded by the week, spread over the
 * rules that hid them (one per rule in turn, the rule-less as one group) so five never come from one rule while others
 * exist. Fewer when fewer were hidden; none when none.
 */
export function traekStikproeve(skjulte: readonly Skjult[], uge: string, n = ANTAL): Skjult[] {
  const tal = generator(`stikproeve:${uge}`);
  const sorteret = [...iUge(skjulte, uge)].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const grupper = new Map<string, Skjult[]>();
  for (const s of sorteret) grupper.set(s.regelId ?? '', [...(grupper.get(s.regelId ?? '') ?? []), s]);
  const koer = bland([...grupper.keys()].sort(), tal).map((k) => bland(grupper.get(k) ?? [], tal));
  const ud: Skjult[] = [];
  for (let runde = 0; ud.length < n && koer.some((k) => k.length > runde); runde++) {
    for (const k of koer) { const s = k[runde]; if (s && ud.length < n) ud.push(s); }
  }
  return ud;
}

/** No wrong and every drawn line answered (a week with nothing drawn is not clean). */
export const renUge = (u: Stikuge): boolean => u.traek.length > 0 && u.forkerte === 0 && u.traek.every((t) => t.svar !== undefined);

/** Clean weeks in a row, counted back from the newest, only weeks after the last stop question. */
export function rentIRaekke(bog: Stikbog): number {
  const efter = bog.stop?.uge;
  const uger = [...bog.uger].filter((u) => !efter || u.uge > efter).sort((a, b) => (a.uge < b.uge ? -1 : 1));
  let n = 0;
  for (let i = uger.length - 1; i >= 0 && renUge(uger[i] as Stikuge); i--) n++;
  return n;
}

/** Whether to ask "Skal vi stoppe søndagstjekket?" now: three clean weeks in a row, no question pending, not stopped. */
export const boerTilbydeStop = (bog: Stikbog): boolean => !(bog.stop && bog.stop.svar !== 'nej') && rentIRaekke(bog) >= RENE_FOER_STOP;

/** The newest week's sample while some drawn line waits for an answer (the card), else undefined. */
export function aabenUge(bog: Stikbog): Stikuge | undefined {
  const nyeste = [...bog.uger].sort((a, b) => (a.uge < b.uge ? -1 : 1)).at(-1);
  return nyeste && nyeste.traek.some((t) => t.svar === undefined) ? nyeste : undefined;
}

export type Besvaret = { bog: Stikbog; udfald: 'ok' | 'allerede' | 'ukendt'; post?: TraekPost };

/** Records `svar` on line `id` of week `uge`, once. Pure. A wrong is counted for the week and per rule. */
export function besvar(bog: Stikbog, uge: string, id: string, svar: Svar, nu: Date): Besvaret {
  const u = bog.uger.find((x) => x.uge === uge);
  const p = u?.traek.find((t) => t.id === id);
  if (!u || !p) return { bog, udfald: 'ukendt' };
  if (p.svar) return { bog, udfald: 'allerede', post: p };
  const ny: TraekPost = { ...p, svar, svaret: nu.toISOString() };
  const perRegel = svar === 'forkert' && p.regelId ? { ...u.perRegel, [p.regelId]: (u.perRegel?.[p.regelId] ?? 0) + 1 } : u.perRegel;
  const nyUge: Stikuge = { ...u, traek: u.traek.map((t) => (t.id === id ? ny : t)), forkerte: u.forkerte + (svar === 'forkert' ? 1 : 0), ...(perRegel ? { perRegel } : {}) };
  return { bog: { ...bog, uger: bog.uger.map((x) => (x === u ? nyUge : x)) }, udfald: 'ok', post: ny };
}

// ---- the ledger file -----------------------------------------------------------

export type StikbogLager = {
  laes(): Promise<Stikbog>;
  /** One step: `fn` gets the ledger read inside the chain; returning the same object writes nothing. */
  endre(fn: (b: Stikbog) => Stikbog | Promise<Stikbog>): Promise<Stikbog>;
};

const UGE = /^\d{4}-\d{2}-\d{2}$/;

function somBog(v: unknown): Stikbog {
  if (typeof v !== 'object' || v === null || !Array.isArray((v as Stikbog).uger)) return { uger: [] };
  const b = v as Stikbog;
  const uger = b.uger.filter((u) => typeof u === 'object' && u !== null && typeof u.uge === 'string' && UGE.test(u.uge) && Array.isArray(u.traek) && typeof u.skjulte === 'number');
  const stop = b.stop && typeof b.stop.uge === 'string' && UGE.test(b.stop.uge) ? b.stop : undefined;
  return { uger, ...(stop ? { stop } : {}) };
}

export function lavStikbog(o: { dir: string }): StikbogLager {
  const fil = path.join(o.dir, 'tillid', 'stikproever.json');
  let kaede: Promise<unknown> = Promise.resolve();
  const laes = async (): Promise<Stikbog> => {
    try { return somBog(JSON.parse(await readFile(fil, 'utf8'))); } catch { return { uger: [] }; }
  };
  return {
    laes: () => (kaede as Promise<unknown>).then(laes, laes),
    endre: (fn) => {
      const trin = async (): Promise<Stikbog> => {
        const nu = await laes();
        const ny = await fn(nu);
        if (ny === nu) return nu;
        await mkdir(path.dirname(fil), { recursive: true });
        const tmp = `${fil}.tmp-${randomUUID()}`;
        await writeFile(tmp, JSON.stringify(ny, null, 2), 'utf8');
        await rename(tmp, fil);
        return ny;
      };
      const r = kaede.then(trin, trin);
      kaede = r.catch(() => undefined);
      return r;
    },
  };
}

/** The ledger with the stop question asked now (in the newest week) when boerTilbydeStop; else the very same object. */
export function medStopTilbud(bog: Stikbog, nu: Date): Stikbog {
  if (!boerTilbydeStop(bog)) return bog;
  const nyeste = [...bog.uger].sort((a, b) => (a.uge < b.uge ? -1 : 1)).at(-1);
  return nyeste ? { ...bog, stop: { uge: nyeste.uge, tid: nu.toISOString() } } : bog;
}
