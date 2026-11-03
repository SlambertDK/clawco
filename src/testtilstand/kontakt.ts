// The dispatcher in front of the real app and the test world (KC-0068). A
// device that carries the cookie `kc_test=1` is served by the test world;
// everyone else by the real app, untouched. The world is created lazily on the
// first "tænd" (one memoised promise), so a real server that never turns test
// on pays nothing. Spec: docs/superpowers/specs/2026-10-30-testtilstand-design.md

import path from 'node:path';
import { Hono, type Context } from 'hono';
import type { Testverden } from './verden.ts';
import { ALLE_MOMENTER } from './indhold.ts';
import { erFunnel } from '../identitet/identitet.ts';

const COOKIE = 'kc_test';
const MAX_ALDER = 2592000; // 30 days
const SAT = `${COOKIE}=1; Path=/; SameSite=Lax; HttpOnly; Max-Age=${MAX_ALDER}`;
/** KC-0268: over https the cookie is Secure too; over plain http (laptop mode, the dev server) that flag would drop it. */
const satFor = (req: Request): string => (new URL(req.url).protocol === 'https:' ? `${SAT}; Secure` : SAT);
const RYDDET = `${COOKIE}=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0`;
const FEJL_TEKST = 'Testtilstand kunne ikke starte';
const INTERN_TEKST = 'Testtilstand fejlede';
const SKIFTET_TEKST = 'Testtilstand er skiftet — genindlæs siden.';
/** The mode a page declares on its own fetches (public/app.js): `test` iff the page shows the test world. */
const TILSTAND = 'x-kc-tilstand';
/** The univers presentation documents (server.ts `/rum/:id/vis/:name`), loaded in a sandboxed iframe. */
const VIS_STI = /\/rum\/[^/]+\/vis\//;

type Rigtig = { fetch: (r: Request, env?: unknown) => Response | Promise<Response> };
/** KC-0268: the real app's identity decision for this request — its refusal, or null when the person may use the test world. */
export type Adgang = (req: Request, env?: unknown) => Promise<Response | null>;

/** The test world's data dir: KC_TEST_DATA_DIR, else a sibling of the real one (never inside it, whatever the trailing slash). */
export function testDataDir(env: { KC_TEST_DATA_DIR?: string; KC_DATA_DIR?: string }): string {
  return env.KC_TEST_DATA_DIR || path.resolve(env.KC_DATA_DIR || './data') + '-test';
}

const harCookie = (r: Request): boolean =>
  (r.headers.get('cookie') ?? '').split(';').some((d) => d.trim() === `${COOKIE}=1`);

// The chat phrase that flips the switch: the whole message, nothing else. "æøå" are folded to ascii first.
const NAVN = '(?:testtilstand(?:en)?|testdata(?:en)?|test tilstand)';
const TIL = [`(?:taend|aktiver|start) ${NAVN}(?: til)?`, `slaa ${NAVN} til`, `${NAVN} til`].map((m) => new RegExp(`^${m}(?: nu| tak)?$`));
const FRA = [`(?:sluk|deaktiver|stop) ${NAVN}(?: fra)?`, `slaa ${NAVN} fra`, `${NAVN} fra`].map((m) => new RegExp(`^${m}(?: nu| tak)?$`));

