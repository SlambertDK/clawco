// KC-0041/KC-0043: an opgave is a task Henrik sent to Claude Code. Pure: no
// I/O. The contract with the metode plugin on the Mac is
// docs/superpowers/specs/2026-10-29-udviklingspipeline-fase1-design.md.
// The invariant: an opgave only moves along the transition table, `faerdig` is
// final, and only Henrik's sentence is the task — `grundlag` is quoted data.

import { randomBytes } from 'node:crypto';
import { findProjekt } from './projekter.ts';

export type OpgaveStatus = 'sendt' | 'modtaget' | 'i-gang' | 'parkeret' | 'faerdig';
export type Grundlag = { titel: string; linjer: string[]; kilder: string[] };
/** KC-0045: what Claude Code asks Henrik when a ticket is parked on his decision; the first valg is the recommendation. */
export type Spoergsmaal = { tekst: string; valg: string[]; stillet: string };
export type Svar = { tekst: string; tid: string };
export type Opgave = {
  id: string; projekt: string; repo: string; saetning: string; grundlag: Grundlag | null;
  kilde: 'kort' | 'chat'; oprettet: string; opdateret: string; status: OpgaveStatus;
  ticket?: string; bevis?: string; pr?: string; grund?: string;
  /** KC-0048: when it first became faerdig, and the day its change was rolled back (YYYY-MM-DD). */
  faerdigTid?: string; tilbagerullet?: string;
  /** Only while `parkeret` (KC-0045). */
  spoergsmaal?: Spoergsmaal; svar?: Svar;
};
export type Udfald = { ok: true; opgave: Opgave } | { ok: false; status: 400 | 409; error: string };

export const STATUSSER: readonly OpgaveStatus[] = ['sendt', 'modtaget', 'i-gang', 'parkeret', 'faerdig'];
export const MAX_SAETNING = 500;
export const MAX_SVAR = 500;
export const OPGAVE_ID = /^o-[a-z0-9]{4,40}$/;
const TICKET = /^[A-Z]{2,5}-\d{4}$/;
const DATO = /^\d{4}-\d{2}-\d{2}$/;
const PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const SYV_DAGE = 7 * 86_400_000;
const STAAET_KRAV = 10 * 60_000;

/** Which status may follow which; the same status again is always an update of the fields. */
const NAESTE: Record<OpgaveStatus, readonly OpgaveStatus[]> = {
  sendt: ['modtaget'],
  modtaget: ['sendt', 'i-gang', 'parkeret', 'faerdig'],
  'i-gang': ['parkeret', 'faerdig'],
  parkeret: ['modtaget', 'i-gang', 'faerdig'],
  faerdig: [],
};

const fejl = (status: 400 | 409, error: string): Udfald => ({ ok: false, status, error });

export function nyOpgave(i: { projekt: string; saetning: string; grundlag: Grundlag | null; kilde: Opgave['kilde'] }, now: Date): Udfald {
  const p = findProjekt(i.projekt);
  if (!p) return fejl(400, 'Ukendt projekt');
  const saetning = i.saetning.trim();
  if (!saetning) return fejl(400, 'Skriv én sætning om, hvad Claude Code skal gøre');
  if (saetning.length > MAX_SAETNING) return fejl(400, `Sætningen må højst være ${MAX_SAETNING} tegn`);
  const tid = now.toISOString();
  const id = `o-${now.getTime().toString(36)}${randomBytes(2).toString('hex')}`;
  return { ok: true, opgave: { id, projekt: p.id, repo: p.repo, saetning, grundlag: i.grundlag, kilde: i.kilde, oprettet: tid, opdateret: tid, status: 'sendt' } };
}

const tekst = (v: unknown, max: number): string | undefined | null =>
  v === undefined ? undefined : typeof v === 'string' ? v.trim().slice(0, max) : null;

