// The one redactor (KC-0125, spec E7, §0 r8): mask-by-value, so it needs no list of key shapes. A value is secret
// when it comes from (a) an env name matching KEY|TOKEN|SECRET|PASSWORD|NOEGLE or one of the two named keys, read at call
// time (a key set after start is covered), or (b) a secret store that registers what it reads or writes (connector
// credentials, the model-key file). Every string that leaves the process toward a person, a log or the agent goes
// through `redigeres`: logs (redigerKonsol), run errors and answers and the requests to Hermes (runs.ts).
// Residual: a secret split across two streamed deltas, or transformed (base64, hashed), is not recognised.

import { format, inspect } from 'node:util';

/** Values shorter than this are not masked: a "secret" of 5 characters would mask ordinary words. They are listed by name (forKorteNavne). */
export const MIN_LAENGDE = 8;
export const MASKE = '[skjult]';
// NOEGLE: KC_MODEL_NOEGLE_<UDBYDER> (KC-0180), the direct agent's model keys.
const NAVN_MOENSTER = /KEY|TOKEN|SECRET|PASSWORD|NOEGLE/;
const NAVNGIVNE = ['KC_ELEVENLABS_API_KEY', 'KC_HERMES_API_KEY'] as const;
type Miljoe = Record<string, string | undefined>;

const registrerede = new Set<string>();

/** A secret store hands over a value it just read or wrote. False (and nothing kept) when it is too short to mask. */
export function registrerHemmelighed(vaerdi: string): boolean {
  const v = vaerdi.trim();
  if (v.length < MIN_LAENGDE) return false;
  registrerede.add(v);
  return true;
}

/** For tests: forget every registered value. */
export function nulstilRegistrerede(): void { registrerede.clear(); }

/** True for an env name whose value counts as secret. */
export const erHemmeligtNavn = (n: string): boolean => NAVN_MOENSTER.test(n) || (NAVNGIVNE as readonly string[]).includes(n);

/** The env names that count as secret and have a value. */
function hemmeligeFraMiljoe(env: Miljoe): [string, string][] {
  return Object.entries(env).filter((e): e is [string, string] => erHemmeligtNavn(e[0]) && typeof e[1] === 'string' && e[1].trim() !== '').map(([n, v]) => [n, v.trim()]);
}

/** Names whose value is set but below the minimum length: not masked, so the caller can say so (npm run hemmeligheder prints "for kort"). */
export function forKorteNavne(env: Miljoe = process.env): string[] {
  return hemmeligeFraMiljoe(env).filter(([, v]) => v.length < MIN_LAENGDE).map(([n]) => n).sort();
}

/** The forms one value can take in a string: as is, JSON-escaped, URL-encoded, as util.inspect prints it. */
function former(v: string): string[] {
  const ud = new Set<string>([v, JSON.stringify(v).slice(1, -1), encodeURIComponent(v), inspect(v).slice(1, -1)]);
  return [...ud].filter((f) => f.length >= MIN_LAENGDE);
}

function monstre(env: Miljoe): string[] {
  const vaerdier = new Set<string>(registrerede);
  for (const [, v] of hemmeligeFraMiljoe(env)) if (v.length >= MIN_LAENGDE) vaerdier.add(v);
  return [...vaerdier].flatMap(former);
}

/** Masks every secret value in `tekst`. Overlapping matches are merged first, so a partial overlap leaves nothing behind. */
export function redigeres(tekst: string, env: Miljoe = process.env): string {
  if (!tekst) return tekst;
  const spans: [number, number][] = [];
  for (const m of monstre(env)) {
    for (let i = tekst.indexOf(m); i !== -1; i = tekst.indexOf(m, i + 1)) spans.push([i, i + m.length]);
  }
  if (!spans.length) return tekst;
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let ud = '';
  let fra = 0;
  let [s, e] = spans[0]!;
  const flush = (): void => { ud += tekst.slice(fra, s) + MASKE; fra = e; };
  for (const [a, b] of spans.slice(1)) {
    if (a <= e) { e = Math.max(e, b); continue; }
    flush();
    [s, e] = [a, b];
  }
  flush();
  return ud + tekst.slice(fra);
}

function fejlTekst(err: unknown, dybde: number): string {
  if (dybde > 6) return '…';
  if (err instanceof Error) {
    const dele = [`${err.name}: ${err.message}`];
    if (err instanceof AggregateError) for (const e of err.errors) dele.push(`i: ${fejlTekst(e, dybde + 1)}`);
    if (err.cause !== undefined) dele.push(`årsag: ${fejlTekst(err.cause, dybde + 1)}`);
    return dele.join(' ← ');
  }
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err) ?? String(err); } catch { return String(err); }
}

/** An error as one masked line: its message and its whole cause chain (and an AggregateError's members). Strings and plain objects too. */
export function redigeresFejl(err: unknown, env: Miljoe = process.env): string {
  return redigeres(fejlTekst(err, 0), env);
}

type Konsol = Pick<Console, 'log' | 'info' | 'warn' | 'error' | 'debug'>;

/** Wraps the console's methods once so nothing printed holds a secret: the arguments are formatted as Node would, then masked. */
export function redigerKonsol(k: Konsol = console): void {
  for (const niveau of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = k[niveau].bind(k);
    k[niveau] = (...args: unknown[]): void => original(redigeres(format(...args)));
  }
}