export function erTestBesked(besked: string): 'til' | 'fra' | null {
  const t = besked.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa')
    .normalize('NFD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (TIL.some((r) => r.test(t))) return 'til';
  if (FRA.some((r) => r.test(t))) return 'fra';
  return null;
}

/** "HH:MM" Copenhagen wall time for `d`. */
const tidKbh = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

/** JSON for an inline script: `<` (and the line separators) escaped so nothing can close the tag. */
const scriptJson = (v: unknown): string =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16)}`);

/** The Date shift must run before app.js, so the tags go right after <head>. */
function injicer(html: string, v: Testverden): string {
  const m = v.moment();
  const tags = `<script>window.KC_TEST=${scriptJson({ offsetMs: v.ur.offsetMs(), moment: m.id, navn: m.navn })}</script><script src="/testtilstand.js"></script><link rel="stylesheet" href="/testtilstand.css">`;
  return html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + tags);
}

export function medTesttilstand(real: Rigtig, lav: () => Promise<Testverden>, adgang?: Adgang): Hono {
  const app = new Hono();
  let verden: Promise<Testverden> | null = null;
  /** The world, created at most once; a failed creation is forgotten so the next taend retries. */
  const hent = (): Promise<Testverden> => {
    if (!verden) {
      const p = (async () => lav())();
      verden = p;
      p.catch(() => { if (verden === p) verden = null; });
    }
    return verden;
  };
  const fejl = (): Response =>
    new Response(FEJL_TEKST, { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'set-cookie': RYDDET } });
  const intern = (): Response => new Response(INTERN_TEKST, { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  /**
   * Runs `fn` with the world. Only a failed creation clears the cookie (503); an error after the world is built
   * is a plain 500 that keeps the device in test mode.
   */
  async function medVerden(fn: (v: Testverden) => Promise<Response>): Promise<Response> {
    let v: Testverden;
    try { v = await hent(); } catch (err) { console.error('testtilstand: verdenen kunne ikke oprettes:', err); return fejl(); }
    try { return await fn(v); } catch (err) { console.error('testtilstand: fejl i testverdenen:', err); return intern(); }
  }
  const json = (c: Context, data: unknown, cookie?: string, status: 200 | 404 | 409 = 200): Response => {
    if (cookie) c.header('set-cookie', cookie);
    return c.json(data as Record<string, unknown>, status);
  };
  const tidOgMoment = (v: Testverden) => ({ moment: v.moment().id, momenter: ALLE_MOMENTER.map((m) => ({ id: m.id, navn: m.navn, tid: m.tid })), tid: tidKbh(v.ur.now()) });

  /**
   * Serves a request from the test world; HTML pages get the panel tags. A presentation shown in <iframe sandbox>
   * (the univers `vis` route, or any response with its own CSP) is passed through untouched: scripts are blocked there.
   */
  async function tilVerden(v: Testverden, req: Request): Promise<Response> {
    const r = await v.app.fetch(req);
    if (!(r.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html')) return r;
    // A presentation's own CSP restricts scripts (default-src or script-src); the app's general one (KC-0268:
    // frame-ancestors and friends on every response) does not, so only the former means "leave it alone".
    if (/\b(?:default-src|script-src)\b/i.test(r.headers.get('content-security-policy') ?? '') || VIS_STI.test(new URL(req.url).pathname)) return r;
    const h = new Headers(r.headers);
    h.delete('content-length');
    return new Response(injicer(await r.text(), v), { status: r.status, statusText: r.statusText, headers: h });
  }

  // KC-0116: Clawco is never public — Funnel traffic is refused before either world sees it.
  app.use('*', async (c, next) => {
    if (erFunnel(c.req.raw.headers)) return new Response('Ingen adgang', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    await next();
  });
  // KC-0268: the test routes and the test world sit behind the real app's identity decision (cross-site, an unknown
  // login, a guest and support are refused there), never behind the cookie alone. /health and a cookie-less request
  // go straight to the real app, which decides for itself.
  app.use('*', async (c, next) => {
    const req = c.req.raw;
    const sti = new URL(req.url).pathname;
    if (!adgang || sti === '/health' || (!harCookie(req) && !sti.startsWith('/test/') && !(sti === '/api/rum/hjem/chat' && req.method === 'POST'))) return next();
    const nej = await adgang(req, c.env);
    if (nej) return nej;
    await next();
  });

  app.post('/test/taend', async (c) => {
    return medVerden(async (v) => json(c, { url: (await v.taend()).url }, satFor(c.req.raw)));
  });

  app.post('/test/sluk', (c) => json(c, { url: '/rum/hjem' }, RYDDET));

  // The chat phrase: only the chat form (aabn) asks for it; the dispatcher answers, Hermes never sees it.
  app.post('/api/rum/:id/chat', async (c, next) => {
    const raw = c.req.raw;
    let b: unknown = null;
    try { b = await raw.clone().json(); } catch { /* not JSON: the real handler complains */ }
    const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
    const valg = o['aabn'] === true && typeof o['besked'] === 'string' ? erTestBesked(o['besked']) : null;
    if (!valg) return next();
    if (valg === 'fra') return json(c, { aabn: '/rum/hjem', testtilstand: 'fra' }, RYDDET);
    return medVerden(async (v) => {
      // Already on: keep the world as it is; otherwise start clean.
      const { url } = harCookie(raw) ? { url: v.moment().url } : await v.taend();
      return json(c, { aabn: url, testtilstand: 'til' }, satFor(raw));
    });
  });

  // A stale tab (test turned off or on in another tab, an expired cookie, a bfcache restore) declares a mode
  // the cookie no longer has: its writes go nowhere, and the page reloads into the right world. Requests
  // without the header (the worker, curl, the timer) and reads (EventSource cannot send headers) stay
  // cookie-routed. Registered after taend/sluk and the chat phrase: there the mismatch is the point.
  app.use('*', async (c, next) => {
    const req = c.req.raw;
    const tilstand = req.headers.get(TILSTAND);
    if (req.method === 'GET' || req.method === 'HEAD' || (tilstand !== 'test' && tilstand !== 'real')) return next();
    if ((tilstand === 'test') === harCookie(req)) return next();
    return new Response(SKIFTET_TEKST, { status: 409, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-kc-tilstand-skiftet': '1' } });
  });

  app.post('/test/moment/:id', async (c) => {
    if (!harCookie(c.req.raw)) return json(c, { error: 'Testtilstand er ikke tændt' }, undefined, 409);
    return medVerden(async (v) => {
      const hop = await v.hop(c.req.param('id'));
      return hop ? json(c, { url: hop.url }) : json(c, { error: 'Ukendt tidspunkt' }, undefined, 404);
    });
  });

  app.get('/test/status', async (c) => {
    if (!harCookie(c.req.raw)) return json(c, { til: false });
    return medVerden(async (v) => json(c, { til: true, ...tidOgMoment(v) }));
  });

  app.all('*', async (c) => {
    const req = c.req.raw;
    if (new URL(req.url).pathname === '/health' || !harCookie(req)) return real.fetch(req, c.env);
    return medVerden((v) => tilVerden(v, req));
  });

  return app;
}
