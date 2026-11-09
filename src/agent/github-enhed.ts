// KC-0263: "Sign in with GitHub" for the Copilot transport (copilot.ts), by GitHub's OAuth device flow
// (docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow): no client secret and no
// callback address, so the same OAuth App works on localhost, a tailnet name and every Sky tenant. The person types a
// short code on github.com; Clawco asks GitHub, at the interval GitHub names, whether it was approved.
//
// Invariants: the token goes only into the NoegleLager under `copilot` (the encrypted store where KC_HEMMELIGHEDER_FIL
// is set) and only its length leaves this file; the device code never leaves it at all (only the user code and the
// verification link go to the browser). GitHub's error text never leaves either: each answer maps to one fixed kind.
// Without a client id nothing is called and the state says so (fail closed). Pure over an injected fetch, clock and
// sleeper, so the tests run against a fake GitHub.

import type { NoegleLager } from './noeglelager.ts';

/** Clawco's own OAuth App (registered 2026-11-03 under SlambertDK: device flow on, user tokens do not expire). A client id
 *  is public: the device flow uses no secret. KC_GITHUB_CLIENT_ID overrides it; 'off' switches GitHub sign-in off (server.ts githubKlientId). */
export const GITHUB_KLIENT_ID = 'Ov23liF4asHVqjBdQahW';
/**
 * The scope asked for. GitHub's Copilot SDK docs name none for an OAuth App user token (gho_); read:user is read-only
 * and covers GET /user for the login name. ASSUMED sufficient for Copilot until the first real sign-in (KC-0263).
 */
export const GITHUB_SCOPE = 'read:user';
/** The provider id the token is kept under in the NoegleLager. */
export const GITHUB_UDBYDER = 'copilot';

export type GithubAdresser = { kode: string; token: string; bruger: string; side: string };

/** GitHub's three addresses, or a loopback fake's (tests and the local check; see githubBase). */
export function githubAdresser(base?: string): GithubAdresser {
  if (base) return { kode: `${base}/login/device/code`, token: `${base}/login/oauth/access_token`, bruger: `${base}/user`, side: base };
  return { kode: 'https://github.com/login/device/code', token: 'https://github.com/login/oauth/access_token', bruger: 'https://api.github.com/user', side: 'https://github.com' };
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** KC_GITHUB_BASE_URL, test-only: accepted only as a loopback http(s) origin, refused otherwise (the token must never go elsewhere). */
export function githubBase(raa: string | undefined): string | undefined {
  const v = (raa ?? '').trim();
  if (!v) return undefined;
  let u: URL;
  try { u = new URL(v); } catch { throw new Error('KC_GITHUB_BASE_URL skal være en loopback-adresse (kun til test)'); }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !LOOPBACK.has(u.hostname) || u.username || u.password || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('KC_GITHUB_BASE_URL skal være en loopback-adresse (kun til test)');
  }
  return u.origin;
}

export type Enhedskode = { deviceCode: string; userCode: string; verificationUri: string; intervalS: number; udloeberMs: number };
export type PollSvar =
  | { slags: 'token'; token: string }
  | { slags: 'venter' }
  | { slags: 'langsommere'; intervalS?: number }
  | { slags: 'udloebet' }
  | { slags: 'afvist' }
  | { slags: 'fejl' }
  /** GitHub's permanent error codes: retrying cannot help. */
  | { slags: 'afbrudt' };

type Wire = Record<string, unknown>;
const isRecord = (v: unknown): v is Wire => typeof v === 'object' && v !== null && !Array.isArray(v);
const BRUGERKODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const ENHEDSKODE = /^[A-Za-z0-9_-]{1,200}$/;
const TOKEN_FORM = /^[A-Za-z0-9_]{20,255}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const TIMEOUT_MS = 15_000;

/** One form POST to GitHub with JSON back; GitHub answers device-flow errors as 200 with an `error` field. */
async function post(fetchImpl: typeof fetch, url: string, felter: Record<string, string>): Promise<Wire> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(felter).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const d: unknown = await res.json().catch(() => null);
  if (!isRecord(d)) throw new Error('GitHub svarede ikke som ventet');
  return d;
}

