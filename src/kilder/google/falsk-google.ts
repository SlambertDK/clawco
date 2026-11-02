// A fake Google, in process (KC-0133, KC-0135): the token, revoke and calendar
// endpoints the connectors call, as a `fetch` they are handed. For tests, the
// test world and a dev check — no network, nothing real. It checks what Google
// checks (client id + secret, the code once, the PKCE S256 verifier, the same
// redirect URI, known scopes, a bearer token it issued whose scope covers the
// API) and answers in Google's shapes, including incremental authorization
// (`include_granted_scopes`) and an unsigned ID token naming the account when
// openid and email were granted. `samtykke(url)` stands in for the user
// pressing "Allow" on Google's consent page: it returns the redirect URL with
// the code and state.

import { randomBytes } from 'node:crypto';
import { ENDPOINTS, fletScopes, SCOPE_ADRESSE, SCOPE_KALENDER, SCOPE_MAIL, scopesFra, udfordring, type Hent, type Klient } from './oauth.ts';

/** A calendar as calendarList lists it, with its events in Google's event shape. */
export type FalskKalender = { id: string; summary: string; events: Record<string, unknown>[] };

const ADGANG_SEK = 3600;
/** The scopes this fake knows (a consent request for anything else is a bug in the connector under test). */
const KENDTE: ReadonlySet<string> = new Set([SCOPE_KALENDER, SCOPE_MAIL, ...SCOPE_ADRESSE]);
/** Mail seeded as already logged in: the mail scope and the address. */
const MAIL_SCOPES: readonly string[] = [SCOPE_MAIL, ...SCOPE_ADRESSE];
/** Google answers `email` as the userinfo scope. */
const scopeSvar = (scopes: readonly string[]): string => scopes.map((x) => (x === 'email' ? 'https://www.googleapis.com/auth/userinfo.email' : x)).join(' ');
const svar = (status: number, json: unknown): Response => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
const nyt = (praefiks: string): string => `${praefiks}${randomBytes(18).toString('base64url')}`;

/** Start of an event in ms (all-day = UTC midnight of its date); end likewise, or start when absent. */
function spaend(e: Record<string, unknown>): [number, number] {
  const tid = (v: unknown): number => {
    const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
    return typeof o['date'] === 'string' ? Date.parse(`${o['date']}T00:00:00Z`) : Date.parse(String(o['dateTime'] ?? ''));
  };
  const s = tid(e['start']);
  const slut = tid(e['end']);
  return [s, Number.isNaN(slut) ? s : slut];
}

/**
 * `kendteRefresh`: calendar refresh tokens it accepts besides its own (a seeded connection); `kendteMailRefresh`: the same
 * for mail; `afvis(scopes)`: while true for a refresh token's scopes, that refresh is invalid_grant; `konto`: the address
 * the one account has.
 */
