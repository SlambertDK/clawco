// KC-0137: the RSS fetcher. One GET per feed with every limit the ticket names:
// http(s) only, max 3 redirects, a 10 s deadline for the whole fetch, a 2 MB
// cap (also on the decompressed bytes), conditional GET, at most 2 requests per
// host at a time, a polite User-Agent. The SSRF guard (adresse.ts) runs on EVERY
// hop: the host is resolved once, every answer is judged, and the connection
// goes to the address that was judged (a `lookup` that returns it), so a DNS
// answer that changes between check and connect cannot redirect the request.
// Redirects count as 'ekstern': they reach the public internet only.

import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';
import { AdresseFejl, tjekAdresse, tjekIp, type Oprindelse } from './adresse.ts';

export type Opslag = (vaert: string) => Promise<{ address: string; family: 4 | 6 }[]>;
export type Svar = { status: 'ny'; tekst: string; etag?: string; sidstRettet?: string; endeligAdresse: string } | { status: 'uaendret' };
export type Henter = (adresse: string, o: { oprindelse: Oprindelse; etag?: string; sidstRettet?: string }) => Promise<Svar>;

export class HentFejl extends Error {
  readonly kode: 'afvist' | 'tid' | 'stor' | 'omdirigering' | 'status' | 'net';
  /** KC-0235: the HTTP status of a 'status' failure (a connector maps 401/403/404/410 to "the link is revoked"). */
  readonly httpStatus: number | undefined;
  constructor(kode: HentFejl['kode'], besked: string, httpStatus?: number) { super(besked); this.name = 'HentFejl'; this.kode = kode; this.httpStatus = httpStatus; }
}

export type HenterValg = {
  opslag?: Opslag;
  agent?: string;
  /** The deadline for the whole fetch, redirects included (default 10 s). */
  tidMs?: number;
  maksBytes?: number;
  maksOmdirigeringer?: number;
  /** Requests in flight per host (default 2) and in all (default 6). */
  perVaert?: number;
  samtidige?: number;
  /** KC-0235: the Accept header (default: feeds). */
  accept?: string;
  /**
   * KC-0235: when set, EVERY hop (the first address and each redirect) must be on a host this accepts, or the fetch is
   * refused before anything is sent — a source that may only talk to its own provider (Aula) never follows a redirect elsewhere.
   */
  tilladtVaert?: (vaert: string) => boolean;
  /** Tests only: lets redirects reach loopback/LAN (link-local and metadata stay refused). The app never sets it. */
  tilladLoopbackUdefra?: boolean;
};