/** Asks GitHub for a device code. Rejects with a fixed sentence on anything but GitHub's own shape (a link to another site included). */
export async function bestilKode(o: { klientId: string; scope?: string; adresser: GithubAdresser; fetchImpl?: typeof fetch; nu?: () => number }): Promise<Enhedskode> {
  const d = await post(o.fetchImpl ?? fetch, o.adresser.kode, { client_id: o.klientId, scope: o.scope ?? GITHUB_SCOPE });
  const { device_code: dc, user_code: uc, verification_uri: vu, expires_in: ud, interval: iv } = d;
  let link: URL | undefined;
  try { link = typeof vu === 'string' ? new URL(vu) : undefined; } catch { link = undefined; }
  const ok = typeof dc === 'string' && ENHEDSKODE.test(dc) && typeof uc === 'string' && BRUGERKODE.test(uc)
    && link !== undefined && link.origin === new URL(o.adresser.side).origin && typeof ud === 'number' && ud > 0;
  if (!ok) throw new Error('GitHub svarede ikke som ventet');
  const intervalS = typeof iv === 'number' && iv >= 1 && iv <= 120 ? iv : 5;
  return { deviceCode: dc, userCode: uc, verificationUri: link!.href, intervalS, udloeberMs: (o.nu ?? Date.now)() + Math.min(ud, 3600) * 1000 };
}

