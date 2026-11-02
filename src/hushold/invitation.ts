// Inviting a person into the household (KC-0154), two kinds. Pure: the room
// (room.ts) runs these inside its store queue and writes husstand.json through
// the identity port; nothing here sends or stores.
//
// - `egen` (own entry, tailnet): the owner pre-creates the member with her
//   tailnet login. Clawco only shows the owner the steps in Tailscale's admin
//   (AGENTS.md §9: Clawco never does them). Her first request through the
//   identity path (src/identitet/identitet.ts) activates the member, once.
// - `telefon` (phone only, the go-between of KC-0153): the member gets a channel
//   waiting for her "ja". The first message is built here, shown to the owner and
//   sent only on his red tap, through the policy layer with a one-time yes bound
//   to the hash of the text (kanal.ts sendJaId), once (maaSende 'invitation').
//
// Inviting never creates an account, password or token of our own (D2): a person
// is a login, a name and a role in husstand.json, or a channel handle on the
// member. At most six people (out of scope beyond that).

import { kan, erRolle, type Rolle } from '../identitet/roller.ts';
import type { Person } from '../identitet/husstand.ts';
import { erKanal, gyldigHandle, KANAL_NAVN, maaSende, neutral, sendJaId, type Kanal, type Kanalmedlem } from './kanal.ts';
import type { Medlem } from './schema.ts';
import { husstandTekst } from './tekster.ts';

export const INVITATIONER = ['egen', 'telefon'] as const;
export type InvitationSlags = (typeof INVITATIONER)[number];
export const MAX_PERSONER = 6;
/** The roles an invitation gives; who becomes an owner is the owner's later choice (skiftRolle). */
export const INVITER_ROLLER: readonly Rolle[] = ['medlem', 'barn', 'gaest'];

export const INDGANG_STATUSSER = ['venter', 'aktiv'] as const;
/** An own entry on the member: waiting for her first visit, or active since `aktiveret`. */
export type Indgang = { status: (typeof INDGANG_STATUSSER)[number]; oprettet: string; aktiveret?: string };

export type NyInvitation =
  | { slags: 'egen'; navn: string; rolle: Rolle; login: string }
  | { slags: 'telefon'; navn: string; rolle: Rolle; kanal: Kanal; handle: string };

export class InvitationFejl extends Error {
  readonly status: 400 | 403 | 404 | 409;
  constructor(hvorfor: string, status: 400 | 403 | 404 | 409 = 400) { super(hvorfor); this.name = 'InvitationFejl'; this.status = status; }
}

const SLUG_TEGN: Record<string, string> = { æ: 'ae', ø: 'oe', å: 'aa' };
/** An id from a name (a-z, 0-9, dashes; æøå spelled out), `standard` when nothing is left. */
export const slug = (navn: string, standard: string): string =>
  navn.toLowerCase().replace(/[æøå]/g, (c) => SLUG_TEGN[c] ?? c).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/g, '') || standard;

