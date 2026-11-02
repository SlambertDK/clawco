// Google OAuth 2.0 shared by the Google connectors (KC-0133 calendar, KC-0135
// Gmail): authorization code flow with PKCE (S256), plain fetch through an
// injected `hent` (tests and the test world use a fake Google; nothing here
// knows). Endpoints and parameters per Google's "OAuth 2.0 for Web Server
// Applications" and "for Installed Apps" (PKCE) docs, read 2026-10-31 and
// 2026-11-01. Each connector states what it accepts as a `ScopeKrav`: the one
// scope it needs and which others it tolerates (e.g. a calendar scope already
// granted to the same app and merged in by incremental authorization).
//
// Invariant: a grant without the required scope, or with a scope the
// connector does not tolerate, is refused. No message here carries a token,
// code or client secret.

import { createHash, randomBytes } from 'node:crypto';
import { KildeFejl } from '../types.ts';

export type Hent = typeof fetch;
export type Klient = { id: string; hemmelighed: string };

export const SCOPE_KALENDER = 'https://www.googleapis.com/auth/calendar.readonly';
/** IMAP and SMTP over XOAUTH2 (Google's XOAUTH2 protocol page): the only user scope for IMAP, which Google words as full access. */
export const SCOPE_MAIL = 'https://mail.google.com/';
/** OpenID Connect: with `email` the ID token names the account, which XOAUTH2 needs and the card never asks the person to type. */
export const SCOPE_ADRESSE: readonly string[] = ['openid', 'email'];
export const ENDPOINTS = {
  samtykke: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  tilbagekald: 'https://oauth2.googleapis.com/revoke',
  kalender: 'https://www.googleapis.com/calendar/v3',
} as const;

/** afvist: Google refused the grant (invalid_grant — expired, revoked, or a 7-day token from an app in Testing); klient: the client id/secret is wrong; nede: Google could not be reached or failed. */
export type GoogleArt = 'afvist' | 'klient' | 'nede';
export class GoogleFejl extends KildeFejl {
  readonly art: GoogleArt;
  constructor(art: GoogleArt, besked: string) { super(502, besked); this.name = 'GoogleFejl'; this.art = art; }
}

const b64url = (b: Buffer): string => b.toString('base64url');

/** RFC 7636: 64 random bytes → 86 unreserved characters. */
export const lavVerifier = (): string => b64url(randomBytes(64));
/** The S256 challenge: base64url (no padding) of SHA-256 of the verifier. */
export const udfordring = (verifier: string): string => b64url(createHash('sha256').update(verifier, 'ascii').digest());

/**
 * The consent URL. `scopes` default to the calendar's. `udvid` (incremental authorization): the new access token also
 * covers what the person already granted this Google app, so a second connector asks only for its own scope and the
 * person keeps one Google account link.
 */
export function samtykkeUrl(o: { klientId: string; tilbage: string; state: string; udfordring: string; scopes?: readonly string[]; udvid?: boolean }): string {
  const p = new URLSearchParams({
    client_id: o.klientId, redirect_uri: o.tilbage, response_type: 'code', scope: (o.scopes ?? [SCOPE_KALENDER]).join(' '),
    // offline + consent: Google returns a refresh token every time, also when the account consented before.
    access_type: 'offline', prompt: 'consent', state: o.state, code_challenge: o.udfordring, code_challenge_method: 'S256',
  });
  if (o.udvid) p.set('include_granted_scopes', 'true');
  return `${ENDPOINTS.samtykke}?${p}`;
}

/** Google's space-delimited scope string as a list (anything else: none). */
export const scopesFra = (v: unknown): string[] => (typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : []);
/** A duplicate-free union of scope lists, first occurrence first. */
export const fletScopes = (...lister: (readonly string[])[]): string[] => [...new Set(lister.flat())];

/** What a connector accepts in a grant (granular consent lets the person untick scopes, and a merged grant can carry others). */
export type ScopeKrav = { kraevet: string; afvis(scope: string): boolean; mangler: string; formeget: string };
export const KALENDER_KRAV: ScopeKrav = {
  kraevet: SCOPE_KALENDER, afvis: (x) => /\/auth\/calendar/.test(x),
  mangler: 'Clawco fik ikke lov til at se kalenderen. Log ind igen, og sæt flueben ved kalenderen.',
  formeget: 'Google gav mere end læseadgang til kalenderen. Clawco tager kun imod læseadgang.',
};
/** Mail tolerates the address scopes (Google answers `email` as userinfo.email) and the read-only calendar a merged grant brings along. */
const MAIL_TILLADT: ReadonlySet<string> = new Set([...SCOPE_ADRESSE, 'https://www.googleapis.com/auth/userinfo.email', SCOPE_KALENDER]);
export const MAIL_KRAV: ScopeKrav = {
  kraevet: SCOPE_MAIL, afvis: (x) => !MAIL_TILLADT.has(x),
  mangler: 'Clawco fik ikke lov til at læse din mail. Log ind igen, og sæt flueben ved mail.',
  formeget: 'Google gav mere end mail og din adresse. Clawco tager kun imod det, den bad om.',
};

