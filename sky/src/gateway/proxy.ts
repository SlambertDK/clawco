// The gateway (KC-0183, spec §2 `gateway/`, D12): Sky's process answers every <slug>.<basedomain> request here
// (the Host dispatch is rute.ts' vaertsArt; the beta edge is a Cloudflare Tunnel to Sky's loopback port).
//
// Invariant (AGENTS §0 r2/r7): a request reaches a tenant only through this gateway, only with a valid
// unexpired token for that tenant and a current membership, and always with a gateway-made Clawco-Konto
// signature; nothing the client sends is read as identity. On any doubt (key missing, database down, route
// unknown) the answer is 503/404 without proxying.
//
// A raw node:http handler rather than a Hono route: the response is piped byte for byte, so Server-Sent Events
// and long requests pass unbuffered and nothing is decompressed or re-encoded on the way.
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Database } from '../db/pool.ts';
import { STI_MAKS, signerKonto, signerStoetteBevis, type StoettePaastand } from './signer.ts';
import type { GatewayNoegle } from './noegle.ts';
import type { Rute, RuteTabel } from './rute.ts';
import { cookieFra, laesToken, saetCookie, sessionLever, sletCookie, udstedToken, type TokenIndhold } from './cookie.ts';
import { BINDING_COOKIE, BINDING_SEK, FAA, bindingHash, erBinding, indloesKode, loginUrl, nyBinding, sikkerNaeste, tenantOrigin } from './login-vej.ts';
import { aldrigVidere, logLinje, rensInd, rensUd } from './forbud.ts';
import { svarOpdaterer } from './opdaterer.ts';
import { KONTAKT, SLAA_FRA, TEKST, laesFormular, nySessionId, sek, timerAf, type StoetteSeams } from './stoette-vej.ts';

export type GatewayDeps = {
  db: Database;
  publicUrl: string;
  basedomain: string;
  noegle: GatewayNoegle | null;
  ruter: RuteTabel;
  /** KC-0204: has this account accepted the CURRENT consent versions? Asked at entry and at every token refresh;
   *  a throw is a 503, never a yes. Handed in by server.ts (gateway/ never imports konto/ or tilmelding/). */
  samtykkeOk(kontoId: number): Promise<boolean>;
  log?: (linje: string) => void;
  nu?: () => Date;
  /** Exchange attempts per client IP per minute (the one rate limit here; the ticket's "simple per-IP cap"). */
  faaPrMinut?: number;
  /** KC-0188: "Lad support se med" (stoette-vej.ts). Absent = no switch (404) and no support session opens anything. */
  stoette?: StoetteSeams;
  /** KC-0203: the household behind this tenant was let in today (the beta's retention signal). Called without waiting
   *  for it, only after a current membership is confirmed, never for a support session; a throw or rejection is ignored. */
  noterSet?: (slug: string) => void | Promise<void>;
};

type Haandtering = (req: IncomingMessage, res: ServerResponse, slug: string) => void;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The client's IP: behind the tunnel (a loopback peer) the one Cloudflare states; otherwise the peer. */
function klientIp(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? '';
  if (LOOPBACK.has(peer)) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim();
    if (xff) return xff;
  }
  return peer || 'ukendt';
}

function svar(res: ServerResponse, status: number, tekst: string, ekstra: Record<string, string | string[]> = {}): void {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...ekstra });
  res.end(tekst);
}

/** The request target as path + query, dot segments resolved; an absolute-form target keeps only its path. */
function maalSti(raw: string | undefined): URL {
  const r = raw ?? '/';
  return r.startsWith('/') ? new URL(`http://x.invalid${r}`) : new URL(r.startsWith('http') ? r : `/${r}`, 'http://x.invalid');
}

