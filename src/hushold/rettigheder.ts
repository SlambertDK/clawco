// What each role in the household sees and does (KC-0154): the visibility matrix,
// enforced on the server. Every husstand route and the Nu/Hjem lines ask these two
// functions; the screen only draws what they allow, and a refused check is a 403
// or a 404 — never an element hidden with CSS. Pure.
//
// Derived from the one role table (src/identitet/roller.ts) and the data zones
// (src/identitet/zoner.ts), so there is no second list of roles here:
// - shared things (the week, the things, who is in it): `se-husstand` (not a guest);
// - things between people (a request, a clash, a weekend card, a booking draft): its
//   parties only, whatever their role — the owner too (KC-0149: a third person sees
//   none of it); a guest sees exactly the requests addressed to her;
// - the invitations: `aendre-husstand` (the owner);
// - an element in zone privat or arbejde: only its own person (synligFor), whatever
//   kind it claims. Invariant: no role ever sees another person's privat or arbejde.
// G4 (Henrik 2026-10-31, "Som voksne"): a child has a member's rights.

import { kan } from '../identitet/roller.ts';
import { synligFor, type DataZone } from '../identitet/zoner.ts';
import type { Person } from '../identitet/husstand.ts';

export const ELEMENT_SLAGS = ['uge', 'ressource', 'medlem', 'foresp', 'sammenfald', 'konflikt', 'udkast', 'invitation', 'linje'] as const;
export type ElementSlags = (typeof ELEMENT_SLAGS)[number];
/**
 * An element as the check sees it. `parter`: whom it is between (a request's asker and recipient, a clash's two
 * bookers, a weekend card's two adults, a draft's author). `zone`/`ejer`: its data zone and, for privat/arbejde,
 * whose it is (a log line carries both).
 */
export type HusElement = { slags: ElementSlags; parter?: readonly string[]; zone?: DataZone; ejer?: string };

export const HANDLING_SLAGS = ['spoerg', 'svar', 'book', 'ressource', 'inviter', 'send-invitation', 'skift-rolle', 'fjern-medlem'] as const;
export type HandlingSlags = (typeof HANDLING_SLAGS)[number];
/** `parter`: when known, the parties of what is acted on (`svar` is only for a party). */
export type HusHandling = { slags: HandlingSlags; parter?: readonly string[] };

const erPart = (p: Person, parter: readonly string[] | undefined): boolean => (parter ?? []).includes(p.id);

export function maaSe(p: Person, el: HusElement): boolean {
  if (el.zone !== undefined && el.zone !== 'husstand' && !synligFor(p, { zone: el.zone, ...(el.ejer ? { ejer: el.ejer } : {}) })) return false;
  switch (el.slags) {
    case 'uge': case 'ressource': case 'medlem': return kan(p.rolle, 'se-husstand');
    case 'foresp': case 'sammenfald': case 'konflikt': case 'udkast': return kan(p.rolle, 'laese') && erPart(p, el.parter);
    case 'invitation': return kan(p.rolle, 'aendre-husstand');
    case 'linje': return el.zone === undefined || el.zone === 'husstand' ? kan(p.rolle, 'se-husstand') : kan(p.rolle, 'laese');
    default: return false;
  }
}

export function maaHandle(p: Person, h: HusHandling): boolean {
  switch (h.slags) {
    case 'spoerg': case 'book': case 'ressource': return kan(p.rolle, 'handle');
    case 'svar': return kan(p.rolle, 'handle') && (h.parter === undefined || erPart(p, h.parter));
    case 'inviter': case 'send-invitation': case 'skift-rolle': case 'fjern-medlem': return kan(p.rolle, 'aendre-husstand');
    default: return false;
  }
}

/**
 * The room's actions (room.ts AKTION_VERBER) by the handling they are; startAction refuses any name not here, and a
 * test keeps the two lists equal. Answering, withdrawing and dropping one's own request are a party's `svar`; a
 * booking draft's Drop tidies the author's own card (`book`).
 */
export const AKTION_HANDLING: Readonly<Record<string, HandlingSlags>> = {
  opret: 'spoerg', 'spoerg-igen': 'spoerg', svar: 'svar', traek: 'svar', drop: 'svar',
  book: 'book', 'book-spoerg': 'spoerg', 'sammenfald-valg': 'book', 'sammenfald-spoerg': 'spoerg',
  'udkast-book': 'book', 'udkast-spoerg': 'spoerg', 'udkast-drop': 'book',
  'tilfoej-ressource': 'ressource', 'ret-ressource': 'ressource', 'fjern-ressource': 'ressource',
  'konflikt-valg': 'spoerg',
  inviter: 'inviter', rolle: 'skift-rolle', 'fjern-medlem': 'fjern-medlem',
};