export function falskGoogle(o: { klient: Klient; kalendere: (nu: Date) => FalskKalender[]; nu?: () => Date; kendteRefresh?: string[]; kendteMailRefresh?: string[]; afvis?: (scopes: readonly string[]) => boolean; konto?: string }) {
  const nu = o.nu ?? (() => new Date());
  const konto = o.konto ?? 'ella@gmail.example';
  const koder = new Map<string, { udfordring: string; tilbage: string; scopes: string[] }>();
  const refresh = new Map<string, string[]>([...(o.kendteRefresh ?? []).map((t) => [t, [SCOPE_KALENDER]] as [string, string[]]), ...(o.kendteMailRefresh ?? []).map((t) => [t, [...MAIL_SCOPES]] as [string, string[]])]);
  const adgange = new Map<string, string[]>();
  /** Everything the one account has granted this app so far (what include_granted_scopes brings along). */
  let givet: string[] = [];
  const udstedt: string[] = [];
  const idTokens: string[] = [];
  const tokenKald: string[] = [];
  const tilbagekaldt: string[] = [];

  /** An unsigned ID token (Google signs its own; a connector reading it straight from the token endpoint does not check). */
  const nytIdToken = (): string => {
    const del = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');
    const t = `${del({ alg: 'none' })}.${del({ iss: 'https://accounts.google.com', email: konto, email_verified: true })}.falsk`;
    idTokens.push(t);
    return t;
  };

  const tokenSvar = async (krop: URLSearchParams): Promise<Response> => {
    const grant = krop.get('grant_type') ?? '';
    tokenKald.push(grant);
    if (krop.get('client_id') !== o.klient.id || krop.get('client_secret') !== o.klient.hemmelighed) return svar(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
    const adgang = nyt('ya29.falsk-');
    if (grant === 'authorization_code') {
      const k = koder.get(krop.get('code') ?? '');
      koder.delete(krop.get('code') ?? '');
      if (!k || k.tilbage !== krop.get('redirect_uri') || udfordring(krop.get('code_verifier') ?? '') !== k.udfordring) return svar(400, { error: 'invalid_grant', error_description: 'Bad Request' });
      const r = nyt('1//falsk-');
      refresh.set(r, k.scopes);
      adgange.set(adgang, k.scopes); udstedt.push(adgang);
      const idToken = k.scopes.includes('openid') && k.scopes.includes('email') ? nytIdToken() : undefined;
      return svar(200, { access_token: adgang, expires_in: ADGANG_SEK, refresh_token: r, scope: scopeSvar(k.scopes), token_type: 'Bearer', ...(idToken ? { id_token: idToken } : {}) });
    }
    if (grant === 'refresh_token') {
      const scopes = refresh.get(krop.get('refresh_token') ?? '');
      if (!scopes || o.afvis?.(scopes)) return svar(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      adgange.set(adgang, scopes); udstedt.push(adgang);
      return svar(200, { access_token: adgang, expires_in: ADGANG_SEK, scope: scopeSvar(scopes), token_type: 'Bearer' });
    }
    return svar(400, { error: 'unsupported_grant_type' });
  };

  const apiSvar = (url: URL, auth: string): Response => {
    const scopes = adgange.get(auth.replace(/^Bearer /, ''));
    if (!scopes) return svar(401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
    if (!scopes.includes(SCOPE_KALENDER)) return svar(403, { error: { code: 403, message: 'Request had insufficient authentication scopes.' } });
    const sti = url.pathname.replace('/calendar/v3', '');
    const alle = o.kalendere(nu());
    if (sti === '/users/me/calendarList') return svar(200, { kind: 'calendar#calendarList', items: alle.map((k) => ({ id: k.id, summary: k.summary, accessRole: 'owner' })) });
    const m = /^\/calendars\/([^/]+)\/events$/.exec(sti);
    const kal = m ? alle.find((k) => k.id === decodeURIComponent(m[1]!)) : undefined;
    if (!kal) return svar(404, { error: { code: 404, message: 'Not Found' } });
    const fra = Date.parse(url.searchParams.get('timeMin') ?? '');
    const til = Date.parse(url.searchParams.get('timeMax') ?? '');
    const items = kal.events.filter((e) => { const [s, slut] = spaend(e); return slut > fra && s < til; }).sort((a, b) => spaend(a)[0] - spaend(b)[0]);
    return svar(200, { kind: 'calendar#events', summary: kal.summary, items });
  };

  const hent = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const krop = new URLSearchParams(String(init?.body ?? ''));
    const ren = `${url.origin}${url.pathname}`;
    if (ren === ENDPOINTS.token && init?.method === 'POST') return tokenSvar(krop);
    if (ren === ENDPOINTS.tilbagekald && init?.method === 'POST') {
      const t = krop.get('token') ?? '';
      if (!refresh.delete(t) && !adgange.delete(t)) return svar(400, { error: 'invalid_token' });
      tilbagekaldt.push(t);
      adgange.clear(); // a refresh token's revocation takes its access tokens with it
      return svar(200, {});
    }
    if (url.href.startsWith(ENDPOINTS.kalender)) return apiSvar(url, new Headers(init?.headers).get('authorization') ?? '');
    return svar(404, { error: 'not_found' });
  }) as Hent;

  return {
    hent,
    /** The user consents on Google's page: the redirect URL with code and state (only for this client, the read-only scope and S256). */
    samtykke(samtykkeUrl: string): string {
      const u = new URL(samtykkeUrl);
      const p = u.searchParams;
      const bedt = scopesFra(p.get('scope'));
      if (`${u.origin}${u.pathname}` !== ENDPOINTS.samtykke || p.get('client_id') !== o.klient.id || !bedt.length || !bedt.every((x) => KENDTE.has(x)) || p.get('code_challenge_method') !== 'S256' || p.get('response_type') !== 'code') {
        throw new Error('falsk Google: ugyldig samtykke-forespørgsel (klient, scope, S256 eller response_type)');
      }
      const udvid = p.get('include_granted_scopes') === 'true';
      const scopes = udvid ? fletScopes(givet, bedt) : bedt;
      givet = fletScopes(givet, bedt);
      const kode = nyt('4/falsk-');
      koder.set(kode, { udfordring: p.get('code_challenge') ?? '', tilbage: p.get('redirect_uri') ?? '', scopes });
      const tilbage = new URL(p.get('redirect_uri') ?? '');
      tilbage.searchParams.set('state', p.get('state') ?? '');
      tilbage.searchParams.set('code', kode);
      return tilbage.href;
    },
    /** The grant_type of every token call, in order. */
    tokenKald: (): string[] => [...tokenKald],
    /** Every access token issued (for the tests that prove none leaks). */
    udstedteAdgange: (): string[] => [...udstedt],
    /** Every ID token issued (it names the account, so it must not leak either). */
    udstedteIdTokens: (): string[] => [...idTokens],
    /** Everything the one account has granted this app. */
    givetScopes: (): string[] => [...givet],
    /** Whether `token` is an access token this fake issued, still valid, whose scope covers `scope` (for a fake IMAP server to check). */
    erAdgang: (token: string, scope: string): boolean => adgange.get(token)?.includes(scope) ?? false,
    tilbagekaldte: (): string[] => [...tilbagekaldt],
    /** Google drops every access token early (the next API call is a 401). */
    udloebAdgang(): void { adgange.clear(); },
    /** The user removed the app at Google (or a Testing app's seven days passed): every grant is gone. */
    tilbagekaldAlt(): void { refresh.clear(); adgange.clear(); },
  };
}

export type FalskGoogle = ReturnType<typeof falskGoogle>;
