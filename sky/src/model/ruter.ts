// KC-0264: the model proxy, the included Calm model every Sky plan carries. A tenant's Clawco calls it with its own model
// token (KC_MODEL_PROXY_URL = <SKY_PUBLIC_URL>/model, the token from KC_MODEL_TOKEN_FIL); Sky calls the provider with
// Clawco's key, counts the call in the ledger without its content, and stops at the month's cap. The contract:
//   POST /model/v1/messages  the Messages wire (body and SSE as api.anthropic.com/v1/messages), Authorization: Bearer <token>;
//                            the provider's SSE passed through, its usage numbers without the cache split (KC-0273).
//   GET  /model/v1/forbrug   {brugtMikroUsd, loftMikroUsd, procent, nulstilles, modeller}
//   errors {"error":{"type","message"}}: 401 ugyldig_noegle · 402 kvote_brugt (+ nulstilles) · 400 model_ikke_tilladt ·
//   503 ikke_tilgaengelig (no provider key, switch off, not a listed subprocessor, no plan with the model, provider down) ·
//   429 passed through (and our own bound on parallel calls per tenant) · 413 for_stor.
// Order: token → provider → plan → body → model → allowlist (krop.ts, KC-0273) → cap → forward. Nothing is forwarded
// before all of it holds, and what is forwarded is the rebuilt body, never the tenant's object.
// The answer's bytes are never kept: forbrug.ts reads only the usage numbers as they pass (and rewrites only them).
// KC-0273: the cap holds for the reservation (afregning.ts) before the call, and the ledger row exists before the
// provider is called, so a hang-up, a deadline or a failed ledger write can never make a call free.
import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Database } from '../db/pool.ts';
import { reservation, afregning } from './afregning.ts';
import { forbrugsLaeser, tilLejer } from './forbrug.ts';
import { bygKrop, tjekBeta } from './krop.ts';
import { nulstilles, procent } from './kvote.ts';
import { prisMikroUsd, type Forbrug, type Modelpriser } from './priser.ts';
import { afregnKald, brugtIMaaned, reserverKald, type Kald } from './regnskab.ts';
import { UdbyderFejl, VIDERE_HEADERS, type ModelUdbyder } from './udbyder.ts';

export type Inkluderet = { loftMikroUsd: number; modeller: string[] };

export type ModelDeps = {
  db: Database;
  priser: Modelpriser;
  /** null = the proxy is off (server.ts says why at start); every call is 503. */
  udbyder: ModelUdbyder | null;
  /** The tenant a bearer token belongs to (hemmeligheder/modeltoken.ts), or null. */
  tenantForToken(token: string): Promise<string | null>;
  /** What the tenant's plan includes right now (config/priser.json inkluderetModel), or null: no such plan. */
  inkluderet(tenant: string, nu: Date): Promise<Inkluderet | null>;
  nu?: () => Date;
  /** Largest request body, bytes (default 10 MB; Bedrock's own limit is 20 MB). */
  maxKrop?: number;
  /** The whole provider call, start to last byte (default 10 minutes). */
  timeoutMs?: number;
  /** Calls in flight per tenant (default 4): bounds how far parallel calls can cross the cap. */
  maxSamtidige?: number;
  log?: (linje: string) => void;
  /** KC-0273: the ledger's two writes (regnskab.ts), injectable so a test can make them fail. */
  reserver?: (k: Kald, loftMikroUsd: number) => Promise<boolean>;
  afregn?: (kaldId: string, f: Forbrug, prisMikroUsd: number) => Promise<void>;
};