/** The verified address in an ID token received straight from the token endpoint over TLS (Google: no signature check needed then). */
export function adresseFraIdToken(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const del = v.split('.');
  if (del.length !== 3 || !del[1]) return null;
  let p: unknown;
  try { p = JSON.parse(Buffer.from(del[1], 'base64url').toString('utf8')); } catch { return null; }
  if (typeof p !== 'object' || p === null) return null;
  const { email, email_verified: verificeret } = p as { email?: unknown; email_verified?: unknown };
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+$/.test(email) || verificeret === false) return null;
  return email;
}

type TokenSvar = { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; scope?: unknown; id_token?: unknown; error?: unknown };

/** POSTs a form to the token endpoint; a refusal is classified, never echoed (Google's text could quote the request). */
async function tokenKald(hent: Hent, krop: Record<string, string>): Promise<TokenSvar> {
  let svar: Response;
  try {
    svar = await hent(ENDPOINTS.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(krop).toString() });
  } catch { throw new GoogleFejl('nede', 'Google kunne ikke nås. Prøv igen om lidt.'); }
  let json: TokenSvar = {};
  try { json = (await svar.json()) as TokenSvar; } catch { /* an empty or non-JSON body is classified by status */ }
  if (svar.ok) return json;
  if (json.error === 'invalid_grant') throw new GoogleFejl('afvist', 'Google har trukket adgangen tilbage eller ladet den udløbe. Log ind med Google igen.');
  if (json.error === 'invalid_client' || json.error === 'unauthorized_client') throw new GoogleFejl('klient', 'Google kender ikke Clawcos nøgle til kalenderen. Tjek klient-id og hemmelighed.');
  throw new GoogleFejl('nede', `Google svarede med fejl ${svar.status}.`);
}

function adgangFra(j: TokenSvar): { adgang: string; udloeberMs: number } {
  if (typeof j.access_token !== 'string' || !j.access_token) throw new GoogleFejl('nede', 'Google sendte ingen adgang.');
  const sek = typeof j.expires_in === 'number' && j.expires_in > 0 ? j.expires_in : 3600;
  return { adgang: j.access_token, udloeberMs: sek * 1000 };
}

/** The granted scopes must hold the required one and nothing the connector does not tolerate. */
function tjekScope(scopes: string[], krav: ScopeKrav): void {
  if (!scopes.includes(krav.kraevet)) throw new KildeFejl(403, krav.mangler);
  if (scopes.some((x) => x !== krav.kraevet && krav.afvis(x))) throw new KildeFejl(403, krav.formeget);
}

/** The code from the redirect, exchanged for a refresh token (kept), an access token (memory only) and, when the address was asked for, the account's address. */
export async function byttKode(o: { hent: Hent; klient: Klient; kode: string; verifier: string; tilbage: string; krav: ScopeKrav }): Promise<{ refresh: string; adgang: string; udloeberMs: number; scopes: string[]; adresse?: string }> {
  const j = await tokenKald(o.hent, {
    grant_type: 'authorization_code', code: o.kode, code_verifier: o.verifier, redirect_uri: o.tilbage, client_id: o.klient.id, client_secret: o.klient.hemmelighed,
  });
  if (typeof j.refresh_token !== 'string' || !j.refresh_token) throw new KildeFejl(502, 'Google gav ikke en varig adgang. Prøv at logge ind igen.');
  const scopes = scopesFra(j.scope);
  tjekScope(scopes, o.krav);
  const adresse = adresseFraIdToken(j.id_token);
  return { refresh: j.refresh_token, ...adgangFra(j), scopes, ...(adresse ? { adresse } : {}) };
}

export async function forny(o: { hent: Hent; klient: Klient; refresh: string }): Promise<{ adgang: string; udloeberMs: number }> {
  const j = await tokenKald(o.hent, { grant_type: 'refresh_token', refresh_token: o.refresh, client_id: o.klient.id, client_secret: o.klient.hemmelighed });
  return adgangFra(j);
}

/** Revokes a token at Google (a refresh token revokes its access tokens too). Best effort: true on 200. */
export async function tilbagekald(o: { hent: Hent; token: string }): Promise<boolean> {
  try {
    const r = await o.hent(ENDPOINTS.tilbagekald, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: o.token }).toString() });
    return r.ok;
  } catch { return false; }
}