export function gateway(d: GatewayDeps): Haandtering {
  const nu = d.nu ?? (() => new Date());
  const log = d.log ?? ((s: string) => console.log(`sky ${s}`));
  const loft = d.faaPrMinut ?? 20;
  const forsoeg = new Map<string, { n: number; fra: number }>();

  function tillad(ip: string): boolean {
    const t = Date.now();
    const f = forsoeg.get(ip);
    if (!f || t - f.fra >= 60_000) {
      if (forsoeg.size > 10_000) forsoeg.clear();
      forsoeg.set(ip, { n: 1, fra: t });
      return true;
    }
    f.n += 1;
    return f.n <= loft;
  }

  async function veksl(req: IncomingMessage, res: ServerResponse, slug: string, url: URL, noegle: GatewayNoegle): Promise<number | null> {
    if (req.method !== 'GET' && req.method !== 'HEAD') { svar(res, 405, 'Metoden er ikke tilladt.'); return null; }
    if (!tillad(klientIp(req))) { svar(res, 429, 'For mange forsøg. Vent et minut.'); return null; }
    if (!(await d.ruter.find(slug))) { svar(res, 404, 'Ikke fundet.'); return null; }
    const b = cookieFra(req.headers.cookie, BINDING_COOKIE);
    const k = await indloesKode(d.db, url.searchParams.get('kode') ?? '', slug, nu(), erBinding(b) ? bindingHash(b) : undefined);
    if (!k) { svar(res, 400, 'Linket er udløbet eller allerede brugt. Åbn din Clawco igen.'); return null; }
    const email = await sessionLever(d.db, { s: k.sessionId, k: k.kontoId }, nu());
    if (!email) { svar(res, 400, 'Du er logget ud. Åbn din Clawco igen.'); return k.kontoId; }
    // KC-0188: a staff member's code opens a support session (kind stoette): never a membership, never past the grant.
    if (k.stoetteId !== undefined) {
      const a = d.stoette ? await d.stoette.gyldig({ id: k.stoetteId, slug, personaleKontoId: k.kontoId, sessionId: k.sessionId, nu: nu() }) : null;
      if (!a || !d.stoette) { svar(res, 403, TEKST.ikkeAaben); return k.kontoId; }
      const token = udstedToken(noegle.cookie, { t: slug, k: k.kontoId, s: k.sessionId, e: email, g: a.id, n: nySessionId() }, nu(), a.udloeber);
      await d.stoette.sessionStartet({ id: a.id, personaleKontoId: k.kontoId, nu: nu() });
      log(`stoette: session startet ${slug} adgang=${a.id} personale=${k.kontoId}`);
      res.writeHead(303, { location: sikkerNaeste(k.naeste), 'set-cookie': saetCookie(token), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      res.end();
      return k.kontoId;
    }
    if (!(await d.ruter.medlem(slug, k.kontoId))) { svar(res, 403, 'Du har ikke adgang til denne Clawco.'); return k.kontoId; }
    if (!(await d.samtykkeOk(k.kontoId))) { svar(res, 403, 'Vilkårene er ændret. Åbn din Clawco igen fra din konto og sig ja til den nye version.'); return k.kontoId; }
    const token = udstedToken(noegle.cookie, { t: slug, k: k.kontoId, s: k.sessionId, e: email }, nu());
    res.writeHead(303, { location: sikkerNaeste(k.naeste), 'set-cookie': [saetCookie(token), `${BINDING_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`], 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end();
    return k.kontoId;
  }

  function egenOprindelse(req: IncomingMessage, slug: string): boolean {
    const origin = req.headers.origin;
    if (origin !== undefined) return origin === tenantOrigin(slug, d.publicUrl, d.basedomain);
    const site = req.headers['sec-fetch-site'];
    return site === 'same-origin' || site === 'none';
  }

  function videre(req: IncomingMessage, res: ServerResponse, rute: Rute, url: URL, p: TokenIndhold, nyCookie: string | null, noegle: GatewayNoegle, stoette?: StoettePaastand): void {
    // KC-0272 (D2): tenants share one site, so SameSite=Lax does not keep another tenant's page from posting here
    // with the member's cookie. A state-changing request passes only from the tenant's own page: its Origin, or
    // (no Origin) the browser's Sec-Fetch-Site saying same-origin or none (typed or bookmarked).
    if (req.method !== 'GET' && req.method !== 'HEAD' && !egenOprindelse(req, rute.slug)) { svar(res, 403, 'Forbudt.'); return; }
    if (url.pathname.length > STI_MAKS) { svar(res, 414, 'Adressen er for lang.'); return; }
    const maal = new URL(rute.adresse);
    const headers = rensInd(req.headers);
    headers['clawco-konto'] = signerKonto(noegle.privat, { t: rute.slug, k: String(p.k), e: p.e, iat: Math.floor(nu().getTime() / 1000), m: req.method ?? '', p: url.pathname, ...stoette });
    const ud = http.request({ protocol: maal.protocol, hostname: maal.hostname, port: maal.port, method: req.method, path: url.pathname + url.search, headers }, (s) => {
      const h = rensUd(s.headers);
      if (nyCookie) h['set-cookie'] = [...[h['set-cookie'] ?? []].flat(), nyCookie];
      res.writeHead(s.statusCode ?? 502, h);
      res.flushHeaders();
      s.pipe(res);
      s.on('error', () => res.destroy());
    });
    ud.on('error', () => svar(res, 502, 'Din Clawco svarer ikke lige nu. Prøv igen om lidt.'));
    res.on('close', () => { if (!res.writableFinished) ud.destroy(); });
    req.pipe(ud);
  }

  /** The person behind the tenant cookie, refreshed after 15 minutes while the Sky session lives (and, for a member,
   *  while they have accepted the current texts; a support session is checked against its grant instead). */
  async function adgang(raa: string | undefined, slug: string, noegle: GatewayNoegle): Promise<{ p: TokenIndhold | null; nyCookie: string | null }> {
    const t = laesToken(noegle.cookie, raa, slug, nu());
    if (!t.ok) return { p: null, nyCookie: null };
    if (!t.udloebet) return { p: t.p, nyCookie: null };
    const p = t.p;
    const email = await sessionLever(d.db, p, nu());
    if (!email) return { p: null, nyCookie: null };
    if (p.g !== undefined) return { p: { ...p, e: email }, nyCookie: null }; // re-issued in stoetteAnmodning once the grant is checked
    // A person who has not accepted the current texts gets no fresh token: they go back to Sky to accept.
    if (!(await d.samtykkeOk(p.k))) return { p: null, nyCookie: null };
    return { p: { ...p, e: email }, nyCookie: saetCookie(udstedToken(noegle.cookie, { t: slug, k: p.k, s: p.s, e: email }, nu())) };
  }

  /** KC-0188: one request of a support session. The grant is asked on every request (no cache); only reads pass. */
  async function stoetteAnmodning(req: IncomingMessage, res: ServerResponse, rute: Rute, url: URL, p: TokenIndhold, noegle: GatewayNoegle): Promise<void> {
    const a = d.stoette && p.g !== undefined && p.n ? await d.stoette.gyldig({ id: p.g, slug: rute.slug, personaleKontoId: p.k, sessionId: p.s, nu: nu() }) : null;
    // The app's own client reads {error} from an /api answer and shows it; a page gets the plain text.
    const nej = (tekst: string, ekstra: Record<string, string> = {}) => (url.pathname.startsWith('/api/')
      ? svar(res, 403, JSON.stringify({ error: tekst }), { 'content-type': 'application/json; charset=utf-8', ...ekstra })
      : svar(res, 403, tekst, ekstra));
    if (!a || !p.n) { nej(TEKST.slut, { 'set-cookie': sletCookie() }); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { nej(TEKST.kunSe); return; }
    if (rute.opdateres) { svarOpdaterer(res); return; }
    const nyCookie = nu().getTime() >= p.exp ? saetCookie(udstedToken(noegle.cookie, { t: rute.slug, k: p.k, s: p.s, e: p.e, g: a.id, n: p.n }, nu(), a.udloeber)) : null;
    videre(req, res, rute, url, p, nyCookie, noegle, { sa: String(a.id), su: sek(a.udloeber), sn: p.n });
  }

  /** KC-0188: the owner's switch (on at KONTAKT, off at SLAA_FRA), answered here and never forwarded. */
  async function kontakt(req: IncomingMessage, res: ServerResponse, slug: string, url: URL, noegle: GatewayNoegle, st: StoetteSeams, saetKonto: (k: number) => void): Promise<void> {
    if (req.method !== 'POST') { svar(res, 405, 'Metoden er ikke tilladt.'); return; }
    // Only from the tenant's own page: the browser's Origin is the tenant's origin exactly.
    if (req.headers.origin !== tenantOrigin(slug, d.publicUrl, d.basedomain)) { svar(res, 403, 'Forbudt.'); return; }
    const rute = await d.ruter.find(slug);
    if (!rute) { svar(res, 404, 'Ikke fundet.'); return; }
    const { p, nyCookie } = await adgang(cookieFra(req.headers.cookie), slug, noegle);
    if (!p) { svar(res, 401, 'Du er ikke logget ind.'); return; }
    saetKonto(p.k);
    if (p.g !== undefined || p.k !== rute.ejerKontoId || !(await d.ruter.medlem(slug, p.k))) { svar(res, 403, TEKST.kunEjer); return; }
    const ekstra: Record<string, string> = nyCookie ? { 'set-cookie': nyCookie } : {};
    const ejer = { slug, adresse: rute.adresse, kontoId: p.k, email: p.e };
    const tilbage = () => { res.writeHead(303, { location: '/', 'cache-control': 'no-store', ...ekstra }); res.end(); };
    if (url.pathname === SLAA_FRA) {
      const ider = await st.tilbagekald({ slug, kontoId: p.k, nu: nu() });
      if (ider === null) { svar(res, 403, TEKST.kunEjer); return; }
      for (const id of ider) log(`stoette: tilbagekaldt ${slug} adgang=${id} af=${p.k}`);
      try { await st.kald.stoetteSlut(ejer); } catch (err) {
        console.error('sky stoette: kunden kunne ikke få besked om slå fra:', (err as Error).message);
        svar(res, 502, TEKST.slaaetFraTenantNede, ekstra);
        return;
      }
      tilbage();
      return;
    }
    const f = await laesFormular(req);
    if (!f) { svar(res, 413, 'For stor.'); return; }
    const g = await st.giv({ slug, kontoId: p.k, timer: Number(f.get('timer') ?? ''), grund: f.get('grund') ?? '', nu: nu() });
    if (!g.ok) { svar(res, g.grund === 'ikke-ejer' ? 403 : 400, g.grund === 'ikke-ejer' ? TEKST.kunEjer : TEKST.ugyldig); return; }
    const a = g.adgang;
    const timer = timerAf(a);
    try {
      await st.kald.stoetteStart(ejer, signerStoetteBevis(noegle.privat, { t: slug, a: String(a.id), g: sek(a.givet), u: sek(a.udloeber), h: timer, r: a.grund, iat: sek(nu()) }));
    } catch (err) {
      console.error('sky stoette: kunden kunne ikke slå support til:', (err as Error).message);
      await st.annuller(a.id, nu());
      svar(res, 502, TEKST.tenantNede, ekstra);
      return;
    }
    try { await st.kvittering(p.k, { timer, udloeber: a.udloeber }); } catch (err) {
      console.error('sky stoette: kvitteringen kunne ikke sendes:', (err as Error).message);
      await st.annuller(a.id, nu());
      await st.kald.stoetteSlut(ejer).catch(() => {});
      svar(res, 502, TEKST.postNede, ekstra);
      return;
    }
    log(`stoette: givet ${slug} adgang=${a.id} af=${p.k} timer=${timer}`);
    tilbage();
  }

  async function haandter(req: IncomingMessage, res: ServerResponse, slug: string, saetKonto: (k: number) => void): Promise<void> {
    const noegle = d.noegle;
    if (!noegle) { svar(res, 503, 'Adgangen til Clawco er ikke sat op endnu.'); return; }
    let url: URL;
    try { url = maalSti(req.url); } catch { svar(res, 400, 'Ugyldig adresse.'); return; }
    if (url.pathname === FAA) {
      const k = await veksl(req, res, slug, url, noegle);
      if (k !== null) saetKonto(k);
      return;
    }
    if (d.stoette && (url.pathname === KONTAKT || url.pathname === SLAA_FRA)) { await kontakt(req, res, slug, url, noegle, d.stoette, saetKonto); return; }
    if (aldrigVidere(url.pathname)) { svar(res, 404, 'Ikke fundet.'); return; }
    const rute = await d.ruter.find(slug);
    if (!rute) { svar(res, 404, 'Ikke fundet.'); return; }

    const raa = cookieFra(req.headers.cookie);
    const { p, nyCookie } = await adgang(raa, slug, noegle);
    if (!p) {
      const ryd = raa !== undefined ? { 'set-cookie': sletCookie() } : {};
      if (req.method === 'GET' || req.method === 'HEAD') {
        const naeste = sikkerNaeste(url.pathname + url.search);
        // KC-0272 (D1): bind the code /aabn will mint to this browser (a second tab keeps the binding it has).
        const foer = cookieFra(req.headers.cookie, BINDING_COOKIE);
        const binding = erBinding(foer) ? foer : nyBinding();
        const saet = [`${BINDING_COOKIE}=${binding}; Path=/; Max-Age=${BINDING_SEK}; HttpOnly; Secure; SameSite=Lax`, ...(raa !== undefined ? [sletCookie()] : [])];
        res.writeHead(302, { location: loginUrl({ publicUrl: d.publicUrl, noegle, slug, naeste, binding }), 'cache-control': 'no-store', 'set-cookie': saet });
        res.end();
      } else svar(res, 401, 'Du er ikke logget ind.', ryd);
      return;
    }
    saetKonto(p.k);
    if (p.g !== undefined) { await stoetteAnmodning(req, res, rute, url, p, noegle); return; }
    if (!(await d.ruter.medlem(slug, p.k))) { svar(res, 403, 'Du har ikke adgang til denne Clawco.'); return; }
    if (d.noterSet) { try { void Promise.resolve(d.noterSet(slug)).catch(() => {}); } catch { /* a note never changes the answer */ } }
    // KC-0186: mid-upgrade, members see a calm page (only members: nobody else learns the tenant is updating).
    if (rute.opdateres) { svarOpdaterer(res); return; }
    videre(req, res, rute, url, p, nyCookie, noegle);
  }

  /** The grant a support cookie names (for Sky's log line only; its MAC is checked, its expiry need not be). */
  function stoetteId(cookie: string | undefined, slug: string): number | null {
    if (!d.noegle) return null;
    const t = laesToken(d.noegle.cookie, cookieFra(cookie), slug, nu());
    return t.ok && t.p.g !== undefined ? t.p.g : null;
  }

  return (req, res, slug) => {
    const start = performance.now();
    let konto: number | null = null;
    res.on('close', () => { log(logLinje({ metode: req.method ?? '', slug, status: res.statusCode, ms: performance.now() - start, konto, stoette: stoetteId(req.headers.cookie, slug) })); });
    haandter(req, res, slug, (k) => { konto = k; }).catch((err: unknown) => {
      console.error('sky gateway: fejl, intet sendt videre:', (err as Error).message);
      svar(res, 503, 'Prøv igen om lidt.');
    });
  };
}
