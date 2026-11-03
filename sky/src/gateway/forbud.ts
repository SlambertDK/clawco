// What the gateway never does (KC-0183, AGENTS §0 r7, D16): forward a tenant's /health (open by design, shows
// the sha; Sky reads it over the private network), anything under /_sky/ or /intern/ (KC-0184) or /model/ (KC-0264); pass on a header a client could use
// to claim an identity, or the gateway's own cookie; let a tenant set the gateway's cookie; or log a path, a
// query string, a cookie, a header or a body.
//
// KC-0272 (D2): a tenant's cookies are host-only by the gateway's hand. Every tenant, konto. and the apex are one
// site, so a cookie another *.<basedomain> host sets with Domain= would otherwise reach every tenant, and the server
// cannot see a cookie's Domain. So a tenant's Set-Cookie goes out as __Host-<name> (no Domain, Path=/, Secure) and
// only __Host- cookies come back in, unprefixed — a sibling host cannot set a __Host- cookie on this host. The
// gateway's own cookies (the tenant cookie and the entry binding) never pass either way.
import type { IncomingHttpHeaders } from 'node:http';
import { COOKIE } from './cookie.ts';
import { BINDING_COOKIE } from './login-vej.ts';

const HOST = '__Host-';
const EGNE = new Set([COOKIE, BINDING_COOKIE]);

/** The path as a tenant's router would see it: dot segments resolved, percent-decoded, lower case, single slashes. */
function somTenantSer(sti: string): string {
  const u = (s: string) => new URL(`http://x.invalid${s.startsWith('/') ? s : `/${s}`}`).pathname;
  let p = u(sti);
  try { p = decodeURIComponent(p); } catch { /* malformed escapes: judge the raw form */ }
  return u(p.toLowerCase().replace(/\/{2,}/g, '/'));
}

export function aldrigVidere(sti: string): boolean {
  const p = somTenantSer(sti);
  // KC-0184: /intern/ is the tenant's control route (Sky's own signed calls over the private network only).
  // KC-0203: so is the beta pull, GET /api/beta/maal — a browser never needs it, and the only caller is Sky's own signed call.
  // KC-0264: /model/ is Sky's model proxy on the account host only; a tenant host never passes it on to a tenant.
  return p === '/health' || p.startsWith('/health/') || p === '/_sky' || p.startsWith('/_sky/') || p === '/intern' || p.startsWith('/intern/') || p === '/api/beta/maal'
    || p === '/model' || p.startsWith('/model/');
}

const HOP = new Set(['connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const IDENTITET = /^(clawco-konto|clawco-kontrol|tailscale-.*|x-forwarded-.*|forwarded|x-real-ip|true-client-ip|cf-.*|cdn-loop)$/;

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
      const rest = String(v).split(';').map((s) => s.trim()).flatMap((s) => {
        const navn = s.slice(0, Math.max(0, s.indexOf('='))).trim();
        return navn.startsWith(HOST) && navn.length > HOST.length && !EGNE.has(navn) ? [s.slice(s.indexOf(HOST) + HOST.length)] : [];
      });
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
      const rest = [v].flat().flatMap((c) => {
        const [par = '', ...attr] = c.split(';').map((d) => d.trim());
        const i = par.indexOf('=');
        const navn = i > 0 ? par.slice(0, i).trim() : '';
        if (!navn || EGNE.has(navn) || EGNE.has(HOST + navn)) return [];
        const behold = attr.filter((a) => a && !/^(domain|path|secure)(=|$)/i.test(a));
        return [[`${HOST}${navn}${par.slice(i)}`, ...behold, 'Path=/', 'Secure'].join('; ')];
      });
      if (rest.length) ud[k] = rest;
      continue;
    }
    ud[k] = v;
  }
  return ud;
}

/** One request, one line: method, slug, status, duration, konto id, and (KC-0188) the support grant of a support
 *  session — so Sky's log names the staff account behind every request. Nothing else, by construction. */
export function logLinje(a: { metode: string; slug: string; status: number; ms: number; konto: number | null; stoette?: number | null }): string {
  const metode = /^[A-Z]{1,10}$/.test(a.metode) ? a.metode : '?';
  const stoette = Number.isSafeInteger(a.stoette) ? ` stoette=${a.stoette}` : '';
  return `gateway: ${metode} ${a.slug} ${a.status} ${Math.round(a.ms)}ms konto=${a.konto ?? '-'}${stoette}`;
}