/** One poll: GitHub's answer as one kind. Never throws; a network failure is `fejl`. */
export async function spoergEfterToken(o: { klientId: string; adresser: GithubAdresser; fetchImpl?: typeof fetch }, deviceCode: string): Promise<PollSvar> {
  let d: Wire;
  try {
    d = await post(o.fetchImpl ?? fetch, o.adresser.token, { client_id: o.klientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
  } catch { return { slags: 'fejl' }; }
  const t = d['access_token'];
  if (typeof t === 'string') return TOKEN_FORM.test(t) ? { slags: 'token', token: t } : { slags: 'fejl' };
  switch (d['error']) {
    case 'authorization_pending': return { slags: 'venter' };
    case 'slow_down': return typeof d['interval'] === 'number' && d['interval'] >= 1 && d['interval'] <= 120 ? { slags: 'langsommere', intervalS: d['interval'] } : { slags: 'langsommere' };
    case 'expired_token': return { slags: 'udloebet' };
    case 'access_denied': return { slags: 'afvist' };
    case 'incorrect_device_code': case 'device_flow_disabled': case 'incorrect_client_credentials': case 'unsupported_grant_type': return { slags: 'afbrudt' };
    default: return { slags: 'fejl' };
  }
}

/** GET /user once for the login name (shown, kept in Start's state; nothing else of the answer is read). Undefined on anything odd. */
export async function hentLogin(token: string, adresser: GithubAdresser, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const res = await fetchImpl(adresser.bruger, { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return undefined;
    const d: unknown = await res.json();
    const login = isRecord(d) ? d['login'] : undefined;
    return typeof login === 'string' && LOGIN.test(login) ? login : undefined;
  } catch { return undefined; }
}

/** What Start shows of the sign-in. Never the token, never the device code. */
export type GithubTilstand =
  | { tilstand: 'ikke-sat-op' }
  | { tilstand: 'ude' }
  | { tilstand: 'venter'; userCode: string; verificationUri: string; udloeber: string }
  | { tilstand: 'inde'; login?: string; laengde: number }
  | { tilstand: 'udloebet' }
  | { tilstand: 'afvist' }
  | { tilstand: 'fejl' };

export type GithubInde = { login?: string; laengde: number };

export interface GithubLogin {
  status(): Promise<GithubTilstand>;
  /** Asks GitHub for a code and waits for the approval in the background; `naarInde` runs once the token is saved. */
  start(naarInde?: (r: GithubInde) => Promise<void>): Promise<GithubTilstand>;
  /** Signs out: ends a wait, removes the token from the store and stops the Copilot client. */
  ud(): Promise<void>;
  /** Resolves when the current wait has ended (tests). */
  faerdig(): Promise<void>;
}

/** Consecutive failed polls (network blip, timeout, non-JSON answer) that end a sign-in as 'fejl'; one blip never does. */
export const MAKS_FEJL_I_RAEKKE = 5;

export function createGithubLogin(o: {
  klientId: string;
  scope?: string;
  adresser: GithubAdresser;
  lager: NoegleLager;
  fetchImpl?: typeof fetch;
  nu?: () => number;
  /** Waits ms; rejects when the signal aborts (a new start or a sign-out ends the wait). */
  vent?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** A new token was saved: stop the client that runs on the old one. */
  paaNyToken?: () => Promise<void>;
  /** Signed out: stop the client. */
  paaUd?: () => Promise<void>;
}): GithubLogin {
  const nu = o.nu ?? Date.now;
  const vent = o.vent ?? ((ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    t.unref?.();
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('afbrudt')); }, { once: true });
  }));
  let afslut: AbortController | undefined;
  let loeb: Promise<void> = Promise.resolve();
  let venter: Extract<GithubTilstand, { tilstand: 'venter' }> | undefined;
  let slut: GithubTilstand | undefined;
  let login: string | undefined;

  async function inde(): Promise<GithubTilstand | undefined> {
    const t = await o.lager.hent(GITHUB_UDBYDER).catch(() => undefined);
    return t ? { tilstand: 'inde', ...(login ? { login } : {}), laengde: t.length } : undefined;
  }

  async function vente(kode: Enhedskode, signal: AbortSignal, naarInde?: (r: GithubInde) => Promise<void>): Promise<void> {
    let intervalS = kode.intervalS;
    let traekFejl = 0;
    const afsluttet = (t: GithubTilstand): void => { if (!signal.aborted) { venter = undefined; slut = t; } };
    for (;;) {
      try { await vent(intervalS * 1000, signal); } catch { return; }
      if (signal.aborted) return;
      if (nu() >= kode.udloeberMs) return afsluttet({ tilstand: 'udloebet' });
      const svar = await spoergEfterToken({ klientId: o.klientId, adresser: o.adresser, ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) }, kode.deviceCode);
      if (signal.aborted) return;
      if (svar.slags === 'fejl') { if (++traekFejl >= MAKS_FEJL_I_RAEKKE) return afsluttet({ tilstand: 'fejl' }); continue; } // a blip is retried; only GitHub's verdict or the expiry ends the wait
      if (svar.slags === 'afbrudt') return afsluttet({ tilstand: 'fejl' });
      traekFejl = 0;
      if (svar.slags === 'venter') continue;
      if (svar.slags === 'langsommere') { intervalS = svar.intervalS ?? intervalS + 5; continue; }
      if (svar.slags !== 'token') return afsluttet({ tilstand: svar.slags });
      let laengde: number;
      try {
        ({ laengde } = await o.lager.saet(GITHUB_UDBYDER, svar.token));
        login = await hentLogin(svar.token, o.adresser, o.fetchImpl);
        await o.paaNyToken?.().catch(() => undefined);
        afsluttet({ tilstand: 'inde', ...(login ? { login } : {}), laengde });
      } catch { afsluttet({ tilstand: 'fejl' }); return; }
      // Signed in either way: what the caller does next (save the choice, the live test) cannot undo that.
      await naarInde?.({ ...(login ? { login } : {}), laengde }).catch(() => undefined);
      return;
    }
  }

  return {
    async status() {
      if (venter) return venter;
      if (slut && slut.tilstand !== 'inde') return slut;
      const i = await inde();
      if (i) return i;
      return o.klientId ? { tilstand: 'ude' } : { tilstand: 'ikke-sat-op' };
    },
    async start(naarInde) {
      if (!o.klientId) return { tilstand: 'ikke-sat-op' };
      afslut?.abort();
      const ac = new AbortController();
      afslut = ac;
      slut = undefined;
      venter = undefined;
      let kode: Enhedskode;
      try {
        kode = await bestilKode({ klientId: o.klientId, adresser: o.adresser, nu, ...(o.scope ? { scope: o.scope } : {}), ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) });
      } catch {
        if (!ac.signal.aborted) slut = { tilstand: 'fejl' };
        return { tilstand: 'fejl' };
      }
      if (ac.signal.aborted) return (await this.status());
      venter = { tilstand: 'venter', userCode: kode.userCode, verificationUri: kode.verificationUri, udloeber: new Date(kode.udloeberMs).toISOString() };
      loeb = vente(kode, ac.signal, naarInde);
      return venter;
    },
    async ud() {
      afslut?.abort();
      afslut = undefined;
      venter = undefined;
      slut = undefined;
      login = undefined;
      await o.lager.fjern(GITHUB_UDBYDER);
      await o.paaUd?.().catch(() => undefined);
    },
    faerdig: () => loeb,
  };
}
