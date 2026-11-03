// KC-0264: the model proxy, the included Calm model every Sky plan carries. A tenant's Clawco calls it with its own model
// token (KC_MODEL_PROXY_URL = <SKY_PUBLIC_URL>/model, the token from KC_MODEL_TOKEN_FIL); Sky calls the provider with
// Clawco's key, counts the call in the ledger without its content, and stops at the month's cap. The contract:
//   POST /model/v1/messages  the Messages wire (body and SSE as api.anthropic.com/v1/messages), Authorization: Bearer <token>;
//                            the provider's SSE passed through unchanged.
//   GET  /model/v1/forbrug   {brugtMikroUsd, loftMikroUsd, procent, nulstilles, modeller}
//   errors {"error":{"type","message"}}: 401 ugyldig_noegle · 402 kvote_brugt (+ nulstilles) · 400 model_ikke_tilladt ·
//   503 ikke_tilgaengelig (no provider key, switch off, not a listed subprocessor, no plan with the model, provider down) ·
//   429 passed through (and our own bound on parallel calls per tenant) · 413 for_stor.
// Order: token → provider → plan → body → model → cap → forward. Nothing is forwarded before all of it holds.
// The answer's bytes are never kept: forbrug.ts reads only the usage numbers as they pass.
import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Database } from '../db/pool.ts';
import { forbrugsLaeser } from './forbrug.ts';
import { loftNaaet, nulstilles, procent } from './kvote.ts';
import { prisMikroUsd, type Forbrug, type Modelpriser } from './priser.ts';
import { brugtIMaaned, noterKald, type Kald } from './regnskab.ts';
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
  noter?: (k: Kald) => Promise<void>;
};

const fejl = (c: Context, status: number, type: string, message: string, ekstra: Record<string, string> = {}, headers: Record<string, string> = {}) =>
  c.json({ error: { type, message, ...ekstra }, ...ekstra }, status as never, { 'cache-control': 'no-store', ...headers });

const IKKE = 'Clawcos model er ikke tilgængelig lige nu.';

export function modelRuter(d: ModelDeps): Hono {
  const nu = d.nu ?? (() => new Date());
  const log = d.log ?? ((l: string) => console.log(l));
  const noter = d.noter ?? ((k: Kald) => noterKald(d.db, k));
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
      const brugt = await brugtIMaaned(d.db, t, n);
      if (loftNaaet(brugt, ink.loftMikroUsd)) {
        const dato = nulstilles(n);
        return fejl(c, 402, 'kvote_brugt', `Månedens modelmængde er brugt. Den nulstilles ${dato}.`, { nulstilles: dato });
      }
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

      const ac = new AbortController();
      const frist = setTimeout(() => ac.abort(new Error('timeout')), timeoutMs);
      frist.unref?.();
      const signal = AbortSignal.any([ac.signal, c.req.raw.signal]);
      const headers: Record<string, string> = {};
      for (const h of VIDERE_HEADERS) { const v = c.req.header(h); if (v) headers[h] = v; }
      const start = Date.now();
      let svar: Response;
      try {
        svar = await udbyder.send({ krop: krop as Record<string, unknown>, model, headers, signal });
      } catch (e) {
        clearTimeout(frist);
        frigiv();
        const f = e instanceof UdbyderFejl ? e : new UdbyderFejl(503, 'ikke_tilgaengelig', IKKE);
        log(`sky model: ${t} ${model} ${f.status} ${Date.now() - start}ms`);
        if (f.status === 499) return c.body(null, 499 as never);
        return fejl(c, f.status, f.type, f.status === 503 ? IKKE : f.besked, {}, f.retryAfter ? { 'retry-after': f.retryAfter } : {});
      }

      const laeser = forbrugsLaeser(svar.headers.get('content-type'));
      const kaldId = randomUUID();
      let noteret = false;
      const afslut = (hvordan: string) => {
        if (noteret) return;
        noteret = true;
        clearTimeout(frist);
        frigiv();
        const f: Forbrug | null = laeser.resultat();
        if (!f) { log(`sky model: ${t} ${model} ${svar.status} ${Date.now() - start}ms ${hvordan} uden forbrug`); return; }
        let pris: number;
        try { pris = prisMikroUsd(d.priser, model, udbyder.navn, f); } catch (err) { log(`sky model: REGNSKAB ${t} kald=${kaldId}: ${(err as Error).message}`); return; }
        log(`sky model: ${t} ${model} ${svar.status} ${Date.now() - start}ms ${hvordan} ind=${f.input} ud=${f.output} cache=${f.cacheLaes}/${f.cacheSkriv5m + f.cacheSkriv1t} pris=${pris}µ$`);
        noter({ kaldId, tenant: t, tid: n, model, udbyder: udbyder.navn, forbrug: f, prisMikroUsd: pris })
          .catch((err: Error) => { log(`sky model: REGNSKAB FEJLEDE ${t} kald=${kaldId} pris=${pris}µ$ (${err.name})`); });
      };
      const kilde = svar.body?.getReader() ?? null;
      // The deadline or the tenant's hang-up ends the provider's stream too, even if the provider never stops sending.
      signal.addEventListener('abort', () => { void kilde?.cancel().catch(() => {}); }, { once: true });
      const ud = new ReadableStream<Uint8Array>({
        async pull(ctrl) {
          if (!kilde) { afslut('slut'); ctrl.close(); return; }
          try {
            const { done, value } = await kilde.read();
            if (done) { afslut('slut'); ctrl.close(); return; }
            laeser.laes(value);
            ctrl.enqueue(value);
          } catch {
            afslut('afbrudt');
            ctrl.error(new Error('udbyderens svar blev afbrudt'));
          }
        },
        async cancel() {
          ac.abort(new Error('lejeren lagde på'));
          await kilde?.cancel().catch(() => {});
          afslut('lagt på');
        },
      });
      return new Response(ud, { status: svar.status, headers: { 'content-type': svar.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    });
  return app;
}
