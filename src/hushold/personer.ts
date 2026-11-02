// Who is in the household universe (KC-0148). The E1 identity (husstand.json,
// KC-0116) is the one source of who is a member, their name and role; the
// room's stored members only add what identity does not know. And the
// relevance rule (KC-0052): Husstanden exists for a person only when the
// household is more than one person (or a resource or request exists), and
// only for a member who is not a guest — or, KC-0154, a guest a request is
// addressed to. Pure.

import type { Person } from '../identitet/husstand.ts';
import type { HusstandState, Medlem } from './schema.ts';
import { maaSe } from './rettigheder.ts';

/** The E1 port: the persons of the household (empty = single-user). */
export interface Personer {
  personer(): Promise<Person[]>;
}

export function medlemmerAf(personer: readonly Person[], gemte: readonly Medlem[]): Medlem[] {
  return personer.map((p) => {
    const m: Medlem = { id: p.id, navn: p.navn, rolle: p.rolle };
    if (p.login) m.tailnetLogin = p.login;
    const g = gemte.find((x) => x.id === p.id);
    if (g?.relation) m.relation = g.relation;
    if (g?.telefon) m.telefon = g.telefon;
    if (g?.kanal) m.kanal = { ...g.kanal }; // KC-0153: the go-between's channel
    if (g?.indgang) m.indgang = { ...g.indgang }; // KC-0154: an own entry the owner pre-created
    return m;
  });
}

export const husstandRelevant = (medlemmer: readonly Medlem[], state: HusstandState): boolean =>
  medlemmer.length >= 2 || state.ressourcer.length > 0 || state.forespoergsler.length > 0;

/**
 * KC-0154 (rettigheder.ts): a member who sees the shared things, when the household is relevant; a guest only while a
 * request is addressed to her (then the room shows her that and nothing more).
 */
export function maaSeHusstand(person: Person, medlemmer: readonly Medlem[], state: HusstandState): boolean {
  if (!medlemmer.some((m) => m.id === person.id)) return false;
  if (maaSe(person, { slags: 'medlem' })) return husstandRelevant(medlemmer, state);
  return state.forespoergsler.some((f) => maaSe(person, { slags: 'foresp', parter: [f.fra, f.til] }));
}
