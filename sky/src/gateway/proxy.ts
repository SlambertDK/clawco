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
import { signerKonto } from './signer.ts';
import type { GatewayNoegle } from './noegle.ts';
import type { Rute, RuteTabel } from './rute.ts';
import { cookieFra, laesToken, saetCookie, sessionLever, sletCookie, udstedToken, type TokenIndhold } from './cookie.ts';
import { FAA, indloesKode, loginUrl, sikkerNaeste } from './login-vej.ts';
import { aldrigVidere, logLinje, rensInd, rensUd } from './forbud.ts';
import { svarOpdaterer } from './opdaterer.ts';

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
    const k = await indloesKode(d.db, url.searchParams.get('kode') ?? '', slug, nu());
    if (!k) { svar(res, 400, 'Linket er udløbet eller allerede brugt. Åbn din Clawco igen.'); return null; }
    const email = await sessionLever(d.db, { s: k.sessionId, k: k.kontoId }, nu());
    if (!email) { svar(res, 400, 'Du er logget ud. Åbn din Clawco igen.'); return k.kontoId; }
    if (!(await d.ruter.medlem(slug, k.kontoId))) { svar(res, 403, 'Du har ikke adgang til denne Clawco.'); return k.kontoId; }
    if (!(await d.samtykkeOk(k.kontoId))) { svar(res, 403, 'Vilkårene er ændret. Åbn din Clawco igen fra din konto og sig ja til den nye version.'); return k.kontoId; }
    const token = udstedToken(noegle.cookie, { t: slug, k: k.kontoId, s: k.sessionId, e: email }, nu());
    res.writeHead(303, { location: sikkerNaeste(k.naeste), 'set-cookie': saetCookie(token), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end();
    return k.kontoId;
  }

  function videre(req: IncomingMessage, res: ServerResponse, rute: Rute, url: URL, p: TokenIndhold, nyCookie: string | null, noegle: GatewayNoegle): void {
    const maal = new URL(rute.adresse);
    const headers = rensInd(req.headers);
    headers['clawco-konto'] = signerKonto(noegle.privat, { t: rute.slug, k: String(p.k), e: p.e, iat: Math.floor(nu().getTime() / 1000) });
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
    if (aldrigVidere(url.pathname)) { svar(res, 404, 'Ikke fundet.'); return; }
    const rute = await d.ruter.find(slug);
    if (!rute) { svar(res, 404, 'Ikke fundet.'); return; }

    const raa = cookieFra(req.headers.cookie);
    const t = laesToken(noegle.cookie, raa, slug, nu());
    let p: TokenIndhold | null = t.ok ? t.p : null;
    let nyCookie: string | null = null;
    if (p && t.ok && t.udloebet) {
      const email = await sessionLever(d.db, p, nu());
      // A person who has not accepted the current texts gets no fresh token: they go back to Sky to accept.
      if (email && await d.samtykkeOk(p.k)) {
        nyCookie = saetCookie(udstedToken(noegle.cookie, { t: slug, k: p.k, s: p.s, e: email }, nu()));
        p = { ...p, e: email };
      } else p = null;
    }
    if (!p) {
      const ryd = raa !== undefined ? { 'set-cookie': sletCookie() } : {};
      if (req.method === 'GET' || req.method === 'HEAD') {
        const naeste = sikkerNaeste(url.pathname + url.search);
        res.writeHead(302, { location: loginUrl({ publicUrl: d.publicUrl, noegle, slug, naeste }), 'cache-control': 'no-store', ...ryd });
        res.end();
      } else svar(res, 401, 'Du er ikke logget ind.', ryd);
      return;
    }
    saetKonto(p.k);
    if (!(await d.ruter.medlem(slug, p.k))) { svar(res, 403, 'Du har ikke adgang til denne Clawco.'); return; }
    // KC-0186: mid-upgrade, members see a calm page (only members: nobody else learns the tenant is updating).
    if (rute.opdateres) { svarOpdaterer(res); return; }
    videre(req, res, rute, url, p, nyCookie, noegle);
  }

  return (req, res, slug) => {
    const start = performance.now();
    let konto: number | null = null;
    res.on('close', () => { log(logLinje({ metode: req.method ?? '', slug, status: res.statusCode, ms: performance.now() - start, konto })); });
    haandter(req, res, slug, (k) => { konto = k; }).catch((err: unknown) => {
      console.error('sky gateway: fejl, intet sendt videre:', (err as Error).message);
      svar(res, 503, 'Prøv igen om lidt.');
    });
  };
}
