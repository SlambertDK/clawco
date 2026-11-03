// KC-0137: helpers for the RSS connector's tests — feed XML, a scripted fetcher and a context.

import { HentFejl, type Henter } from '../../../src/kilder/nyheder-rss/hent.ts';
import type { KildeKontekst } from '../../../src/kilder/types.ts';

export const NU = new Date('2026-11-01T07:00:00Z');

export const ctx = (valg: Record<string, string> = {}, nu: Date = NU): KildeKontekst => ({ nu, zone: 'privat', valg, hemmelighed: async () => null });

export type Post = [titel: string, url: string, udgivet?: string, resume?: string];

export function rss(titel: string, poster: Post[]): string {
  const items = poster.map(([t, u, d, r]) => `<item><title>${t}</title><link>${u}</link>${r ? `<description>${r}</description>` : ''}${d ? `<pubDate>${new Date(d).toUTCString()}</pubDate>` : ''}</item>`).join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${titel}</title>${items}</channel></rss>`;
}

export type Kald = { adresse: string; oprindelse: string; etag?: string; kunAdresser?: readonly string[] };
export type Svar = { tekst: string; etag?: string; adresser?: string[] } | HentFejl;

/** A fetcher that answers from a table by address (a missing address is a network failure); records every call. */
export function falskHenter(tabel: Record<string, Svar>, kald: Kald[] = []): Henter {
  return async (adresse, o) => {
    kald.push({ adresse, oprindelse: o.oprindelse, ...(o.etag ? { etag: o.etag } : {}), ...(o.kunAdresser ? { kunAdresser: o.kunAdresser } : {}) });
    const s = tabel[adresse];
    if (s === undefined) throw new HentFejl('net', 'Kilden kunne ikke nås.');
    if (s instanceof HentFejl) throw s;
    if (s.etag && o.etag === s.etag) return { status: 'uaendret', ...(s.adresser ? { adresser: s.adresser } : {}) };
    return { status: 'ny', tekst: s.tekst, ...(s.etag ? { etag: s.etag } : {}), ...(s.adresser ? { adresser: s.adresser } : {}), endeligAdresse: adresse };
  };
}