/** Applies a status report from the Mac. Unchanged → the very same object, so the caller writes nothing. */
export function skiftStatus(o: Opgave, b: Record<string, unknown>, now: Date): Udfald {
  const til = b['status'];
  if (typeof til !== 'string' || !STATUSSER.includes(til as OpgaveStatus)) return fejl(400, `status skal være en af ${STATUSSER.join(', ')}`);
  const status = til as OpgaveStatus;
  const ticket = tekst(b['ticket'], 20);
  const pr = tekst(b['pr'], 300);
  const bevis = tekst(b['bevis'], 1000);
  const grund = tekst(b['grund'], 600);
  if (ticket === null || pr === null || bevis === null || grund === null) return fejl(400, 'ticket, pr, bevis og grund skal være tekst');
  if (ticket && !TICKET.test(ticket)) return fejl(400, 'ticket skal ligne KC-0049');
  if (pr && !PR.test(pr)) return fejl(400, 'pr skal være et GitHub pull-link');
  const tilbagerullet = tekst(b['tilbagerullet'], 10);
  if (tilbagerullet === null || (tilbagerullet && !DATO.test(tilbagerullet))) return fejl(400, 'tilbagerullet skal være en dato (YYYY-MM-DD)');
  if (tilbagerullet && status !== 'faerdig') return fejl(400, 'Kun en færdig opgave kan være rullet tilbage');
  const sp = b['spoergsmaal'];
  let spoergsmaal: { tekst: string; valg: string[] } | undefined;
  if (sp !== undefined) {
    const spTekst = typeof sp === 'object' && sp !== null ? tekst((sp as Record<string, unknown>)['tekst'], 600) : null;
    if (!spTekst) return fejl(400, 'spoergsmaal skal have en tekst');
    if (status !== 'parkeret') return fejl(400, 'Et spørgsmål kræver status parkeret');
    const v = (sp as Record<string, unknown>)['valg'];
    const valg = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 120)).filter(Boolean).slice(0, 4) : [];
    spoergsmaal = { tekst: spTekst, valg };
  }
  if (status !== o.status && !NAESTE[o.status].includes(status)) return fejl(409, `Kan ikke gå fra ${o.status} til ${status}`);
  // A claim that already became a ticket stays claimed: releasing it would make a second ticket.
  if (o.status === 'modtaget' && status === 'sendt' && o.ticket) return fejl(409, 'Opgaven er allerede blevet til en ticket');
  // One ticket per opgave: the id never changes once set.
  if (ticket && o.ticket && ticket !== o.ticket) return fejl(409, `Opgaven er allerede ${o.ticket}`);
  // The claim is exclusive. A claim with no ticket after STAAET_KRAV (a session that died mid-way) may be taken over.
  if (o.status === 'modtaget' && status === 'modtaget' && !ticket) {
    if (o.ticket || now.getTime() - new Date(o.opdateret).getTime() < STAAET_KRAV) return fejl(409, 'Opgaven er allerede modtaget');
    return { ok: true, opgave: { ...o, opdateret: now.toISOString() } };
  }

  const ny: Opgave = { ...o, status };
  if (ticket) ny.ticket = ticket;
  if (pr) ny.pr = pr;
  if (bevis) ny.bevis = bevis;
  if (grund) ny.grund = grund;
  if (tilbagerullet) ny.tilbagerullet = tilbagerullet;
  if (status === 'faerdig' && o.status !== 'faerdig') ny.faerdigTid = now.toISOString();
  // The invariant: a question (and its answer) exists only while parkeret; a new question drops the old answer.
  if (status !== 'parkeret') { delete ny.spoergsmaal; delete ny.svar; }
  else if (spoergsmaal && !(o.spoergsmaal?.tekst === spoergsmaal.tekst && o.spoergsmaal.valg.join('\n') === spoergsmaal.valg.join('\n'))) {
    ny.spoergsmaal = { ...spoergsmaal, stillet: now.toISOString() };
    delete ny.svar;
  }
  const felter = ['status', 'ticket', 'pr', 'bevis', 'grund', 'tilbagerullet', 'spoergsmaal', 'svar'] as const;
  if (felter.every((f) => ny[f] === o[f])) return { ok: true, opgave: o };
  ny.opdateret = now.toISOString();
  return { ok: true, opgave: ny };
}

/** KC-0045: Henrik's answer to the open question. Once: a second answer, or one with no open question, is 409. */
export function svar(o: Opgave, raw: unknown, now: Date): Udfald {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t) return fejl(400, 'Skriv dit svar');
  if (t.length > MAX_SVAR) return fejl(400, `Svaret må højst være ${MAX_SVAR} tegn`);
  if (o.status !== 'parkeret' || !o.spoergsmaal) return fejl(409, 'Claude Code venter ikke på et svar her');
  if (o.svar) return fejl(409, 'Du har allerede svaret');
  const tid = now.toISOString();
  return { ok: true, opgave: { ...o, svar: { tekst: t, tid }, opdateret: tid } };
}

const aaben = (o: Opgave): boolean => o.status !== 'faerdig' && o.status !== 'parkeret';

/** What Hjem shows: every open opgave, finished or parked ones for 7 days after their last change; newest first. */
export function synlige(opgaver: readonly Opgave[], now: Date): Opgave[] {
  return opgaver
    .filter((o) => aaben(o) || now.getTime() - new Date(o.opdateret).getTime() <= SYV_DAGE)
    .sort((a, b) => b.oprettet.localeCompare(a.oprettet));
}

/** KC-0048: the trust numbers per project. Rolled-back changes are not counted as landed; `minutter` is the median time from sent to done. */
export type ProjektTal = { projekt: string; landet: number; rullet: number; parkeret: number; aabne: number; minutter?: number };

export function tillid(opgaver: readonly Opgave[]): ProjektTal[] {
  const pr = new Map<string, { tal: ProjektTal; tider: number[] }>();
  for (const o of opgaver) {
    const p = pr.get(o.projekt) ?? { tal: { projekt: o.projekt, landet: 0, rullet: 0, parkeret: 0, aabne: 0 }, tider: [] };
    pr.set(o.projekt, p);
    if (o.status === 'parkeret') p.tal.parkeret++;
    else if (o.status !== 'faerdig') p.tal.aabne++;
    else {
      if (o.tilbagerullet) p.tal.rullet++; else p.tal.landet++;
      // Before KC-0048 there was no faerdigTid; opdateret is the closest record of when it finished.
      p.tider.push((new Date(o.faerdigTid ?? o.opdateret).getTime() - new Date(o.oprettet).getTime()) / 60_000);
    }
  }
  return [...pr.values()].map(({ tal, tider }) => {
    if (!tider.length) return tal;
    const t = tider.sort((a, b) => a - b);
    const m = t.length % 2 ? t[(t.length - 1) / 2]! : (t[t.length / 2 - 1]! + t[t.length / 2]!) / 2;
    return { ...tal, minutter: Math.max(0, Math.round(m)) };
  });
}