const standardOpslag: Opslag = async (vaert) => (await dns.lookup(vaert, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

/** At most `n` at a time; the rest wait their turn. */
function lavPlads(n: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let aktive = 0;
  const koe: (() => void)[] = [];
  const naeste = (): void => { const f = koe.shift(); if (f) f(); };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (aktive >= n) await new Promise<void>((res) => koe.push(res));
    aktive += 1;
    try { return await fn(); } finally { aktive -= 1; naeste(); }
  };
}

const STANDARD_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.5, */*;q=0.1';

/** The text label a response declares (Content-Type charset, else the XML declaration), else utf-8. */
function afkodTekst(bytes: Buffer, contentType: string): string {
  const fraType = /charset\s*=\s*"?([a-z0-9_.:-]+)/i.exec(contentType)?.[1];
  const fraXml = /^<\?xml[^>]*encoding\s*=\s*["']([a-z0-9_.:-]+)["']/i.exec(bytes.subarray(0, 200).toString('latin1'))?.[1];
  for (const label of [fraType, fraXml]) {
    if (!label) continue;
    try { return new TextDecoder(label).decode(bytes); } catch { /* unknown label: next */ }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

type Hop = { status: number; location?: string; tekst?: string; etag?: string; sidstRettet?: string };

export function lavHenter(o: HenterValg = {}): Henter {
  const opslag = o.opslag ?? standardOpslag;
  const agent = o.agent ?? 'Clawco/0.1';
  const accept = o.accept ?? STANDARD_ACCEPT;
  const tidMs = o.tidMs ?? 10_000;
  const maksBytes = o.maksBytes ?? 2 * 1024 * 1024;
  const maksOmd = o.maksOmdirigeringer ?? 3;
  const perVaert = o.perVaert ?? 2;
  const iAlt = lavPlads(o.samtidige ?? 6);
  const paaVaert = new Map<string, ReturnType<typeof lavPlads>>();
  const vaertPlads = (noegle: string): ReturnType<typeof lavPlads> => {
    let p = paaVaert.get(noegle);
    if (!p) { p = lavPlads(perVaert); paaVaert.set(noegle, p); }
    return p;
  };
  const oprindelseFor = (op: Oprindelse): Oprindelse => (o.tilladLoopbackUdefra ? 'bruger' : op);

  /** Resolves the host once and judges every answer; the first one is the one to connect to. */
  async function vaelgIp(u: URL, op: Oprindelse): Promise<{ address: string; family: 4 | 6 }> {
    const vaert = u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname;
    const fam = isIP(vaert);
    let svar: { address: string; family: 4 | 6 }[];
    if (fam) svar = [{ address: vaert, family: fam === 6 ? 6 : 4 }];
    else {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const forLangsomt = new Promise<never>((_res, rej) => { timer = setTimeout(() => rej(new Error('opslag')), tidMs); });
        try { svar = await Promise.race([opslag(vaert), forLangsomt]); } finally { clearTimeout(timer); }
      } catch { throw new HentFejl('net', 'Adressen findes ikke eller kan ikke slås op.'); }
    }
    if (!svar.length) throw new HentFejl('net', 'Adressen findes ikke eller kan ikke slås op.');
    for (const a of svar) {
      try { tjekIp(a.address, { oprindelse: op }); } catch (err) { throw new HentFejl('afvist', err instanceof Error ? err.message : 'Adressen er afvist.'); }
    }
    return svar[0] as { address: string; family: 4 | 6 };
  }

  function en(u: URL, ip: { address: string; family: 4 | 6 }, hoveder: Record<string, string>, signal: AbortSignal): Promise<Hop> {
    return new Promise<Hop>((resolve, reject) => {
      const slut = (err: HentFejl | null, hop?: Hop): void => { if (err) reject(err); else resolve(hop as Hop); };
      const tid = (): HentFejl => new HentFejl('tid', 'Kilden svarede ikke i tide.');
      if (signal.aborted) { slut(tid()); return; }
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`, method: 'GET', headers: hoveder, agent: false,
        lookup: ((_h: string, opt: { all?: boolean }, cb: (...a: unknown[]) => void) => (opt?.all ? cb(null, [{ address: ip.address, family: ip.family }]) : cb(null, ip.address, ip.family))) as never,
      });
      const afbryd = (): void => { req.destroy(); slut(tid()); };
      signal.addEventListener('abort', afbryd, { once: true });
      const faerdig = (err: HentFejl | null, hop?: Hop): void => { signal.removeEventListener('abort', afbryd); slut(err, hop); };
      req.on('error', () => faerdig(signal.aborted ? tid() : new HentFejl('net', 'Kilden kunne ikke nås.')));
      req.on('response', (res) => {
        const status = res.statusCode ?? 0;
        const h = res.headers;
        if (status >= 300 && status < 400 && status !== 304) {
          res.resume();
          faerdig(null, { status, ...(typeof h.location === 'string' ? { location: h.location } : {}) });
          return;
        }
        if (status === 304) { res.resume(); faerdig(null, { status }); return; }
        if (status < 200 || status >= 300) { res.destroy(); faerdig(new HentFejl('status', `Kilden svarede ${status}.`, status)); return; }
        const kodning = String(h['content-encoding'] ?? 'identity').toLowerCase().trim();
        const laengde = Number(h['content-length']);
        if (kodning === 'identity' && Number.isFinite(laengde) && laengde > maksBytes) { res.destroy(); faerdig(new HentFejl('stor', 'Kilden er for stor.')); return; }
        let strom: Readable = res;
        if (kodning === 'gzip' || kodning === 'x-gzip') strom = res.pipe(createGunzip());
        else if (kodning === 'deflate') strom = res.pipe(createInflate());
        else if (kodning === 'br') strom = res.pipe(createBrotliDecompress());
        else if (kodning !== 'identity') { res.destroy(); faerdig(new HentFejl('net', 'Kilden bruger en ukendt komprimering.')); return; }
        const dele: Buffer[] = [];
        let n = 0;
        strom.on('data', (c: Buffer) => {
          n += c.length;
          if (n > maksBytes) { strom.destroy(); res.destroy(); faerdig(new HentFejl('stor', 'Kilden er for stor.')); return; }
          dele.push(c);
        });
        strom.on('end', () => {
          const ct = String(h['content-type'] ?? '');
          faerdig(null, {
            status, tekst: afkodTekst(Buffer.concat(dele), ct),
            ...(typeof h.etag === 'string' ? { etag: h.etag } : {}), ...(typeof h['last-modified'] === 'string' ? { sidstRettet: h['last-modified'] } : {}),
          });
        });
        strom.on('error', () => faerdig(signal.aborted ? tid() : new HentFejl('net', 'Svaret kunne ikke læses.')));
        res.on('error', () => faerdig(signal.aborted ? tid() : new HentFejl('net', 'Svaret kunne ikke læses.')));
      });
      req.end();
    });
  }

  return async (adresse, p) => {
    // The deadline starts when the fetch first gets its turn, not while it waits behind others of the same host.
    let signal: AbortSignal | undefined;
    let u: URL;
    let op: Oprindelse = p.oprindelse;
    try { u = tjekAdresse(adresse, { oprindelse: oprindelseFor(op) }); } catch (err) { throw new HentFejl('afvist', err instanceof Error ? err.message : 'Adressen er afvist.'); }
    if (o.tilladtVaert && !o.tilladtVaert(u.hostname)) throw new HentFejl('afvist', 'Adressen hører ikke til den tjeneste, kilden må tale med.');
    for (let hop = 0; ; hop += 1) {
      const ip = await vaelgIp(u, oprindelseFor(op));
      const hoveder: Record<string, string> = { 'user-agent': agent, accept, 'accept-encoding': 'gzip, deflate, br' };
      if (p.etag) hoveder['if-none-match'] = p.etag;
      if (p.sidstRettet) hoveder['if-modified-since'] = p.sidstRettet;
      const r = await iAlt(() => vaertPlads(`${u.hostname}:${u.port}`)(() => en(u, ip, hoveder, (signal ??= AbortSignal.timeout(tidMs)))));
      if (r.status === 304) return { status: 'uaendret' };
      if (r.status >= 300 && r.status < 400) {
        if (hop >= maksOmd) throw new HentFejl('omdirigering', 'Kilden sender dig videre for mange gange.');
        if (!r.location) throw new HentFejl('net', 'Kilden sender dig videre uden at sige hvorhen.');
        try { u = tjekAdresse(new URL(r.location, u).href, { oprindelse: oprindelseFor('ekstern') }); } catch (err) {
          throw new HentFejl('afvist', err instanceof AdresseFejl ? err.message : 'Kilden sender dig videre til en adresse, der ikke kan bruges.');
        }
        if (o.tilladtVaert && !o.tilladtVaert(u.hostname)) throw new HentFejl('afvist', 'Kilden sender dig videre til en tjeneste, den ikke må tale med.');
        op = 'ekstern';
        continue;
      }
      return { status: 'ny', tekst: r.tekst ?? '', ...(r.etag ? { etag: r.etag } : {}), ...(r.sidstRettet ? { sidstRettet: r.sidstRettet } : {}), endeligAdresse: u.href };
    }
  };
}
