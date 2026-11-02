// What the gateway never does (KC-0183, AGENTS §0 r7, D16): forward a tenant's /health (open by design, shows
// the sha; Sky reads it over the private network) or anything under /_sky/; pass on a header a client could use
// to claim an identity, or the gateway's own cookie; let a tenant set the gateway's cookie; or log a path, a
// query string, a cookie, a header or a body.
import type { IncomingHttpHeaders } from 'node:http';
import { COOKIE } from './cookie.ts';

/** The path as a tenant's router would see it: dot segments resolved, percent-decoded, lower case, single slashes. */
function somTenantSer(sti: string): string {
  const u = (s: string) => new URL(`http://x.invalid${s.startsWith('/') ? s : `/${s}`}`).pathname;
  let p = u(sti);
  try { p = decodeURIComponent(p); } catch { /* malformed escapes: judge the raw form */ }
  return u(p.toLowerCase().replace(/\/{2,}/g, '/'));
}

export function aldrigVidere(sti: string): boolean {
  const p = somTenantSer(sti);
  return p === '/health' || p.startsWith('/health/') || p === '/_sky' || p.startsWith('/_sky/');
}

const HOP = new Set(['connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const IDENTITET = /^(clawco-konto|tailscale-.*|x-forwarded-.*|forwarded|x-real-ip|true-client-ip|cf-.*|cdn-loop)$/;

type Ud = Record<string, string | string[]>;

function forbindelsesNavne(h: IncomingHttpHeaders): Set<string> {
  return new Set(String(h.connection ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** The client's headers as the tenant may see them. The caller adds the signed Clawco-Konto afterwards. */
export function rensInd(h: IncomingHttpHeaders): Ud {
  const navngivne = forbindelsesNavne(h);
  const ud: Ud = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined || HOP.has(k) || navngivne.has(k) || IDENTITET.test(k)) continue;
    if (k === 'cookie') {
      const rest = String(v).split(';').map((s) => s.trim()).filter((s) => s && s.slice(0, s.indexOf('=')).trim() !== COOKIE);
      if (rest.length) ud[k] = rest.join('; ');
      continue;
    }
    ud[k] = v;
  }
  return ud;
}

/** The tenant's response headers as the client may see them: content and cache headers untouched. */
export function rensUd(h: IncomingHttpHeaders): Ud {
  const navngivne = forbindelsesNavne(h);
  const ud: Ud = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined || HOP.has(k) || navngivne.has(k)) continue;
    if (k === 'set-cookie') {
      const rest = [v].flat().filter((c) => c.slice(0, c.indexOf('=')).trim() !== COOKIE);
      if (rest.length) ud[k] = rest;
      continue;
    }
    ud[k] = v;
  }
  return ud;
}

/** One request, one line: method, slug, status, duration, konto id. Nothing else, by construction. */
export function logLinje(a: { metode: string; slug: string; status: number; ms: number; konto: number | null }): string {
  const metode = /^[A-Z]{1,10}$/.test(a.metode) ? a.metode : '?';
  return `gateway: ${metode} ${a.slug} ${a.status} ${Math.round(a.ms)}ms konto=${a.konto ?? '-'}`;
}
