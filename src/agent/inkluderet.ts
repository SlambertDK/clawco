// KC-0265: Clawco's AI included in a Sky plan, the tenant's side. Sky runs a model proxy (KC-0264) that speaks the
// Anthropic Messages wire and counts what each tenant uses; the tenant is given two values: KC_MODEL_PROXY_URL (the proxy's
// address) and KC_MODEL_TOKEN_FIL (a file on a private tmpfs holding the tenant's bearer token, delivered after the
// container started, so it may appear a little after boot). This module holds what the built-in agent needs of that and
// nothing else: the validated address, the token read at call time (never cached, never logged, never copied into the
// encrypted store), the month's meter (GET /v1/forbrug, cached briefly) and what the proxy last said on a run (402 =
// the month's allowance is used up, 503 = not available), so Start and Nu can say it calmly. Imports nothing of the app;
// server.ts wires it in (the redactor, the live bus).

import { readFile } from 'node:fs/promises';
import type { NoegleLager } from './noeglelager.ts';

/** The one provider id of the included model (Start's udbydere.ts names it; the NoegleLager seam answers it from the token file). */
export const INKLUDERET_ID = 'clawco';

/** What the meter says: percent of the month's allowance used and the date it starts over (YYYY-MM-DD). Never an amount, never a model. */
export type Forbrug = { procent: number; nulstilles: string };

/** What a run's answer from the proxy tells: used up (with the reset date when the proxy gave one), not available, or fine. */
export type InkluderetHaendelse = { art: 'kvote'; nulstilles?: string } | { art: 'utilgaengelig' } | { art: 'ok' };

export interface Inkluderet {
  readonly udbyder: typeof INKLUDERET_ID;
  /** The proxy's address without a trailing slash (https, or http on loopback for the local check). */
  readonly baseUrl: string;
  /** The bearer token, read from the file now; undefined (closed) when it is missing, empty or implausible. */
  token(): Promise<string | undefined>;
  /** The month's meter, cached briefly; undefined when it cannot be read now. */
  forbrug(): Promise<Forbrug | undefined>;
  /** The allowance is used up (a 402 seen and the reset date not come, or the meter at 100 %); `nulstilles` when known. */
  brugt(): Promise<{ nulstilles?: string } | undefined>;
  /** The proxy answered "not available" a minute ago or less. */
  utilgaengelig(): boolean;
  /** The agent reports what the proxy answered on a run. */
  noter(h: InkluderetHaendelse): void;
  /** Called whenever what the proxy last said changes (the composition root refreshes the screens). */
  lyt(fn: () => void): void;
}

const TOKEN_MAKS = 4096;
const TOKEN_TEGN = /^[\x21-\x7e]+$/; // printable ASCII without whitespace: a line break in a header value is an injection
const DATO = /^\d{4}-\d{2}-\d{2}$/;
const UTILGAENGELIG_MS = 60_000;
const FEJL_CACHE_MS = 10_000;
const FORBRUG_TIMEOUT_MS = 5000;
/** A 402 without a reset date is not held longer than this (the next run says it again). */
const KVOTE_UDEN_DATO_MS = 60 * 60_000;

