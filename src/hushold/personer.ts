// Who is in the household universe (KC-0148). The E1 identity (husstand.json,
// KC-0116) is the one source of who is a member, their name and role; the
// room's stored members only add what identity does not know. And the
// relevance rule (KC-0052): Husstanden exists for a person only when the
// household is more than one person (or a resource or request exists), and
// only for a member who is not a guest. Pure.

import type { Person } from '../identitet/husstand.ts';
import type { HusstandState, Medlem } from './schema.ts';

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
    return m;
  });
}

export const husstandRelevant = (medlemmer: readonly Medlem[], state: HusstandState): boolean =>
  medlemmer.length >= 2 || state.ressourcer.length > 0 || state.forespoergsler.length > 0;

export const maaSeHusstand = (person: Person, medlemmer: readonly Medlem[], state: HusstandState): boolean =>
  person.rolle !== 'gaest' && medlemmer.some((m) => m.id === person.id) && husstandRelevant(medlemmer, state);
