// KC-0232, the Danmark-pakke: recognise "you have new Digital Post" in mail the app already reads. Not a connector: no
// access of its own, nothing is fetched, no secret is read — a pure rule over the `Kuvert[]` of the connected mail
// sources (findings: docs/superpowers/specs/2026-11-02-digital-post-undersoegelse.md §6). It sees sender, subject and
// time, never a body, and never the letter.
//
// The sender is the person's: an address they confirmed in Start, never guessed. KENDTE_DOMAENER is a hint (what Start
// may suggest and accept), not a confirmation. Depends on kilder/types only (never rooms, AGENTS §4 r1).

import type { Kuvert } from '../types.ts';

/** Where a Digital Post notification may come from — a HINT for Start's list and field, never a confirmation. */
export const KENDTE_DOMAENER: readonly string[] = ['digitalpost.dk', 'e-boks.dk', 'mit.dk', 'borger.dk'];
/** The longest short subject shown. */
export const EMNE_MAKS = 80;
/** How many "Set den" marks are kept: the newest ones (an older notice has expired long before it falls off). */
export const SET_MAKS = 200;
const DAG_MS = 86_400_000;
/** A mail dated further ahead than this is not believed (a spoofed date could keep a card on screen). */
const FREMTID_MS = DAG_MS;

export type Notits = {
  /** The mail's Message-ID, else the envelope's own id: what "Set den" marks. */
  id: string;
  /** ISO instant of the mail. */
  modtaget: string;
  /** The confirmed address that sent it. */
  afsender: string;
  /** The subject as plain, short text (see korteEmne); escaped by the renderer, never a link. */
  emneKort: string;
};

export type Valg = {
  /** The addresses the person confirmed, lower-cased. */
  afsendere: readonly string[];
  nu: Date;
  /** Ids the person marked "Set den". */
  set: ReadonlySet<string>;
  /** A notice older than this many days is gone from the screen. Default 14. */
  udloebDage?: number;
};

/** An address on one of `domaener` (or a subdomain of one); the whole address must be one address. */
export function erKendtDomaene(adresse: string, domaener: readonly string[] = KENDTE_DOMAENER): boolean {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(adresse.trim());
  const vaerts = m?.[1]?.toLowerCase();
  if (!vaerts || !/^[a-z0-9.-]+$/.test(vaerts)) return false;
  return domaener.some((d) => vaerts === d || vaerts.endsWith(`.${d}`));
}

/**
 * The inbox's own senders that sit on a hint domain: the candidates Start offers. Addresses only (never a subject),
 * each once, lower-cased, in the order they first appear; read or unread, any age.
 */
export function kandidatAfsendere(kuverter: readonly Kuvert[], domaener: readonly string[] = KENDTE_DOMAENER): string[] {
  const ud: string[] = [];
  for (const k of kuverter) {
    const a = typeof k.fraEmail === 'string' ? k.fraEmail.trim().toLowerCase() : '';
    if (a && erKendtDomaene(a, domaener) && !ud.includes(a)) ud.push(a);
  }
  return ud;
}

/** The subject for the card: one plain line, control and bidi characters gone, any web address removed, at most EMNE_MAKS. Text, never markup: html`` escapes it where it is drawn. A bare "domain.tld/path" without a scheme stays text; it is not clickable. */
export function korteEmne(emne: string): string {
  const linje = String(emne ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '')
    .replace(/\bwww\.\S*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return linje.slice(0, EMNE_MAKS).trimEnd();
}

const GENERISK = /^(notifikation (om|fra) )?(du har (fået )?|der er (kommet )?)?(ny|nye) (digital )?(post|besked|beskeder|brev|breve)( i (din |dit )?(digital )?(post|postkasse))?$/;
/** The "you have new post" kind of subject that says nothing the card does not already say (also an empty one). */
export function GENERISK_EMNE(emne: string): boolean {
  const e = korteEmne(emne).toLowerCase().replace(/[.!\s]+$/, '');
  return e === '' || GENERISK.test(e);
}

/**
 * The notices in `kuverter`: an unread envelope from a confirmed sender, dated within the window, not marked seen.
 * Duplicates by id collapse (the newest stays); the newest comes first. A date that cannot be read, or lies days ahead,
 * gives none: such a notice could never expire. Pure; the mail source failing is the caller's "kan ikke se", not an empty list.
 */
export function genkendDigitalPost(kuverter: readonly Kuvert[], valg: Valg): Notits[] {
  const afsendere = new Set(valg.afsendere.map((a) => a.toLowerCase()));
  const udloeb = (valg.udloebDage ?? 14) * DAG_MS;
  const nu = valg.nu.getTime();
  const nyeste = new Map<string, { k: Kuvert; t: number }>();
  for (const k of kuverter) {
    const a = typeof k.fraEmail === 'string' ? k.fraEmail.trim().toLowerCase() : '';
    if (!a || !afsendere.has(a)) continue;
    const t = Date.parse(k.modtaget);
    if (Number.isNaN(t)) continue;
    const id = k.messageId || k.id;
    const gammel = nyeste.get(id);
    if (!gammel || t > gammel.t) nyeste.set(id, { k, t });
  }
  const ud: (Notits & { t: number })[] = [];
  for (const [id, { k, t }] of nyeste) {
    if (k.laest || valg.set.has(id) || nu - t > udloeb || t - nu > FREMTID_MS) continue;
    ud.push({ id, modtaget: k.modtaget, afsender: k.fraEmail!.trim().toLowerCase(), emneKort: korteEmne(k.emne), t });
  }
  return ud.sort((a, b) => b.t - a.t).map(({ t: _t, ...n }) => n);
}

/** `id` added to the seen list (moved to the end if it was there), the list cut to the newest SET_MAKS. */
export const tilfoejSet = (set: readonly string[], id: string): string[] => [...set.filter((x) => x !== id), id].slice(-SET_MAKS);
