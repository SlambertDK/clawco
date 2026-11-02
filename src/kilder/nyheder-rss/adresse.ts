// KC-0137: which addresses the RSS fetcher may call (the SSRF guard, AGENTS §0 r2/r7).
//
// Always refused, whoever typed the address: anything but http(s), credentials
// in the URL, link-local (169.254.0.0/16, fe80::/10), cloud metadata names and
// addresses, unspecified and multicast. Loopback and the home network are
// refused too unless the user pasted that very address ('bruger'); addresses
// found inside content (an OPML entry, a discovered link) and every redirect
// are 'ekstern' and may only reach the public internet. The checks work on the
// WHATWG URL's normalised host, so 2852039166 and 0xa9fea9fe are 169.254.169.254.

import { isIP } from 'node:net';
import { rssTekst } from './tekster.ts';

export type Oprindelse = 'bruger' | 'ekstern';

export class AdresseFejl extends Error {
  constructor(besked: string) { super(besked); this.name = 'AdresseFejl'; }
}

const FORBUDTE_NAVNE = new Set(['metadata', 'metadata.google.internal', 'metadata.goog', 'instance-data', 'instance-data.ec2.internal']);
const IKKE_HTTP = /^(javascript|data|file|ftp|ftps|mailto|blob|about|ws|wss|feed|view-source):/i;

type Klasse = 'forbudt' | 'lokal' | 'offentlig';

function ipv4(a: number, b: number, c: number, d: number): Klasse {
  if (a === 0 || a >= 224) return 'forbudt';
  if (a === 169 && b === 254) return 'forbudt';
  if (a === 100 && b === 100 && c === 100 && d === 200) return 'forbudt'; // Alibaba metadata
  if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return 'lokal';
  return 'offentlig';
}

/** The eight 16-bit groups of an IPv6 text (zone id and dotted tail handled), or null. */
function groups(ip: string): number[] | null {
  let t = ip.split('%')[0] ?? '';
  const punkt = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(t);
  if (punkt) {
    const [a, b, c, d] = punkt.slice(1).map(Number) as [number, number, number, number];
    t = t.slice(0, punkt.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const dele = t.split('::');
  if (dele.length > 2) return null;
  const hoved = dele[0] ? dele[0].split(':') : [];
  const hale = dele[1] ? dele[1].split(':') : [];
  const fyld = dele.length === 2 ? 8 - hoved.length - hale.length : 0;
  if (fyld < 0 || (dele.length === 1 && hoved.length !== 8)) return null;
  const alle = [...hoved, ...Array<string>(fyld).fill('0'), ...hale].map((g) => parseInt(g, 16));
  return alle.length === 8 && alle.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? alle : null;
}

function klassificer(ip: string): Klasse {
  if (isIP(ip) === 4) {
    const [a, b, c, d] = ip.split('.').map(Number) as [number, number, number, number];
    return ipv4(a, b, c, d);
  }
  const g = groups(ip);
  if (!g) return 'forbudt'; // unreadable: fail closed
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const v4 = (): Klasse => ipv4(g6 >> 8, g6 & 255, g7 >> 8, g7 & 255);
  if (g.every((x) => x === 0)) return 'forbudt';
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return 'lokal';
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) return v4(); // mapped / compatible IPv4
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return v4(); // NAT64
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xff00) === 0xff00) return 'forbudt';
  if (g0 === 0xfd00 && g1 === 0x0ec2 && g7 === 0x0254) return 'forbudt'; // AWS IPv6 metadata
  if ((g0 & 0xfe00) === 0xfc00) return 'lokal';
  return 'offentlig';
}

/** Throws AdresseFejl when `ip` (a resolved or literal address) may not be called by `o.oprindelse`. */
export function tjekIp(ip: string, o: { oprindelse: Oprindelse }): void {
  const k = klassificer(ip);
  if (k === 'forbudt') throw new AdresseFejl(rssTekst().intern);
  if (k === 'lokal' && o.oprindelse !== 'bruger') throw new AdresseFejl(rssTekst().lokalt);
}

function tjekNavn(vaert: string, o: { oprindelse: Oprindelse }): void {
  const v = vaert.toLowerCase().replace(/\.$/, '');
  if (FORBUDTE_NAVNE.has(v)) throw new AdresseFejl(rssTekst().intern);
  if ((v === 'localhost' || v.endsWith('.localhost')) && o.oprindelse !== 'bruger') throw new AdresseFejl(rssTekst().lokalt);
}

/**
 * A pasted or found address as a checked URL. Without a scheme https is assumed; credentials, other schemes and
 * refused hosts throw AdresseFejl. A host NAME is judged again, by what it resolves to, by the fetcher.
 */
export function tjekAdresse(raa: string, o: { oprindelse: Oprindelse }): URL {
  const t = raa.trim();
  if (!t || t.length > 2000) throw new AdresseFejl(rssTekst().tomEllerLang);
  if (IKKE_HTTP.test(t)) throw new AdresseFejl(rssTekst().skalBegynde);
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`); } catch { throw new AdresseFejl(rssTekst().kanIkkeLaeses); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AdresseFejl(rssTekst().skalBegynde);
  if (u.username || u.password) throw new AdresseFejl(rssTekst().ingenLogin);
  if (!u.hostname) throw new AdresseFejl(rssTekst().mangerVaert);
  const vaert = u.hostname.startsWith('[') ? u.hostname.slice(1, -1) : u.hostname;
  if (isIP(vaert)) tjekIp(vaert, o); else tjekNavn(vaert, o);
  return u;
}

/** The key two spellings of the same address share: lowercase host, default port and fragment dropped. */
export function normaliserAdresse(u: URL): string {
  const n = new URL(u.href);
  n.hash = '';
  return n.href;
}
