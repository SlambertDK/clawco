// The status page's components (KC-0189): login, adgang, oprettelse, sikkerhedskopi, mail and the tenants' own health
// (clawco). Each is judged from its own signal by a pure function; the signals come in as seams wired by server.ts, so
// drift/ never imports fleet/, konto/ or gateway/. Invariant: a signal that is missing, or a probe that threw, is
// `nedsat` (unknown) — never `ok`.
import http from 'node:http';
import type { Database } from '../../db/pool.ts';
import { PostFejl, type Post } from '../../delt/post.ts';
import { DB } from '../backup/koer.ts';
import { levendeOmfang } from '../backup/planlaeg.ts';
import { kopiTilstand } from '../backup/tilstand.ts';
import { postSiden } from './historik.ts';
import { kunderStatus, KOMPONENTER, type Antal, type KomponentId, type Status } from './vurder.ts';

export { KOMPONENTER, type KomponentId };

/** Working names for the feed; the status page (KC-0175) owns the public wording and may show its own. */
export const NAVNE: Record<KomponentId, string> = {
  login: 'Login',
  adgang: 'Adgang til din Clawco',
  oprettelse: 'Oprettelse af nye Clawco',
  sikkerhedskopi: 'Sikkerhedskopier',
  mail: 'Mail',
  clawco: 'Kundernes Clawco',
};

/** The components whose `nede` makes the whole service `nede` (the others make it `nedsat`). */
export const KERNE: readonly KomponentId[] = ['login', 'adgang', 'clawco'];

const MIN = 60_000;
const TIME = 60 * MIN;

/** Provisioning's time budget (KC-0182: bestilt → klar under two minutes). */
export const OPRETTELSE_BUDGET_MS = 2 * MIN;
/** A copy older than this is overdue (the KC-0187 rule `backup-gammel` uses the same 36 hours). */
export const KOPI_FRIST_MS = 36 * TIME;

export function loginStatus(i: { sky: boolean | null; konto: boolean | null }): Status {
  if (i.sky === false || i.konto === false) return 'nede';
  return i.sky && i.konto ? 'ok' : 'nedsat';
}

/** The canary: an anonymous request to a tenant host must be sent to the account host's login (the route resolved,
 *  the gateway key is loaded, the database answered). null = no canary to ask. */
export type AdgangSvar = { status: number; location: string | null };
export function adgangStatus(s: AdgangSvar | null, kontoOrigin: string): Status {
  if (!s) return 'nedsat';
  return s.status === 302 && (s.location ?? '').startsWith(`${kontoOrigin}/`) ? 'ok' : 'nede';
}

export type Provisionering = { bestilt: Date; klar: Date | null; tilstand: string };

/** The last 24 hours' provisioning: success rate (under 95 % nedsat, under half nede) and median time (over the budget
 *  nedsat). A tenant still inside its budget is not judged yet; one deleted before it was ready was cancelled. With
 *  nothing to judge, whether a fleet is there to provision at all. */
export function oprettelseStatus(i: { forsoeg: Provisionering[]; flaadeKlar: boolean } | null, nu: Date): Status {
  if (!i) return 'nedsat';
  const doemt = i.forsoeg.filter((p) => p.klar || (!['afvikles', 'slettet'].includes(p.tilstand) && nu.getTime() - p.bestilt.getTime() > OPRETTELSE_BUDGET_MS));
  if (!doemt.length) return i.flaadeKlar ? 'ok' : 'nede';
  const tider = doemt.filter((p) => p.klar).map((p) => p.klar!.getTime() - p.bestilt.getTime()).sort((a, b) => a - b);
  const andel = tider.length / doemt.length;
  if (andel < 0.5) return 'nede';
  const midt = tider.length % 2 ? tider[(tider.length - 1) / 2]! : (tider[tider.length / 2 - 1]! + tider[tider.length / 2]!) / 2;
  return andel < 0.95 || midt > OPRETTELSE_BUDGET_MS ? 'nedsat' : 'ok';
}

/** Share of scopes (each live tenant and Sky's own database) with a good copy in 36 hours; a scope younger than that
 *  has had no night yet. Copies switched off are nede, whatever the rows say; no scope at all is unknown. */
export function kopiStatus(i: { slaaetTil: boolean; omfang: { siden: Date; sidsteSucces: Date | null }[] } | null, nu: Date): Status {
  if (!i) return 'nedsat';
  if (!i.slaaetTil) return 'nede';
  if (!i.omfang.length) return 'nedsat';
  const graense = nu.getTime() - KOPI_FRIST_MS;
  const gode = i.omfang.filter((o) => (o.sidsteSucces && o.sidsteSucces.getTime() >= graense) || o.siden.getTime() >= graense).length;
  const andel = gode / i.omfang.length;
  if (andel === 1) return 'ok';
  return andel >= 0.9 ? 'nedsat' : 'nede';
}

export type PostResultat = { tid: Date; ok: boolean; kode: string | null };

/** A message the provider refused (`afvist`) still proves the provider answers; one we could not render (`ugyldig`) says
 *  nothing about mail. Of the last 24 hours: the three newest failing is nede; the newest failing, or a failure in the
 *  last hour, is nedsat. With nothing in 24 hours the newest older result decides (only an ok keeps it ok). */
