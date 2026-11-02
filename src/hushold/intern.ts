// The tenant's internal household route (KC-0184): POST /intern/husstand/medlem, called by Clawco Sky only — with a
// control signature (src/identitet/kontrol.ts) — when an invitation is accepted (tilfoej), a member is removed or
// leaves (fjern), or the owner changes a role (rolle). Sky's account pages are where the owner invites, with his own
// click; this route never sends anything and nothing in the app (Hermes, a rule, the voice, the clock) calls it.
//
// Pure: the body and the change of the persons. The room (room.ts internMedlem) runs it inside its store queue and
// writes husstand.json through the identity port (skrivHusstand: validated, atomic) and the member's extras (a
// waiting own entry, activated on her first visit as KC-0154's owner invite). The owner is never added, changed or
// removed here (no transfer of ownership); every operation is idempotent, so Sky may retry.

import { erRolle, type HusRolle } from '../identitet/roller.ts';
import type { Person } from '../identitet/husstand.ts';
import { INVITER_ROLLER, InvitationFejl, navnFra, nyPerson } from './invitation.ts';

export const INTERN_STI = '/intern/husstand/medlem';
/** The largest body the route reads (a name is at most 80 characters). */
export const INTERN_MAKS_BYTES = 2048;

export type InternOp =
  | { op: 'tilfoej'; email: string; navn: string; rolle: HusRolle }
  | { op: 'fjern'; email: string }
  | { op: 'rolle'; email: string; rolle: HusRolle };

const EMAIL = /^[^\s@<>"']{1,100}@[^\s@<>"']{1,100}$/;
const FELTER: Record<InternOp['op'], string> = { tilfoej: 'email,navn,op,rolle', fjern: 'email,op', rolle: 'email,op,rolle' };

function rolleFra(v: unknown): HusRolle {
  if (!erRolle(v) || !INVITER_ROLLER.includes(v)) throw new InvitationFejl('Vælg medlem, barn eller gæst.');
  return v;
}

/** The body: exactly the fields of its operation. Throws InvitationFejl (400). */
export function parseIntern(raw: unknown): InternOp {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new InvitationFejl('Ugyldig forespørgsel.');
  const o = raw as Record<string, unknown>;
  const op = o['op'];
  if (op !== 'tilfoej' && op !== 'fjern' && op !== 'rolle') throw new InvitationFejl('Ukendt handling.');
  if (Object.keys(o).sort().join() !== FELTER[op]) throw new InvitationFejl('Ugyldig forespørgsel.');
  const email = typeof o['email'] === 'string' ? o['email'].trim().toLowerCase() : '';
  if (!EMAIL.test(email)) throw new InvitationFejl('Ugyldig mailadresse.');
  if (op === 'fjern') return { op, email };
  if (op === 'rolle') return { op, email, rolle: rolleFra(o['rolle']) };
  return { op, email, navn: navnFra(o['navn']), rolle: rolleFra(o['rolle']) };
}

const medLogin = (personer: readonly Person[], email: string): Person | undefined => personer.find((p) => p.login?.trim().toLowerCase() === email.trim().toLowerCase());

/** The persons after the operation, and the one it concerned. Throws InvitationFejl: 409 for the owner or no owner,
 *  409 for a seventh person, 404 for a role change of someone not here. */
export function anvendIntern(personer: readonly Person[], op: InternOp): { personer: Person[]; person: Person | null; aendret: boolean } {
  if (!personer.some((p) => p.rolle === 'ejer')) throw new InvitationFejl('Husstanden har ingen ejer.', 409);
  const fandtes = medLogin(personer, op.email);
  if (fandtes?.rolle === 'ejer') throw new InvitationFejl('Ejeren ændres ikke herfra.', 409);
  if (op.op === 'fjern') {
    if (!fandtes) return { personer: [...personer], person: null, aendret: false };
    return { personer: personer.filter((p) => p !== fandtes), person: fandtes, aendret: true };
  }
  if (op.op === 'rolle' && !fandtes) throw new InvitationFejl('Personen findes ikke (længere).', 404);
  if (fandtes) {
    if (fandtes.rolle === op.rolle) return { personer: [...personer], person: fandtes, aendret: false };
    const ny = { ...fandtes, rolle: op.rolle };
    return { personer: personer.map((p) => (p === fandtes ? ny : p)), person: ny, aendret: true };
  }
  if (op.op !== 'tilfoej') throw new InvitationFejl('Personen findes ikke (længere).', 404);
  const p = nyPerson(personer, { slags: 'egen', navn: op.navn, rolle: op.rolle, login: op.email.trim().toLowerCase() });
  return { personer: [...personer, p], person: p, aendret: true };
}