const fejl = (c: Context, status: number, type: string, message: string, ekstra: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  c.json({ error: { type, message, ...ekstra }, ...ekstra }, status as never, { 'cache-control': 'no-store', ...headers });

const IKKE = 'Clawcos model er ikke tilgængelig lige nu.';

export function modelRuter(d: ModelDeps): Hono {
  const nu = d.nu ?? (() => new Date());
  const log = d.log ?? ((l: string) => console.log(l));
  const reserver = d.reserver ?? ((k: Kald, loft: number) => reserverKald(d.db, k, loft));
  const afregn = d.afregn ?? ((id: string, f: Forbrug, pris: number) => afregnKald(d.db, id, f, pris));
  const maxSamtidige = d.maxSamtidige ?? 4;
  const timeoutMs = d.timeoutMs ?? 10 * 60_000;
  const igang = new Map<string, number>();
  const app = new Hono();

  async function tenant(c: Context): Promise<string | null> {
    const m = /^Bearer ([A-Za-z0-9+/=]{1,200})$/.exec(c.req.header('authorization') ?? '');
    return m ? d.tenantForToken(m[1]!) : null;
  }
  const ugyldig = (c: Context) => fejl(c, 401, 'ugyldig_noegle', 'Modelnøglen er ukendt eller trukket tilbage.', {}, { 'www-authenticate': 'Bearer' });

  app.get('/model/v1/forbrug', async (c) => {
    const t = await tenant(c);
    if (!t) return ugyldig(c);
    const n = nu();
    const ink = d.udbyder ? await d.inkluderet(t, n) : null;
    if (!ink) return fejl(c, 503, 'ikke_tilgaengelig', IKKE);
    const brugt = await brugtIMaaned(d.db, t, n);
    return c.json({ brugtMikroUsd: brugt, loftMikroUsd: ink.loftMikroUsd, procent: procent(brugt, ink.loftMikroUsd), nulstilles: nulstilles(n), modeller: ink.modeller }, 200, { 'cache-control': 'no-store' });
  });

  app.post('/model/v1/messages',
    bodyLimit({ maxSize: d.maxKrop ?? 10 * 1024 * 1024, onError: (c) => fejl(c, 413, 'for_stor', 'Kaldet er for stort.') }),
    async (c) => {
      const t = await tenant(c);
      if (!t) return ugyldig(c);
      const udbyder = d.udbyder;
      if (!udbyder) return fejl(c, 503, 'ikke_tilgaengelig', IKKE);
      const n = nu();
      const ink = await d.inkluderet(t, n);
      if (!ink) return fejl(c, 503, 'ikke_tilgaengelig', IKKE);
      let krop: unknown;
      try { krop = await c.req.json(); } catch { return fejl(c, 400, 'invalid_request_error', 'Kroppen er ikke gyldig JSON.'); }
      if (typeof krop !== 'object' || krop === null || Array.isArray(krop)) return fejl(c, 400, 'invalid_request_error', 'Kroppen skal være et JSON-objekt.');
      const model = (krop as Record<string, unknown>)['model'];
      if (typeof model !== 'string' || !ink.modeller.includes(model) || !Object.hasOwn(d.priser.modeller, model)) {
        return fejl(c, 400, 'model_ikke_tilladt', `Modellen er ikke med i planen. Tilladt: ${ink.modeller.join(', ')}.`);
      }
      // KC-0273: the body is rebuilt from an allowlist, and a beta header must be on its (empty) list.
      const bygget = bygKrop(krop as Record<string, unknown>);
      if ('fejl' in bygget) return fejl(c, 400, 'invalid_request_error', bygget.fejl);
      const beta = tjekBeta(c.req.header('anthropic-beta'));
      if (beta) return fejl(c, 400, 'invalid_request_error', beta);
      const i = igang.get(t) ?? 0;
      if (i >= maxSamtidige) return fejl(c, 429, 'rate_limit_error', 'For mange samtidige kald.', {}, { 'retry-after': '2' });
      igang.set(t, i + 1);
      let frigivet = false;
      const frigiv = () => {
        if (frigivet) return;
        frigivet = true;
        const x = (igang.get(t) ?? 1) - 1;
        if (x > 0) igang.set(t, x); else igang.delete(t);
      };

      // KC-0273: the reservation goes into the ledger first and must fit under the cap; no row, no call.
      const kaldId = randomUUID();
      let res: ReturnType<typeof reservation>;
      let plads: boolean;
      try {
        res = reservation(d.priser, model, udbyder.navn, bygget.krop, bygget.maxTokens);
        plads = await reserver({ kaldId, tenant: t, tid: n, model, udbyder: udbyder.navn, forbrug: res.forbrug, prisMikroUsd: res.pris }, ink.loftMikroUsd);
      } catch (err) {
        frigiv();
        log(`sky model: REGNSKAB ${t} kald=${kaldId}: reservationen kunne ikke skrives (${(err as Error).name}); intet sendt`);
        return fejl(c, 503, 'ikke_tilgaengelig', IKKE);
      }
      if (!plads) {
        frigiv();
        const dato = nulstilles(n);
        return fejl(c, 402, 'kvote_brugt', `Månedens modelmængde er brugt. Den nulstilles ${dato}.`, { nulstilles: dato });
      }
      /** The one settle of this call's row. A failure leaves the reservation as the price (never a free call). */
      const skrivAfregning = (f: Forbrug, pris: number, hvordan: string) => {
        afregn(kaldId, f, pris).catch((err: Error) => {
          log(`sky model: REGNSKAB FEJLEDE ${t} kald=${kaldId} ${hvordan} pris=${pris}µ$ (${err.name}); reservationen står (${res.pris}µ$)`);
        });
      };

      const ac = new AbortController();
      const frist = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
      frist.unref?.();
      const signal = AbortSignal.any([ac.signal, c.req.raw.signal]);
      const headers: Record<string, string> = {};
      for (const h of VIDERE_HEADERS) { const v = c.req.header(h); if (v) headers[h] = v; }
      const start = Date.now();
      let svar: Response;
      try {
        svar = await udbyder.send({ krop: bygget.krop, model, headers, signal });
      } catch (e) {
        clearTimeout(frist);
        frigiv();
        const f = e instanceof UdbyderFejl ? e : new UdbyderFejl(503, 'ikke_tilgaengelig', IKKE);
        log(`sky model: ${t} ${model} ${f.status} ${Date.now() - start}ms`);
        // The provider gave no answer: nothing to bill.
        skrivAfregning({ input: 0, output: 0, cacheLaes: 0, cacheSkriv5m: 0, cacheSkriv1t: 0 }, 0, 'intet svar');
        if (f.status === 499) return c.body(null, 499 as never);
        return fejl(c, f.status, f.type, f.status === 503 ? IKKE : f.besked, {}, f.retryAfter ? { 'retry-after': f.retryAfter } : {});
      }

      const indholdstype = svar.headers.get('content-type');
      const laeser = forbrugsLaeser(indholdstype);
      const lejer = tilLejer(indholdstype);
      let noteret = false;
      const afslut = (hvordan: string, ren: boolean) => {
        if (noteret) return;
        noteret = true;
        clearTimeout(frist);
        frigiv();
        const set: Forbrug | null = laeser.resultat();
        const a = afregning({ set, komplet: laeser.komplet(), ren, reservation: res });
        let pris: number;
        try { pris = prisMikroUsd(d.priser, model, udbyder.navn, a.forbrug); } catch (err) { log(`sky model: REGNSKAB ${t} kald=${kaldId}: ${(err as Error).message}; reservationen står (${res.pris}µ$)`); return; }
        const f = a.forbrug;
        log(`sky model: ${t} ${model} ${svar.status} ${Date.now() - start}ms ${hvordan} ${a.regel} ind=${f.input} ud=${f.output} cache=${f.cacheLaes}/${f.cacheSkriv5m + f.cacheSkriv1t} pris=${pris}µ$`);
        skrivAfregning(f, pris, hvordan);
      };
      const kilde = svar.body?.getReader() ?? null;
      // The deadline or the tenant's hang-up ends the provider's stream too, even if the provider never stops sending.
      signal.addEventListener('abort', () => { void kilde?.cancel().catch(() => {}); }, { once: true });
      const ud = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
          if (!kilde) { afslut('slut', true); ctrl.close(); return; }
          try {
            const { done, value } = await kilde.read();
            if (done) {
              // A read that ends because the deadline cancelled the provider's stream is not a clean end.
              afslut(signal.aborted ? 'frist' : 'slut', !signal.aborted);
              const rest = lejer.slut();
              if (rest.length) ctrl.enqueue(rest);
              ctrl.close();
              return;
            }
            laeser.laes(value);
            const ud = lejer.stykke(value);
            if (ud.length) ctrl.enqueue(ud);
          } catch {
            afslut('afbrudt', false);
            ctrl.error(new Error('udbyderens svar blev afbrudt'));
          }
        },
        async cancel() {
          ac.abort(new Error('lejeren lagde på'));
          await kilde?.cancel().catch(() => {});
          afslut('lagt på', false);
        },
      });
      return new Response(ud, { status: svar.status, headers: { 'content-type': svar.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    });
  return app;
}