export function mailStatus(r: PostResultat[] | null, nu: Date): Status {
  if (!r) return 'nedsat';
  const virker = (p: PostResultat) => p.ok || p.kode === 'afvist';
  const rel = r.filter((p) => p.kode !== 'ugyldig').sort((a, b) => b.tid.getTime() - a.tid.getTime());
  if (!rel.length) return 'nedsat';
  const doegn = rel.filter((p) => nu.getTime() - p.tid.getTime() <= 24 * TIME);
  if (!doegn.length) return virker(rel[0]!) ? 'ok' : 'nedsat';
  const nyeste = doegn.slice(0, 3);
  if (nyeste.length === 3 && nyeste.every((p) => !virker(p))) return 'nede';
  if (!virker(doegn[0]!) || doegn.some((p) => !virker(p) && nu.getTime() - p.tid.getTime() <= TIME)) return 'nedsat';
  return 'ok';
}

/** Wraps the Post every Sky mail goes through: each send's outcome is recorded (ok, or the PostFejl code — never a
 *  recipient or the message's data). The send itself is untouched; a recorder that fails is ignored. The record is
 *  never awaited: a send made inside a database transaction must not wait for a write on another connection. */
export function maaltPost(post: Post, noter: (r: PostResultat) => Promise<void>, nu: () => Date = () => new Date()): Post {
  const gem = (r: PostResultat): void => { void noter(r).catch(() => {}); };
  return {
    async send(b) {
      try {
        await post.send(b);
      } catch (err) {
        gem({ tid: nu(), ok: false, kode: err instanceof PostFejl ? err.kode : 'udbyder' });
        throw err;
      }
      gem({ tid: nu(), ok: true, kode: null });
    },
  };
}

/** Sky's own listener, asked as a browser would ask the canary tenant's host (Host header), never following the
 *  redirect. Never the public edge: the check is from Sky's own side. */
export function adgangsProbe(o: { port: number; vaert: () => Promise<string | null>; timeoutMs?: number }): () => Promise<AdgangSvar | null> {
  return async () => {
    const vaert = await o.vaert();
    if (!vaert) return null;
    return new Promise<AdgangSvar>((ok) => {
      const req = http.request({ host: '127.0.0.1', port: o.port, path: '/', method: 'GET', headers: { host: vaert, 'user-agent': 'clawco-sky-status' }, timeout: o.timeoutMs ?? 3_000 }, (res) => {
        res.resume();
        ok({ status: res.statusCode ?? 0, location: typeof res.headers.location === 'string' ? res.headers.location : null });
      });
      req.on('timeout', () => { req.destroy(); });
      req.on('error', () => { ok({ status: 0, location: null }); });
      req.end();
    });
  };
}

/** The seams the components read. Wired by server.ts; tests hand in fakes. */
export type KomponentDeps = {
  db: Database;
  /** Sky's own /health is ok. */
  sky(): Promise<boolean>;
  /** An account lookup answers. */
  konto(): Promise<boolean>;
  adgang(): Promise<AdgangSvar | null>;
  /** The account host's origin (the canary's login redirect must point there). */
  kontoOrigin: string;
  /** Tenants ordered since a time (KC-0182's rows). */
  provisioneringer(siden: Date): Promise<Provisionering[]>;
  /** Whether a fleet with its master key is there to provision at all. */
  flaadeKlar: boolean;
  /** Whether the nightly copies run (KC-0185: off until the R2 bucket token exists). */
  kopierSlaaetTil: boolean;
  /** Every tenant row for the copy scopes (fleet/tilstand.ts tenanterTilKopi). */
  kopiTenanter(): Promise<{ slug: string; tilstand: string; siden: Date }[]>;
};

async function forsoeg<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/** One pass of every component. A probe that throws gives its component no signal (nedsat); login's two checks are
 *  the thing itself, so their failure is a false (nede). */
export async function maalKomponenter(d: KomponentDeps, antal: Antal, nu: Date): Promise<Record<KomponentId, Status>> {
  const [sky, konto, adgang, forsoegt, omfang, post] = await Promise.all([
    d.sky().catch(() => false),
    d.konto().catch(() => false),
    forsoeg(() => d.adgang()).then((s) => s),
    forsoeg(() => d.provisioneringer(new Date(nu.getTime() - 24 * TIME))),
    forsoeg(async () => {
      const kopier = await kopiTilstand(d.db);
      const scopes = levendeOmfang(await d.kopiTenanter()).map((o) => ({ siden: o.siden, sidsteSucces: kopier.get(o.omfang)?.sidsteSucces ?? null }));
      const db = kopier.get(DB);
      // Sky's own database before its first attempt has no row: never copied, so never good.
      scopes.push(db ? { siden: db.oprettet, sidsteSucces: db.sidsteSucces } : { siden: new Date(0), sidsteSucces: null });
      return scopes;
    }),
    forsoeg(() => postSiden(d.db, new Date(nu.getTime() - 7 * 24 * TIME))),
  ]);
  return {
    login: loginStatus({ sky, konto }),
    adgang: adgangStatus(adgang, d.kontoOrigin),
    oprettelse: oprettelseStatus(forsoegt ? { forsoeg: forsoegt, flaadeKlar: d.flaadeKlar } : null, nu),
    sikkerhedskopi: kopiStatus(omfang ? { slaaetTil: d.kopierSlaaetTil, omfang } : (d.kopierSlaaetTil ? null : { slaaetTil: false, omfang: [] }), nu),
    mail: mailStatus(post, nu),
    clawco: kunderStatus(antal),
  };
}
