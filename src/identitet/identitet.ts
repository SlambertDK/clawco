// Who is looking (KC-0116, spec D2): the tailnet identity Tailscale Serve puts
// on the request, mapped to a person in the household — or the implicit owner
// in single-user mode. Pure: the caller supplies the headers, the TCP peer and
// the household.
//
// Invariant: the person comes only from a verified header (loopback peer, i.e.
// Tailscale Serve on this machine; or, under KC_IDENTITET=konto, the Sky
// gateway's signature, KC-0179) or from single-user mode — never from a
// cookie, query string or body the client controls.

import type { Husstand, Person } from './husstand.ts';
import { verificerKonto, type KontoIndstilling } from './konto.ts';
import { stoettePerson, type StoetteAdgang } from './stoette.ts';
import { IDENTITET_TEKSTER, identitetTekst } from './tekster.ts';

export type { Person } from './husstand.ts';
/** `log` (konto only): which check failed, for the server log; never shown, never the header value. */
export type AfvistAdgang = { afvist: 401 | 403 | 503; hvorfor: string; log?: string };
export type Anmodning = { headers: Headers; peer: string | undefined };

/** The one person of a single-user install (dev, a laptop without Tailscale). */
export const ENEBRUGER: Person = { id: 'ejer', login: null, navn: 'Ejer', rolle: 'ejer' };

/** Nobody: who a lost request context resolves to. A guest without ejer — sees no privat or arbejde element. */
export const INGEN: Person = { id: 'ingen', login: null, navn: 'Ingen', rolle: 'gaest' };

export const erAfvist = (x: Person | AfvistAdgang): x is AfvistAdgang => 'afvist' in x;

/** 127.0.0.0/8, ::1 and their IPv4-mapped form. */
export function erLoopback(peer: string | undefined): boolean {
  if (!peer) return false;
  const p = peer.toLowerCase().replace(/^::ffff:/, '');
  return p === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(p);
}

/** Public Funnel traffic: Clawco is never public. */
export const erFunnel = (h: Headers): boolean => h.has('tailscale-funnel-request');

// KC-0170: the words are read when a request is refused (never at module load), so they follow the request's language.
const afvistFunnel = (): AfvistAdgang => ({ afvist: 403, hvorfor: identitetTekst().tailnetKun });
const afvistUkendt = (): AfvistAdgang => ({ afvist: 401, hvorfor: identitetTekst().ukendtPerson });
/** KC-0154: a login the household does not know — a plain page with no data (the person may simply not be invited yet). */
const afvistFremmed = (): AfvistAdgang => ({ afvist: 403, hvorfor: identitetTekst().ikkeInviteret });
/** A household file that exists but cannot be read, or (konto) no household at all: nobody can be told apart. */
export const husstandUlaeselig = (): string => identitetTekst().husstandUlaeselig;
/** The Danish sentence, for a caller that still holds the constant (it cannot follow the request's language: use husstandUlaeselig()). */
export const HUSSTAND_ULAESELIG = IDENTITET_TEKSTER.da.husstandUlaeselig;
// Konto: the same wording as the tailnet refusals, without the Tailscale hint (Sky has none).
const kontoUkendt = (): string => identitetTekst().kontoUkendt;

/** The household member with this login (case and surrounding space ignored). */
const medLogin = (personer: Person[], login: string): Person | undefined => {
  const l = login.trim().toLowerCase();
  return l ? personer.find((p) => p.login?.trim().toLowerCase() === l) : undefined;
};

export function hvemKigger(a: Anmodning, husstand: Husstand | null): Person | AfvistAdgang {
  if (erFunnel(a.headers)) return afvistFunnel();
  const login = erLoopback(a.peer) ? (a.headers.get('tailscale-user-login') ?? '').trim().toLowerCase() : '';
  const personer = husstand?.personer ?? [];
  // KC-0154: the single user carries the login Serve vouched for, so his first invitation can name him as the owner.
  if (personer.length === 0) return login ? { ...ENEBRUGER, login } : ENEBRUGER;
  const hit = medLogin(personer, login);
  if (hit) return hit;
  if (login) return afvistFremmed();
  if (personer.length === 1 && personer[0]) return personer[0];
  return afvistUkendt();
}

/**
 * KC-0179: who is looking under KC_IDENTITET=konto. Only the gateway's signature counts (konto.ts); every
 * Tailscale header is ignored, and there is no single-user mode: without a household nobody is the owner.
 */
/** KC-0188: this tenant's own record of a support grant as read for the request ('ulaeselig' = could not be read). */
export type StoetteLokal = StoetteAdgang | null | 'ulaeselig';

export function hvemKontoKigger(a: Anmodning, husstand: Husstand | null, k: KontoIndstilling, nuSek: number, stoette?: StoetteLokal): Person | AfvistAdgang {
  const v = verificerKonto(a, k, nuSek);
  if (!v.ok) return { afvist: 401, hvorfor: kontoUkendt(), log: `konto afvist: ${v.grund}` };
  const personer = husstand?.personer ?? [];
  if (personer.length === 0) return { afvist: 503, hvorfor: husstandUlaeselig(), log: 'konto: ingen husstand' };
  // KC-0188: a support session is accepted only beside this tenant's own live record of the same grant (fail closed).
  if (v.stoette) return stoettePerson(v.stoette, stoette, personer, nuSek) ?? { afvist: 401, hvorfor: kontoUkendt(), log: 'konto: støtteadgangen er ikke åben her' };
  return medLogin(personer, v.email) ?? { ...afvistFremmed(), log: 'konto: e-mailen er ikke i husstanden' };
}

export type Kigger = (a: Anmodning, husstand: Husstand | null, stoette?: StoetteLokal) => Person | AfvistAdgang;
/** Which provider the app runs: a fixed person (the test world), konto (Sky), else the tailnet. */
export type Identitetsvalg = { fast: Person } | { konto: KontoIndstilling };

export function vaelgKigger(valg: Identitetsvalg | undefined, nu: () => Date): Kigger {
  if (!valg) return hvemKigger;
  // A fixed person (the test world) still never answers Funnel traffic.
  if ('fast' in valg) return (a) => (erFunnel(a.headers) ? afvistFunnel() : valg.fast);
  return (a, husstand, stoette) => hvemKontoKigger(a, husstand, valg.konto, Math.floor(nu().getTime() / 1000), stoette);
}

/** The TCP peer from @hono/node-server's bindings (the env of a request); undefined without them. */
export function peerAf(env: unknown): string | undefined {
  return (env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
}

type Henter = { fetch: (r: Request, env?: unknown) => Response | Promise<Response> };
/**
 * KC-0179: in konto mode only a request with a valid signature reaches `signeret` (the testtilstand dispatcher,
 * whose test world answers by cookie alone); everything else goes straight to `ellers` (the app), which refuses it.
 */
export function kunSigneret(k: KontoIndstilling, nu: () => Date, signeret: Henter, ellers: Henter): (r: Request, env?: unknown) => Response | Promise<Response> {
  return (r, env) => (verificerKonto({ headers: r.headers, peer: peerAf(env) }, k, Math.floor(nu().getTime() / 1000)).ok ? signeret : ellers).fetch(r, env);
}