const LOGIN = /^[^\s@<>"']{1,100}@[^\s@<>"']{1,100}$/;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A name for the screen and the message: 1–80 characters, no control characters. Throws InvitationFejl. */
export function navnFra(v: unknown): string {
  const n = str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ');
  if (!n || n.length > 80) throw new InvitationFejl(husstandTekst().fejl.skrivPersonNavn);
  return n;
}

/** The form's body: which kind, a name, a role below the owner, and her login or her channel and handle. Throws InvitationFejl (400). */
export function parseInvitation(body: Record<string, unknown>): NyInvitation {
  const navn = navnFra(body['navn']);
  const rolle = body['rolle'] ?? 'medlem';
  if (!erRolle(rolle) || !INVITER_ROLLER.includes(rolle)) throw new InvitationFejl(husstandTekst().fejl.vaelgRolle);
  if (body['slags'] === 'egen') {
    const login = str(body['login']).toLowerCase();
    if (!LOGIN.test(login)) throw new InvitationFejl(husstandTekst().fejl.skrivEmail);
    return { slags: 'egen', navn, rolle, login };
  }
  if (body['slags'] === 'telefon') {
    const kanal = body['kanal'];
    if (!erKanal(kanal)) throw new InvitationFejl(husstandTekst().fejl.vaelgKanal);
    const handle = gyldigHandle(kanal, str(body['handle']));
    if (!handle) throw new InvitationFejl(kanal === 'telegram' ? husstandTekst().fejl.skrivTelegramId : husstandTekst().fejl.skrivNummer);
    return { slags: 'telefon', navn, rolle, kanal, handle };
  }
  throw new InvitationFejl(husstandTekst().fejl.vaelgHvordan);
}

/** The new person: an id from her name (unique), her login or none. A login already here or a seventh person → 409. */
export function nyPerson(personer: readonly Person[], ny: NyInvitation): Person {
  if (personer.length >= MAX_PERSONER) throw new InvitationFejl(husstandTekst().hoejstPersoner(MAX_PERSONER), 409);
  const login = ny.slags === 'egen' ? ny.login : null;
  if (login && personer.some((p) => p.login?.trim().toLowerCase() === login)) throw new InvitationFejl(husstandTekst().fejl.emailMed, 409);
  const grund = slug(ny.navn, 'person');
  let id = grund;
  for (let i = 2; personer.some((p) => p.id === id); i++) id = `${grund.slice(0, 36)}-${i}`;
  return { id, login, navn: ny.navn, rolle: ny.rolle };
}

/** The member's extras for the room's state: the waiting entry, or the channel waiting for her ja. */
export function nytMedlem(p: Person, ny: NyInvitation, nu: Date): Medlem {
  const m: Medlem = { id: p.id, navn: p.navn, rolle: p.rolle };
  if (ny.slags === 'egen') m.indgang = { status: 'venter', oprettet: nu.toISOString() };
  else m.kanal = { kanal: ny.kanal, handle: ny.handle, status: 'afventer-ja' };
  return m;
}

/**
 * The one message before her "ja", built by the app (never by Hermes): who invites, what Clawco is, that she installs
 * nothing, and the three answers. Names are neutralised the same way as a request's message (no Hermes directives).
 * It goes out in the language of the request that builds it (the owner's: the one who sees it and taps Send); her
 * reply is read in either language (svar.ts).
 */
export function invitationTekst(fraNavn: string, tilNavn: string): string {
  return neutral(husstandTekst().besked.invitation(fraNavn, tilNavn).join('\n'));
}

/** The id the red Send asks a yes for: the member, the kind and the hash of the exact text shown (KC-0153's sendJaId). */
export const invitationJaId = (medlemId: string, tekst: string): string => sendJaId(medlemId, 'invitation', tekst);

export type InvitationVurdering =
  | { ok: true; til: Kanalmedlem; tekst: string; jaId: string; kanalNavn: string; navn: string }
  | { ok: false; hvorfor: string; status: 403 | 404 | 409 };

/**
 * Whether `af` may send the invitation to member `id` now, and the exact text. The route checks it before the policy
 * layer and again inside the store's queue; the card shows a Send only when it says ok — one rule for both.
 */
export function vurderInvitation(medlemmer: readonly Medlem[], id: string, af: Person): InvitationVurdering {
  const T = husstandTekst();
  if (!kan(af.rolle, 'aendre-husstand')) return { ok: false, hvorfor: T.fejl.kunEjerInvitere, status: 403 };
  const m = medlemmer.find((x) => x.id === id);
  if (!m) return { ok: false, hvorfor: T.fejl.personFindesIkke, status: 404 };
  if (!m.kanal) return { ok: false, hvorfor: T.fejl.ingenKanal(m.navn), status: 409 };
  if (m.kanal.status === 'stoppet') return { ok: false, hvorfor: T.fejl.stoppetBeskeder(m.navn), status: 409 };
  if (m.kanal.status === 'aktiv') return { ok: false, hvorfor: T.fejl.alleredeJa(m.navn), status: 409 };
  if (!maaSende(m.kanal, 'invitation')) return { ok: false, hvorfor: T.fejl.invAlleredeSendt(m.navn), status: 409 };
  const fraNavn = medlemmer.find((x) => x.id === af.id)?.navn ?? af.navn;
  const tekst = invitationTekst(fraNavn, m.navn);
  return { ok: true, til: { medlemId: m.id, kanal: m.kanal.kanal, handle: m.kanal.handle }, tekst, jaId: invitationJaId(m.id, tekst), kanalNavn: KANAL_NAVN[m.kanal.kanal], navn: m.navn };
}

/** The invitation still pending for a member: an own entry not yet used, or a channel waiting for her ja. */
export function invitationAf(m: Medlem): InvitationSlags | null {
  if (m.indgang?.status === 'venter') return 'egen';
  if (m.kanal?.status === 'afventer-ja') return 'telefon';
  return null;
}

/** Her first visit: a waiting own entry becomes active (once). Null = nothing to do. */
export function aktiverIndgang(m: Medlem, nu: Date): Medlem | null {
  if (m.indgang?.status !== 'venter') return null;
  return { ...m, indgang: { ...m.indgang, status: 'aktiv', aktiveret: nu.toISOString() } };
}

function ejerAf(personer: readonly Person[], af: Person, id: string): Person {
  if (!kan(af.rolle, 'aendre-husstand')) throw new InvitationFejl(husstandTekst().fejl.kunEjerAendre, 403);
  const p = personer.find((x) => x.id === id);
  if (!p) throw new InvitationFejl(husstandTekst().fejl.personFindesIkke, 404);
  if (p.id === af.id) throw new InvitationFejl(husstandTekst().fejl.ikkeDigSelv, 409);
  return p;
}

/** The owner gives another person a role. The household always keeps an owner (he never changes his own). */
export function skiftRolle(personer: readonly Person[], af: Person, id: string, rolle: Rolle): Person[] {
  if (!erRolle(rolle)) throw new InvitationFejl(husstandTekst().fejl.ukendtRolle);
  ejerAf(personer, af, id);
  return personer.map((p) => (p.id === id ? { ...p, rolle } : p));
}

/** The owner removes another person from the household (her entry ends with it). */
export function fjernPerson(personer: readonly Person[], af: Person, id: string): Person[] {
  ejerAf(personer, af, id);
  return personer.filter((p) => p.id !== id);
}