const LOKAL = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The proxy address as the agent may use it: https (http only on loopback), no credentials, query or fragment. Null = refused. */
export function proxyAdresse(raa: string): string | null {
  let url: URL;
  try { url = new URL(raa.trim()); } catch { return null; }
  const https = url.protocol === 'https:';
  if (!https && !(url.protocol === 'http:' && LOKAL.has(url.hostname))) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const erObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A reset date as the proxy gives it, or undefined. */
export const gyldigDato = (v: unknown): string | undefined => (typeof v === 'string' && DATO.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : undefined);

export function createInkluderet(o: {
  proxyUrl: string;
  tokenFil: string;
  fetchImpl?: typeof fetch;
  nu?: () => Date;
  /** Hands a token just read to the one redactor (server.ts). */
  registrer?: (v: string) => void;
  cacheMs?: number;
}): Inkluderet {
  const baseUrl = proxyAdresse(o.proxyUrl);
  if (!baseUrl) throw new Error('KC_MODEL_PROXY_URL er ikke en gyldig adresse');
  const doFetch: typeof fetch = o.fetchImpl ?? ((input, init) => fetch(input, init));
  const nu = o.nu ?? ((): Date => new Date());
  const cacheMs = o.cacheMs ?? 30_000;
  const lyttere: (() => void)[] = [];
  const sig = (): void => { for (const f of lyttere) { try { f(); } catch { /* a listener bug must not break a run */ } } };

  let cache: { tid: number; v: Forbrug | undefined } | undefined;
  let kvote: { tid: number; nulstilles?: string } | undefined;
  let utilgSiden: number | undefined;

  async function token(): Promise<string | undefined> {
    let v: string;
    try { v = (await readFile(o.tokenFil, 'utf8')).trim(); } catch { return undefined; }
    if (!v || v.length > TOKEN_MAKS || !TOKEN_TEGN.test(v)) return undefined;
    o.registrer?.(v);
    return v;
  }

  async function forbrug(): Promise<Forbrug | undefined> {
    const tid = nu().getTime();
    if (cache && tid - cache.tid < (cache.v ? cacheMs : FEJL_CACHE_MS)) return cache.v;
    const t = await token();
    if (!t) return undefined;
    let v: Forbrug | undefined;
    try {
      const res = await doFetch(`${baseUrl}/v1/forbrug`, { headers: { authorization: `Bearer ${t}`, accept: 'application/json' }, signal: AbortSignal.timeout(FORBRUG_TIMEOUT_MS), redirect: 'error' }); // the token goes to the proxy's address only, never along a redirect
      if (res.ok) {
        const d: unknown = await res.json();
        const p = erObj(d) ? d['procent'] : undefined;
        const dato = erObj(d) ? gyldigDato(d['nulstilles']) : undefined;
        if (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1000 && dato) v = { procent: p, nulstilles: dato };
      }
    } catch { v = undefined; } // the underlying error may name the address or echo the token: only "unknown" leaves
    cache = { tid, v };
    return v;
  }

  /** The 402 no longer holds: its reset date has come (UTC), or, with no date, an hour went by. */
  const udloebet = (k: NonNullable<typeof kvote>): boolean => (k.nulstilles ? nu().toISOString().slice(0, 10) >= k.nulstilles : nu().getTime() - k.tid >= KVOTE_UDEN_DATO_MS);

  const utilg = (): boolean => utilgSiden !== undefined && nu().getTime() - utilgSiden < UTILGAENGELIG_MS;
  const tilstand = (): string => `${Boolean(kvote)}|${kvote?.nulstilles ?? ''}|${utilg()}`;

  return {
    udbyder: INKLUDERET_ID,
    baseUrl,
    token,
    forbrug,
    async brugt() {
      if (kvote && udloebet(kvote)) kvote = undefined;
      if (kvote) return kvote.nulstilles ? { nulstilles: kvote.nulstilles } : {};
      const f = await forbrug();
      return f && f.procent >= 100 ? { nulstilles: f.nulstilles } : undefined;
    },
    utilgaengelig: utilg,
    noter(h) {
      const foer = tilstand();
      if (h.art === 'kvote') {
        const dato = gyldigDato(h.nulstilles);
        kvote = { tid: nu().getTime(), ...(dato ? { nulstilles: dato } : {}) };
      } else if (h.art === 'utilgaengelig') {
        utilgSiden = nu().getTime();
      } else {
        kvote = undefined;
        utilgSiden = undefined;
      }
      if (foer !== tilstand()) { cache = undefined; sig(); } // what the proxy said changed: the meter is read again, it should now agree
    },
    lyt(fn) { lyttere.push(fn); },
  };
}

/**
 * The included model from the environment: both KC_MODEL_PROXY_URL and KC_MODEL_TOKEN_FIL set = an entitled Sky tenant;
 * anything less = none (a self-hosted install never sees the provider). An address that is not https (loopback http
 * aside) refuses to start, naming the key and never the value, because the token would travel in the clear.
 */
export function inkluderetFraMiljoe(e: Record<string, string | undefined>, ekstra: { registrer?: (v: string) => void; fetchImpl?: typeof fetch } = {}): Inkluderet | undefined {
  const adresse = (e['KC_MODEL_PROXY_URL'] ?? '').trim();
  const fil = (e['KC_MODEL_TOKEN_FIL'] ?? '').trim();
  if (!adresse || !fil) return undefined;
  if (!proxyAdresse(adresse)) throw new Error('KC_MODEL_PROXY_URL skal være en https-adresse (http kun på loopback)');
  return createInkluderet({ proxyUrl: adresse, tokenFil: fil, ...(ekstra.registrer ? { registrer: ekstra.registrer } : {}), ...(ekstra.fetchImpl ? { fetchImpl: ekstra.fetchImpl } : {}) });
}

/**
 * The NoegleLager seam for the included provider: its "key" is the token file, read at call time. It can neither be
 * saved nor removed from Clawco (the file is Sky's); every other provider passes straight through.
 */
export function medInkluderetToken(lager: NoegleLager, ink: Pick<Inkluderet, 'token'>): NoegleLager {
  return {
    hent: (u) => (u === INKLUDERET_ID ? ink.token() : lager.hent(u)),
    async findes(u) { return u === INKLUDERET_ID ? (await ink.token()) !== undefined : lager.findes(u); },
    saet: (u, n) => (u === INKLUDERET_ID ? Promise.reject(new Error('Clawcos AI har ingen nøgle at gemme')) : lager.saet(u, n)),
    fjern: (u) => (u === INKLUDERET_ID ? Promise.resolve() : lager.fjern(u)),
  };
}
